'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function IPChecker({ children }) {
    const [isAllowed, setIsAllowed] = useState(null);
    const [loading, setLoading] = useState(true);
    const pathname = usePathname();

    useEffect(() => {
        // Allow admin page and my-ip page to bypass IP check
        if (pathname?.startsWith('/admin') || pathname?.startsWith('/my-ip')) {
            setIsAllowed(true);
            setLoading(false);
            return;
        }
        
        // Check IP for other pages
        checkIP();
    }, [pathname]);

    const checkIP = async () => {
        try {
            // Add cache-busting to ensure fresh IP check
            const response = await fetch('/api/check-ip', {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
            
            // Check if response is ok first
            if (!response.ok && response.status === 403) {
                const data = await response.json().catch(() => ({}));
                console.error('❌ API returned 403:', data);
                setIsAllowed(false);
                setLoading(false);
                return;
            }
            
            const data = await response.json();
            
            // Log for debugging
            console.log('🔍 IP Check Response:', data);
            console.log('📋 Your Detected IP:', data.ip);
            console.log('📋 IP (Trimmed):', data.ipTrimmed);
            console.log('📋 IP (Lowercase):', data.ipLower);
            console.log('✅ Allowed IPs in DB:', data.allowedIPs || []);
            console.log('📊 Total Allowed IPs:', data.allowedIPsCount || 0);
            console.log('✅ Allowed Status:', data.allowed);
            
            // Store detected IP in localStorage for debugging
            if (typeof window !== 'undefined' && data.ip) {
                localStorage.setItem('lastDetectedIP', data.ip);
            }
            
            // STRICT CHECK: Only allow if explicitly allowed by API
            // The API should only return allowed: true if IP is in whitelist
            // We NEVER allow based on isLocalhost flag - that's only for development
            if (data.allowed === true && data.isLocalhost !== true) {
                // Only allow if explicitly allowed AND not a localhost bypass
                console.log('✅ Access granted - IP is whitelisted');
                setIsAllowed(true);
                setLoading(false);
            } else {
                // Explicitly denied, not in whitelist, or localhost bypass attempt
                setIsAllowed(false);
                setLoading(false);
                // Show detailed error in console
                console.error('❌ Access denied!');
                console.error('Your IP:', data.ip);
                console.error('IP (trimmed):', data.ipTrimmed);
                console.error('IP (lowercase):', data.ipLower);
                console.error('Allowed IPs:', data.allowedIPs || []);
                console.error('Allowed IPs Count:', data.allowedIPsCount || 0);
                console.error('isLocalhost flag:', data.isLocalhost);
                if (data.isLocalhost === true) {
                    console.error('⚠️ SECURITY: Localhost bypass detected - access denied');
                }
                console.error('💡 TIP: Make sure the IP in the database matches exactly (including any spaces or case differences)');
            }
        } catch (error) {
            console.error('❌ Error checking IP:', error);
            // Fail closed - deny access on error for security
            // Only allow in development mode
            const isDevelopment = process.env.NODE_ENV === 'development';
            
            if (isDevelopment) {
                console.warn('⚠️ Allowing access due to error in development mode');
                setIsAllowed(true);
            } else {
                // In production, deny access on error
                console.error('❌ Access denied due to error in production');
                setIsAllowed(false);
            }
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Verifying access...</p>
                </div>
            </div>
        );
    }

    if (!isAllowed) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-red-100 to-orange-50 dark:from-gray-900 dark:via-red-900 dark:to-orange-900">
                <div className="text-center bg-white dark:bg-gray-800 p-10 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-2 border-red-200 dark:border-red-800">
                    {/* Icon */}
                    <div className="mb-6 flex justify-center">
                        <div className="relative">
                            <div className="absolute inset-0 bg-red-200 dark:bg-red-900 rounded-full blur-xl opacity-50 animate-pulse"></div>
                            <div className="relative bg-red-100 dark:bg-red-800 p-6 rounded-full">
                                <svg 
                                    className="w-16 h-16 text-red-600 dark:text-red-400" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    viewBox="0 0 24 24"
                                >
                                    <path 
                                        strokeLinecap="round" 
                                        strokeLinejoin="round" 
                                        strokeWidth={2} 
                                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
                                    />
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className="text-4xl font-bold text-red-600 dark:text-red-400 mb-3">
                        Access Denied
                    </h1>
                    
                    {/* Subtitle */}
                    <p className="text-lg text-gray-700 dark:text-gray-300 mb-6">
                        Your IP address is not authorized to access this application.
                    </p>

                    {/* Info Box */}
                    <div className="bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 p-5 rounded-xl mb-6 border border-red-200 dark:border-red-800">
                        <div className="flex items-start gap-3">
                            <svg 
                                className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                            >
                                <path 
                                    strokeLinecap="round" 
                                    strokeLinejoin="round" 
                                    strokeWidth={2} 
                                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                                />
                            </svg>
                            <div className="text-left flex-1">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
                                    Detected IP Address:
                                </p>
                                <p className="text-xs text-gray-600 dark:text-gray-400 font-mono break-all bg-white dark:bg-gray-900 p-2 rounded border border-red-200 dark:border-red-800">
                                    {typeof window !== 'undefined' ? (localStorage.getItem('lastDetectedIP') || 'Unable to detect') : 'Loading...'}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-500 mt-3 italic">
                                    Please contact the administrator to request access.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Decorative Elements */}
                    <div className="flex justify-center gap-2 mt-6">
                        <div className="w-2 h-2 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                        <div className="w-2 h-2 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2 h-2 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

