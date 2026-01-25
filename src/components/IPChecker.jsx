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
            const response = await fetch('/api/check-ip');
            const data = await response.json();
            
            // Log for debugging
            console.log('🔍 IP Check Response:', data);
            console.log('📋 Your Detected IP:', data.ip);
            console.log('📋 IP (Trimmed):', data.ipTrimmed);
            console.log('📋 IP (Lowercase):', data.ipLower);
            console.log('✅ Allowed IPs in DB:', data.allowedIPs || []);
            console.log('📊 Total Allowed IPs:', data.allowedIPsCount || 0);
            
            // Store detected IP in localStorage for debugging
            if (typeof window !== 'undefined' && data.ip) {
                localStorage.setItem('lastDetectedIP', data.ip);
            }
            
            if (response.status === 403 || !data.allowed) {
                setIsAllowed(false);
                setLoading(false);
                // Show detailed error in console
                console.error('❌ Access denied!');
                console.error('Your IP:', data.ip);
                console.error('IP (trimmed):', data.ipTrimmed);
                console.error('IP (lowercase):', data.ipLower);
                console.error('Allowed IPs:', data.allowedIPs || []);
                console.error('Allowed IPs (trimmed):', data.allowedIPsTrimmed || []);
                console.error('💡 TIP: Make sure the IP in the database matches exactly (including any spaces or case differences)');
            } else {
                console.log('✅ Access granted!');
                setIsAllowed(true);
                setLoading(false);
            }
        } catch (error) {
            console.error('❌ Error checking IP:', error);
            setIsAllowed(false);
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
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <div className="text-center bg-white p-8 rounded-lg shadow-lg max-w-md">
                    <h1 className="text-3xl font-bold text-red-600 mb-4">Access Denied</h1>
                    <p className="text-gray-700 mb-4">
                        Your IP address is not authorized to access this application.
                    </p>
                    <div className="bg-gray-50 p-4 rounded-lg mb-4 text-left">
                        <p className="text-sm font-semibold mb-2">Debug Info:</p>
                        <p className="text-xs text-gray-600 font-mono break-all">
                            Detected IP: {typeof window !== 'undefined' ? (localStorage.getItem('lastDetectedIP') || 'Check console') : 'Loading...'}
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                            Check browser console (F12) for more details
                        </p>
                    </div>
                    <div className="flex gap-2 justify-center">
                        <a
                            href="/my-ip"
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-all text-sm"
                        >
                            Check My IP
                        </a>
                        <a
                            href="/admin"
                            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all text-sm"
                        >
                            Admin Login
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

