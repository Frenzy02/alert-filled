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
    
    // Default allowed IPs
    const defaultIPs = ['127.0.0.1', '::1', 'localhost', 'unknown'];
    
    // Check if IP is in default list
    if (defaultIPs.includes(clientIP)) {
      return NextResponse.json({ allowed: true, ip: clientIP });
    }

    // Fetch allowed IPs from Firebase
    const q = query(collection(db, 'allowedIPs'));
    const querySnapshot = await getDocs(q);
    const allowedIPs = [];
    
    querySnapshot.forEach((doc) => {
      allowedIPs.push(doc.data().ip);
    });

    // Check if IP is allowed
    const isAllowed = allowedIPs.some(allowedIP => {
      // Exact match
      if (clientIP === allowedIP) return true;
      // CIDR notation support
      if (allowedIP.includes('/')) {
        return checkCIDR(clientIP, allowedIP);
      }
      return false;
    });

    if (!isAllowed) {
      return NextResponse.json(
        { allowed: false, ip: clientIP, message: 'IP address not authorized' },
        { status: 403 }
      );
    }

    return NextResponse.json({ allowed: true, ip: clientIP });
  } catch (error) {
    console.error('Error checking IP:', error);
    // On error, allow access (fail open) - you might want to change this
    return NextResponse.json({ allowed: true, error: 'Error checking IP' });
  }
}

