'use client';

import { useState, useEffect } from 'react';

export default function MyIPPage() {
    const [ipInfo, setIpInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchIPInfo();
    }, []);

    const fetchIPInfo = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/check-ip');
            const data = await response.json();
            
            setIpInfo({
                allowedIPsCount: data.allowedIPsCount || 0
            });
            setError('');
        } catch (err) {
            setError('Error fetching IP info: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800">
                <div className="text-center text-white">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
                    <p className="mt-4">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800 p-4 md:p-8">
            <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <header className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white p-8 text-center">
                    <h1 className="text-4xl md:text-5xl font-bold mb-2">🌐 My IP Address</h1>
                    <p className="text-lg opacity-90">IP whitelist information</p>
                </header>

                {/* Content */}
                <div className="p-6 md:p-8">
                    {error ? (
                        <div className="p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg">
                            {error}
                        </div>
                    ) : ipInfo ? (
                        <div className="space-y-6">
                            {/* Allowed IPs Count */}
                            <div className="p-6 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-lg border-2 border-purple-200 dark:border-purple-800 text-center">
                                <h3 className="text-2xl font-bold text-gray-700 dark:text-gray-300 mb-2">
                                    Allowed IPs in Database ({ipInfo.allowedIPsCount})
                                </h3>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <a
                                    href="/admin"
                                    className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all text-center"
                                >
                                    Go to Admin
                                </a>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

