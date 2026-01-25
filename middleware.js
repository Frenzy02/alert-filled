import { NextResponse } from 'next/server';

// Note: Middleware runs at the edge and cannot directly access Firebase
// So we'll use a simpler approach - allow access if IP check API would allow it
// The actual IP checking is done in the IPChecker component and API route

export function middleware(request) {
  // Allow access to admin page, my-ip page, and API routes
  // These pages handle their own authentication/IP checking
  if (request.nextUrl.pathname.startsWith('/admin') || 
      request.nextUrl.pathname.startsWith('/my-ip') ||
      request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // For other pages, we'll let the IPChecker component handle the IP checking
  // The middleware will just pass through and let the client-side component check
  // This allows Firebase to be checked properly on the client/API side
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

