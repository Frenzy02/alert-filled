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
                detectedIP: data.ip || 'unknown',
                ipTrimmed: data.ipTrimmed || 'unknown',
                ipLower: data.ipLower || 'unknown',
                allowed: data.allowed || false,
                allowedIPs: data.allowedIPs || [],
                allowedIPsCount: data.allowedIPsCount || 0
            });
            setError('');
        } catch (err) {
            setError('Error fetching IP info: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert(`Copied: ${text}`);
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800">
                <div className="text-center text-white">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
                    <p className="mt-4">Detecting your IP address...</p>
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
                    <p className="text-lg opacity-90">Your detected IP address information</p>
                </header>

                {/* Content */}
                <div className="p-6 md:p-8">
                    {error ? (
                        <div className="p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg">
                            {error}
                        </div>
                    ) : ipInfo ? (
                        <div className="space-y-6">
                            {/* Main IP Display */}
                            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 p-6 rounded-lg border-2 border-purple-200 dark:border-purple-800">
                                <h2 className="text-2xl font-bold mb-4 text-gray-700 dark:text-gray-300">
                                    Your Detected IP Address
                                </h2>
                                <div className="flex items-center gap-4">
                                    <code className="text-3xl font-mono font-bold text-purple-600 dark:text-purple-400">
                                        {ipInfo.detectedIP}
                                    </code>
                                    <button
                                        onClick={() => copyToClipboard(ipInfo.detectedIP)}
                                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-all"
                                    >
                                        Copy
                                    </button>
                                </div>
                                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                                    This is the IP address detected by the system. Add this to your allowed IPs list.
                                </p>
                            </div>

                            {/* IP Details */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">IP (Trimmed)</h3>
                                    <code className="text-lg font-mono text-gray-800 dark:text-gray-200">
                                        {ipInfo.ipTrimmed}
                                    </code>
                                </div>
                                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">IP (Lowercase)</h3>
                                    <code className="text-lg font-mono text-gray-800 dark:text-gray-200">
                                        {ipInfo.ipLower}
                                    </code>
                                </div>
                            </div>

                            {/* Access Status */}
                            <div className={`p-4 rounded-lg ${ipInfo.allowed ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'}`}>
                                <h3 className="font-semibold mb-2 text-gray-700 dark:text-gray-300">
                                    Access Status: {ipInfo.allowed ? '✅ Allowed' : '❌ Not Allowed'}
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    {ipInfo.allowed 
                                        ? 'Your IP is in the whitelist. You can access the application.'
                                        : 'Your IP is not in the whitelist. Add it to the admin page to gain access.'}
                                </p>
                            </div>

                            {/* Allowed IPs List */}
                            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                <h3 className="font-semibold mb-3 text-gray-700 dark:text-gray-300">
                                    Allowed IPs in Database ({ipInfo.allowedIPsCount})
                                </h3>
                                {ipInfo.allowedIPs.length > 0 ? (
                                    <div className="space-y-2">
                                        {ipInfo.allowedIPs.map((ip, index) => (
                                            <div key={index} className="flex items-center justify-between p-2 bg-white dark:bg-gray-900 rounded border">
                                                <code className="font-mono text-gray-800 dark:text-gray-200">{ip}</code>
                                                <button
                                                    onClick={() => copyToClipboard(ip)}
                                                    className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-gray-500 dark:text-gray-400">No IPs in the database yet.</p>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <button
                                    onClick={fetchIPInfo}
                                    className="flex-1 px-6 py-3 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 transition-all"
                                >
                                    Refresh IP
                                </button>
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

