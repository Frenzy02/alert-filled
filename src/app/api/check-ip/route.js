import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';

function getClientIP(request) {
  // Vercel uses specific headers for IP addresses
  // Priority order for Vercel:
  // 1. x-vercel-forwarded-for (Vercel's header)
  // 2. x-forwarded-for (standard proxy header)
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
  
  // Try different headers in order of priority
  let ip = null;
  
  // First try Vercel-specific header
  if (vercelIP) {
    ip = vercelIP.split(',')[0].trim();
  }
  // Then try Cloudflare
  else if (cfConnectingIP) {
    ip = cfConnectingIP.split(',')[0].trim();
  }
  // Then try standard forwarded header
  else if (forwarded) {
    ip = forwarded.split(',')[0].trim();
  }
  // Then try real IP
  else if (realIP) {
    ip = realIP.trim();
  }
  // Fallback to request.ip
  else if (request.ip) {
    ip = request.ip;
  }
  
  // Clean up the IP (remove port if present)
  if (ip && ip !== 'unknown') {
    ip = ip.split(':')[0].trim();
    // Remove any brackets from IPv6
    ip = ip.replace(/^\[|\]$/g, '');
  }
  
  // If still no IP, return empty string (localhost)
  if (!ip || ip === 'unknown') {
    ip = '';
  }
  
  console.log('📍 Final Detected IP:', ip || 'empty (localhost)');
  
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

    // If IP is empty, null, or unknown, allow access (localhost/development)
    // But still return the allowed IPs list for display
    if (!clientIP || clientIP === '' || clientIP === 'unknown' || defaultIPs.includes(clientIP)) {
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
    }

    // Log if it's a private IP for debugging
    if (isPrivateIP(clientIP)) {
      console.log('🔒 Detected private/local IP:', clientIP);
    }

    // Check if IP is allowed (improved matching with detailed logging)
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
      
      // Log each comparison attempt
      console.log(`🔍 Comparing [${index}]: "${cleanClientIP}" vs "${cleanAllowedIP}"`);
      console.log(`   Original client: "${clientIP}"`);
      console.log(`   Original allowed: "${allowedIP}"`);
      
      // Exact match (case-insensitive, trimmed)
      if (cleanClientIP === cleanAllowedIP) {
        console.log(`✅ EXACT MATCH FOUND! ${clientIP} === ${allowedIP}`);
        return true;
      }
      
      // CIDR notation support
      if (cleanAllowedIP.includes('/')) {
        const result = checkCIDR(cleanClientIP, cleanAllowedIP);
        if (result) {
          console.log(`✅ CIDR MATCH FOUND! ${clientIP} in ${allowedIP}`);
        } else {
          console.log(`❌ CIDR no match: ${clientIP} not in ${allowedIP}`);
        }
        return result;
      }
      
      console.log(`❌ No match: "${cleanClientIP}" !== "${cleanAllowedIP}"`);
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
      allowedIPs: allowedIPs 
    });
  } catch (error) {
    console.error('Error checking IP:', error);
    // On error, allow access (fail open) - you might want to change this
    return NextResponse.json({ allowed: true, error: 'Error checking IP' });
  }
}

