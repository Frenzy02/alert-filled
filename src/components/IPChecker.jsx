'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function IPChecker({ children }) {
    const [isAllowed, setIsAllowed] = useState(null);
    const [loading, setLoading] = useState(true);
    const pathname = usePathname();

    useEffect(() => {
        // Check IP for all pages including admin
        checkIP();
    }, [pathname]);

    const checkIP = async () => {
        try {
            const response = await fetch('/api/check-ip');
            const data = await response.json();
            
            if (response.status === 403 || !data.allowed) {
                setIsAllowed(false);
                setLoading(false);
            } else {
                setIsAllowed(true);
                setLoading(false);
            }
        } catch (error) {
            console.error('Error checking IP:', error);
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
                    <p className="text-sm text-gray-500">
                        Please contact the administrator to request access.
                    </p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

