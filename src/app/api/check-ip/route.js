import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';

// Helper function to check if IP is IPv4
function isIPv4(ip) {
  if (!ip) return false;
  // IPv4 pattern: 4 groups of 1-3 digits separated by dots
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Pattern.test(ip);
}

// Helper function to extract IPv4 from a string (may contain multiple IPs)
function extractIPv4(ipString) {
  if (!ipString) return null;
  
  // Split by comma to handle multiple IPs
  const ips = ipString.split(',').map(ip => ip.trim());
  
  // Try to find IPv4 in the list
  // Usually the first IP is the client, but check all
  for (const ip of ips) {
    // Remove port if present
    const cleanIP = ip.split(':')[0].trim();
    // Remove brackets from IPv6
    const finalIP = cleanIP.replace(/^\[|\]$/g, '');
    
    // Check if it's IPv4
    if (isIPv4(finalIP)) {
      return finalIP;
    }
  }
  
  return null;
}

function getClientIP(request) {
  // Priority order for IP detection (IPv4 only):
  // 1. x-vercel-forwarded-for (Vercel's header - most reliable)
  // 2. x-forwarded-for (standard proxy header - first IP is usually client)
  // 3. x-real-ip (some proxies)
  // 4. cf-connecting-ip (Cloudflare)
  
  const forwarded = request.headers.get('x-forwarded-for');
  const vercelIP = request.headers.get('x-vercel-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');
  
  // Log all headers for debugging
  console.log('🔍 IP Detection Headers:', {
    'x-vercel-forwarded-for': vercelIP,
    'x-forwarded-for': forwarded,
    'x-real-ip': realIP,
    'cf-connecting-ip': cfConnectingIP,
    'request.ip': request.ip
  });
  
  // Try different headers in order of priority, extract IPv4 only
  let ip = null;
  
  // First try Vercel-specific header (most reliable for Vercel)
  if (vercelIP) {
    ip = extractIPv4(vercelIP);
    if (ip) {
      console.log('✅ Found IPv4 in x-vercel-forwarded-for:', ip);
    }
  }
  
  // Then try Cloudflare header
  if (!ip && cfConnectingIP) {
    ip = extractIPv4(cfConnectingIP);
    if (ip) {
      console.log('✅ Found IPv4 in cf-connecting-ip:', ip);
    }
  }
  
  // Then try standard forwarded header
  // x-forwarded-for format: "client, proxy1, proxy2"
  // First IP is usually the original client
  if (!ip && forwarded) {
    ip = extractIPv4(forwarded);
    if (ip) {
      console.log('✅ Found IPv4 in x-forwarded-for:', ip);
    }
  }
  
  // Then try real IP
  if (!ip && realIP) {
    ip = extractIPv4(realIP);
    if (ip) {
      console.log('✅ Found IPv4 in x-real-ip:', ip);
    }
  }
  
  // Fallback to request.ip (if it's IPv4)
  if (!ip && request.ip) {
    const cleanIP = request.ip.split(':')[0].trim().replace(/^\[|\]$/g, '');
    if (isIPv4(cleanIP)) {
      ip = cleanIP;
      console.log('✅ Found IPv4 in request.ip:', ip);
    }
  }
  
  // If we got an IP but it's not IPv4, log it but don't use it
  if (!ip) {
    // Check if we have any IPs but they're IPv6
    const allIPs = [vercelIP, forwarded, realIP, cfConnectingIP, request.ip].filter(Boolean);
    if (allIPs.length > 0) {
      console.warn('⚠️ Found IPs but none are IPv4:', allIPs);
    }
  }
  
  // If still no IPv4, return empty string (localhost)
  if (!ip || ip === 'unknown') {
    ip = '';
    console.log('📍 No IPv4 detected, using empty (localhost)');
  } else {
    console.log('📍 Final Detected IPv4:', ip);
  }
  
  return ip;
}

function checkCIDR(ip, cidr) {
  try {
    const [network, prefix] = cidr.split('/');
    const prefixLength = parseInt(prefix);
    
    const ipNum = ipToNumber(ip);
    const networkNum = ipToNumber(network);
    const mask = (0xFFFFFFFF << (32 - prefixLength)) >>> 0;
    
    return (ipNum & mask) === (networkNum & mask);
  } catch {
    return false;
  }
}

