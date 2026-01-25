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

// Helper function to extract ALL IPv4s from a string (may contain multiple IPs)
function extractAllIPv4s(ipString) {
  if (!ipString) return [];
  
  // Split by comma to handle multiple IPs
  const ips = ipString.split(',').map(ip => ip.trim());
  const ipv4s = [];
  
  // Extract all IPv4 addresses
  for (const ip of ips) {
    // Remove port if present
    const cleanIP = ip.split(':')[0].trim();
    // Remove brackets from IPv6
    const finalIP = cleanIP.replace(/^\[|\]$/g, '');
    
    // Check if it's IPv4
    if (isIPv4(finalIP)) {
      ipv4s.push(finalIP);
    }
  }
  
  return ipv4s;
}

// Helper function to check if IP is likely a proxy/VPN/server IP
function isLikelyProxyIP(ip) {
  if (!ip) return false;
  
  // Known Vercel IP ranges (common proxy IPs)
  // These are examples - you might need to update based on actual Vercel IPs
  const proxyRanges = [
    /^76\.76\./, // Vercel
    /^76\.223\./, // Vercel
  ];
  
  // Check if IP matches known proxy patterns
  for (const pattern of proxyRanges) {
    if (pattern.test(ip)) {
      return true;
    }
  }
  
  return false;
}

// Helper function to extract IPv4 from a string (may contain multiple IPs)
// Tries to get the actual client IP, not proxy IP
function extractIPv4(ipString) {
  if (!ipString) return null;
  
  const allIPv4s = extractAllIPv4s(ipString);
  
  if (allIPv4s.length === 0) return null;
  if (allIPv4s.length === 1) return allIPv4s[0];
  
  // If multiple IPs, try to find the client IP (not proxy)
  // Strategy: Try the first IP, but if it looks like a proxy, try the last one
  const firstIP = allIPv4s[0];
  const lastIP = allIPv4s[allIPv4s.length - 1];
  
  // If first IP looks like a proxy, try last IP
  if (isLikelyProxyIP(firstIP)) {
    console.log(`⚠️ First IP looks like proxy (${firstIP}), trying last IP (${lastIP})`);
    return lastIP;
  }
  
  // Default to first IP (usually the client)
  return firstIP;
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
  
  // Collect ALL possible IPv4s from all headers for debugging
  const allPossibleIPs = [];
  if (vercelIP) allPossibleIPs.push(...extractAllIPv4s(vercelIP));
  if (cfConnectingIP) allPossibleIPs.push(...extractAllIPv4s(cfConnectingIP));
  if (forwarded) allPossibleIPs.push(...extractAllIPv4s(forwarded));
  if (realIP) allPossibleIPs.push(...extractAllIPv4s(realIP));
  if (request.ip) {
    const cleanIP = request.ip.split(':')[0].trim().replace(/^\[|\]$/g, '');
    if (isIPv4(cleanIP)) allPossibleIPs.push(cleanIP);
  }
  
  // Remove duplicates
  const uniqueIPs = [...new Set(allPossibleIPs)];
  
  // Log all headers and detected IPs for debugging
  console.log('🔍 IP Detection Headers:', {
    'x-vercel-forwarded-for': vercelIP,
    'x-forwarded-for': forwarded,
    'x-real-ip': realIP,
    'cf-connecting-ip': cfConnectingIP,
    'request.ip': request.ip
  });
  console.log('📋 All Detected IPv4 Addresses:', uniqueIPs);
  
  // Try different headers in order of priority, extract IPv4 only
  let ip = null;
  
  // First try x-forwarded-for (often has the real client IP)
  // In proxy chains, the LAST IP is sometimes the real client
  if (forwarded) {
    const forwardedIPs = extractAllIPv4s(forwarded);
    if (forwardedIPs.length > 0) {
      // Try last IP first (often the real client behind proxies)
      if (forwardedIPs.length > 1 && !isLikelyProxyIP(forwardedIPs[forwardedIPs.length - 1])) {
        ip = forwardedIPs[forwardedIPs.length - 1];
        console.log('✅ Using LAST IP from x-forwarded-for (likely real client):', ip);
      } else {
        // Try first IP
        ip = forwardedIPs[0];
        console.log('✅ Using FIRST IP from x-forwarded-for:', ip);
      }
    }
  }
  
  // Then try Vercel-specific header
  if (!ip && vercelIP) {
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
  
  // If still no IPv4, return empty string (localhost)
  if (!ip || ip === 'unknown') {
    ip = '';
    console.log('📍 No IPv4 detected, using empty (localhost)');
  } else {
    console.log('📍 Final Selected IPv4:', ip);
    if (isLikelyProxyIP(ip)) {
      console.warn('⚠️ WARNING: Selected IP looks like a proxy/VPN IP. All detected IPs:', uniqueIPs);
    }
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

// Helper function to get all detected IPv4 addresses from request headers
function getAllDetectedIPs(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const vercelIP = request.headers.get('x-vercel-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');
  
  const allPossibleIPs = [];
  if (vercelIP) allPossibleIPs.push(...extractAllIPv4s(vercelIP));
  if (cfConnectingIP) allPossibleIPs.push(...extractAllIPv4s(cfConnectingIP));
  if (forwarded) allPossibleIPs.push(...extractAllIPv4s(forwarded));
  if (realIP) allPossibleIPs.push(...extractAllIPv4s(realIP));
  if (request.ip) {
    const cleanIP = request.ip.split(':')[0].trim().replace(/^\[|\]$/g, '');
    if (isIPv4(cleanIP)) allPossibleIPs.push(cleanIP);
  }
  return [...new Set(allPossibleIPs)];
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
    
    // Get all detected IPs for debugging (reusable)
    const uniqueIPs = getAllDetectedIPs(request);
    
    console.log('📥 Fetched from Firebase:', {
      totalDocs: querySnapshot.size,
      allowedIPs: allowedIPs,
      allowedIPsRaw: allowedIPs.map(ip => `"${ip}"`),
      clientIP: clientIP,
      allDetectedIPs: uniqueIPs
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
      
      // uniqueIPs is already declared at the top of the function, reuse it
      // But we need fresh data, so get it again (this is inside if block, different scope)
      const deniedUniqueIPs = getAllDetectedIPs(request);
      
      return NextResponse.json(
        { 
          allowed: false, 
          ip: clientIP,
          ipTrimmed: clientIP.trim(),
          ipLower: clientIP.trim().toLowerCase(),
          message: 'IP address not authorized', 
          allowedIPs: allowedIPs,
          allowedIPsTrimmed: allowedIPs.map(ip => ip.trim()),
          allowedIPsCount: allowedIPs.length,
          allDetectedIPs: deniedUniqueIPs // Show all detected IPs so user can see alternatives
        },
        { status: 403 }
      );
    }

    // uniqueIPs is already declared at the top of the function, reuse it
    console.log(`✅ Access granted for IP: ${clientIP}`);
    return NextResponse.json({ 
      allowed: true, 
      ip: clientIP,
      ipTrimmed: clientIP.trim(),
      ipLower: clientIP.trim().toLowerCase(),
      allowedIPs: allowedIPs,
      allowedIPsCount: allowedIPs.length,
      isLocalhost: false, // Never set to true in production - only in development
      allDetectedIPs: uniqueIPs // Show all detected IPs (already declared at top)
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

