import { NextResponse } from 'next/server';

// Get allowed IPs from environment variables
// In production, you should sync this with Firebase periodically or use edge config
function getAllowedIPs() {
  // Default: allow localhost for development
  const defaultIPs = ['127.0.0.1', '::1', 'localhost'];
  
  // Get IPs from environment variables (you can update these from admin page)
  const envIPs = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',').map(ip => ip.trim()) : [];
  
  return [...defaultIPs, ...envIPs];
}

export function middleware(request) {
  // Get client IP address
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 
             request.headers.get('x-real-ip') || 
             request.ip || 
             'unknown';

  // Allow access to admin page and API routes
  if (request.nextUrl.pathname.startsWith('/admin') || 
      request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Get allowed IPs
  const allowedIPs = getAllowedIPs();

  // Check if IP is allowed
  const isAllowed = allowedIPs.some(allowedIP => {
    // Exact match
    if (ip === allowedIP) return true;
    // CIDR notation support (basic)
    if (allowedIP.includes('/')) {
      // Simple CIDR check (you might want to use a library for production)
      return checkCIDR(ip, allowedIP);
    }
    return false;
  });

  if (!isAllowed && ip !== 'unknown') {
    return new NextResponse('Access Denied: Your IP address is not authorized to access this application.', {
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  return NextResponse.next();
}

// Simple CIDR check (basic implementation)
function checkCIDR(ip, cidr) {
  try {
    const [network, prefix] = cidr.split('/');
    const prefixLength = parseInt(prefix);
    
    // Convert IPs to numbers for comparison
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

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};