function ipToNumber(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

export async function GET(request) {
  try {
    const clientIP = getClientIP(request);
    
    // Default allowed IPs (including empty string for localhost/dev)
    const defaultIPs = ['127.0.0.1', '::1', 'localhost', 'unknown'];
    
    // Fetch allowed IPs from Firebase first (always fetch to show in UI)
    // Fetch allowed IPs from Firebase
    const q = query(collection(db, 'allowedIPs'));
    const querySnapshot = await getDocs(q);
    const allowedIPs = [];
    
    querySnapshot.forEach((doc) => {
      const ipData = doc.data();
      if (ipData.ip) {
        allowedIPs.push(ipData.ip);
      }
    });
    
    console.log('📥 Fetched from Firebase:', {
      totalDocs: querySnapshot.size,
      allowedIPs: allowedIPs,
      allowedIPsRaw: allowedIPs.map(ip => `"${ip}"`),
      clientIP: clientIP
    });

    // Helper function to check if IP is a private/local IP
    const isPrivateIP = (ip) => {
      if (!ip || ip === 'localhost' || ip === 'unknown') return true;
      
      const parts = ip.split('/')[0].split('.');
      if (parts.length !== 4) return false;
      
      const [a, b] = parts.map(Number);
      
      // 10.0.0.0/8
      if (a === 10) return true;
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
      // 127.0.0.0/8 (localhost)
      if (a === 127) return true;
      
      return false;
    };

    // Strict IP checking - only allow if IP is explicitly whitelisted
    // In production, do NOT allow localhost/unknown IPs automatically
    // Only allow localhost in development (when NODE_ENV is development)
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (!clientIP || clientIP === '' || clientIP === 'unknown') {
      if (isDevelopment) {
        // Allow localhost only in development
        console.log('✅ Allowing access for localhost/development IP:', clientIP || 'empty (localhost)');
        return NextResponse.json({ 
          allowed: true, 
          ip: clientIP || 'localhost',
          ipTrimmed: clientIP || 'localhost',
          ipLower: (clientIP || 'localhost').toLowerCase(),
          isLocalhost: true,
          allowedIPs: allowedIPs,
          allowedIPsCount: allowedIPs.length
        });
      } else {
        // In production, reject empty/unknown IPs
        console.log('❌ Rejecting empty/unknown IP in production');
        return NextResponse.json(
          { 
            allowed: false, 
            ip: clientIP || 'unknown',
            ipTrimmed: clientIP || 'unknown',
            ipLower: (clientIP || 'unknown').toLowerCase(),
            message: 'IP address could not be detected',
            allowedIPs: allowedIPs,
            allowedIPsCount: allowedIPs.length
          },
          { status: 403 }
        );
      }
    }
    
    // Check if it's a localhost IP (127.0.0.1, ::1) - only allow in development
    if (defaultIPs.includes(clientIP)) {
      if (isDevelopment) {
        console.log('✅ Allowing localhost IP in development:', clientIP);
        return NextResponse.json({ 
          allowed: true, 
          ip: clientIP,
          ipTrimmed: clientIP,
          ipLower: clientIP.toLowerCase(),
          isLocalhost: true,
          allowedIPs: allowedIPs,
          allowedIPsCount: allowedIPs.length
        });
      } else {
        // In production, localhost IPs must be explicitly whitelisted
        console.log('⚠️ Localhost IP detected in production - must be whitelisted:', clientIP);
      }
    }

    // Log if it's a private IP for debugging
    if (isPrivateIP(clientIP)) {
      console.log('🔒 Detected private/local IP:', clientIP);
    }

    // Validate that client IP is IPv4
    if (!isIPv4(clientIP)) {
      console.log('❌ Client IP is not IPv4:', clientIP);
      return NextResponse.json(
        { 
          allowed: false, 
          ip: clientIP,
          ipTrimmed: clientIP.trim(),
          ipLower: clientIP.trim().toLowerCase(),
          message: 'Only IPv4 addresses are supported', 
          allowedIPs: allowedIPs,
          allowedIPsCount: allowedIPs.length
        },
        { status: 403 }
      );
    }
    
    // Strict static IP checking - only allow if IP is explicitly whitelisted
    // No automatic allowances, no dynamic IPs - only static whitelisted IPv4 IPs
    const isAllowed = allowedIPs.some((allowedIP, index) => {
      // Skip if client IP is empty (shouldn't happen here, but safety check)
      if (!clientIP || clientIP === '') {
        console.log(`⏭️ Skipping check ${index}: client IP is empty`);
        return false;
      }
      
      // Clean both IPs for comparison (remove whitespace, convert to lowercase)
      const cleanClientIP = clientIP.trim().toLowerCase();
      const cleanAllowedIP = allowedIP.trim().toLowerCase();
      
      // Skip if allowed IP is empty
      if (!cleanAllowedIP || cleanAllowedIP === '') {
        console.log(`⏭️ Skipping check ${index}: allowed IP is empty`);
        return false;
      }
      
      // Skip if allowed IP is not IPv4 (unless it's CIDR notation)
      if (!cleanAllowedIP.includes('/') && !isIPv4(cleanAllowedIP)) {
        console.log(`⏭️ Skipping check ${index}: allowed IP is not IPv4: ${cleanAllowedIP}`);
        return false;
      }
      
      // Log each comparison attempt
      console.log(`🔍 Strict Static IPv4 Check [${index}]: "${cleanClientIP}" vs "${cleanAllowedIP}"`);
      console.log(`   Client IP (original): "${clientIP}"`);
      console.log(`   Allowed IP (original): "${allowedIP}"`);
      
      // Exact match only (case-insensitive, trimmed) - no partial matches
      if (cleanClientIP === cleanAllowedIP) {
        console.log(`✅ EXACT STATIC IPv4 MATCH! ${clientIP} === ${allowedIP}`);
        return true;
      }
      
      // CIDR notation support (for static IPv4 IP ranges only)
      if (cleanAllowedIP.includes('/')) {
        // Validate CIDR is IPv4
        const [network] = cleanAllowedIP.split('/');
        if (!isIPv4(network)) {
          console.log(`⏭️ Skipping CIDR check ${index}: CIDR network is not IPv4: ${network}`);
          return false;
        }
        
        const result = checkCIDR(cleanClientIP, cleanAllowedIP);
        if (result) {
          console.log(`✅ CIDR RANGE MATCH! ${clientIP} is within static IPv4 range ${allowedIP}`);
        } else {
          console.log(`❌ CIDR no match: ${clientIP} not in static range ${allowedIP}`);
        }
        return result;
      }
      
      console.log(`❌ No match: "${cleanClientIP}" !== "${cleanAllowedIP}" (strict static IPv4 check)`);
      return false;
    });

    if (!isAllowed) {
      // Log for debugging
      console.log('❌ IP not allowed:', clientIP);
      console.log('📋 Allowed IPs from Firebase:', allowedIPs);
      console.log('🔍 Comparison details:', {
        clientIP,
        clientIPTrimmed: clientIP.trim(),
        clientIPLower: clientIP.trim().toLowerCase(),
        allowedIPs,
        allowedIPsTrimmed: allowedIPs.map(ip => ip.trim()),
        allowedIPsLower: allowedIPs.map(ip => ip.trim().toLowerCase())
      });
      
      return NextResponse.json(
        { 
          allowed: false, 
          ip: clientIP,
          ipTrimmed: clientIP.trim(),
          ipLower: clientIP.trim().toLowerCase(),
          message: 'IP address not authorized', 
          allowedIPs: allowedIPs,
          allowedIPsTrimmed: allowedIPs.map(ip => ip.trim()),
          allowedIPsCount: allowedIPs.length
        },
        { status: 403 }
      );
    }

    console.log(`✅ Access granted for IP: ${clientIP}`);
    return NextResponse.json({ 
      allowed: true, 
      ip: clientIP,
      ipTrimmed: clientIP.trim(),
      ipLower: clientIP.trim().toLowerCase(),
      allowedIPs: allowedIPs,
      allowedIPsCount: allowedIPs.length,
      isLocalhost: false // Never set to true in production - only in development
    });
  } catch (error) {
    console.error('❌ Error checking IP:', error);
    // Fail closed - deny access on error for security
    // Only allow in development mode
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (isDevelopment) {
      console.warn('⚠️ Allowing access due to error in development mode');
      return NextResponse.json({ 
        allowed: true, 
        error: 'Error checking IP (development mode)',
        ip: 'unknown'
      });
    } else {
      // In production, deny access on error
      return NextResponse.json(
        { 
          allowed: false, 
          error: 'Error checking IP address',
          message: 'Unable to verify IP address. Access denied.',
          ip: 'unknown'
        },
        { status: 403 }
      );
    }
  }
}

