import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';

function getClientIP(request) {
  // Vercel uses specific headers for IP addresses
  const forwarded = request.headers.get('x-forwarded-for');
  const vercelIP = request.headers.get('x-vercel-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip'); // Cloudflare
  
  // Try different headers in order of priority
  let ip = vercelIP || 
           cfConnectingIP ||
           (forwarded ? forwarded.split(',')[0].trim() : null) ||
           realIP ||
           request.ip ||
           'unknown';
  
  // Clean up the IP (remove port if present)
  if (ip && ip !== 'unknown') {
    ip = ip.split(':')[0].trim();
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
    
    // If IP is empty, null, or unknown, allow access (localhost/development)
    if (!clientIP || clientIP === '' || clientIP === 'unknown' || defaultIPs.includes(clientIP)) {
      console.log('✅ Allowing access for localhost/development IP:', clientIP || 'empty (localhost)');
      return NextResponse.json({ 
        allowed: true, 
        ip: clientIP || 'localhost',
        isLocalhost: true 
      });
    }

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

    // Check if IP is allowed
    const isAllowed = allowedIPs.some(allowedIP => {
      // Skip if client IP is empty (shouldn't happen here, but safety check)
      if (!clientIP || clientIP === '') {
        return false;
      }
      
      // Clean both IPs for comparison (remove whitespace, convert to lowercase)
      const cleanClientIP = clientIP.trim().toLowerCase();
      const cleanAllowedIP = allowedIP.trim().toLowerCase();
      
      // Skip if allowed IP is empty
      if (!cleanAllowedIP || cleanAllowedIP === '') {
        return false;
      }
      
      // Exact match (case-insensitive, trimmed)
      if (cleanClientIP === cleanAllowedIP) {
        console.log(`✅ IP match found: ${clientIP} === ${allowedIP}`);
        return true;
      }
      
      // CIDR notation support
      if (cleanAllowedIP.includes('/')) {
        const result = checkCIDR(cleanClientIP, cleanAllowedIP);
        if (result) {
          console.log(`✅ CIDR match found: ${clientIP} in ${allowedIP}`);
        }
        return result;
      }
      
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

