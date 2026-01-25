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
            const response = await fetch('/api/check-ip', {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
            const data = await response.json();
            
            setIpInfo({
                selectedIP: data.ip || 'Unknown',
                ipTrimmed: data.ipTrimmed || 'Unknown',
                ipLower: data.ipLower || 'Unknown',
                allDetectedIPs: data.allDetectedIPs || [],
                allowedIPs: data.allowedIPs || [],
                allowedIPsCount: data.allowedIPsCount || 0,
                isAllowed: data.allowed || false
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
                            {/* Important Notice */}
                            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 dark:border-yellow-600 rounded-lg">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div>
                                        <h3 className="font-semibold text-yellow-800 dark:text-yellow-300 mb-1">
                                            ⚠️ Important: Public IP vs Local IP
                                        </h3>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-400">
                                            Ang <code className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">ipconfig</code> ay nagpapakita ng <strong>local/private IP</strong> (hal. 192.168.x.x) na para sa local network lang. 
                                            Ang web app ay nangangailangan ng <strong>public IP</strong> na nakikita ng internet. I-whitelist ang <strong>Public IP</strong> na nakalista sa ibaba.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Selected Public IP */}
                            <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border-2 border-blue-200 dark:border-blue-800">
                                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                    🌐 Your Public IP Address (Selected)
                                </h3>
                                <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border border-blue-300 dark:border-blue-700">
                                    <p className="text-2xl font-mono font-bold text-blue-600 dark:text-blue-400 text-center break-all">
                                        {ipInfo.selectedIP}
                                    </p>
                                    {ipInfo.isAllowed ? (
                                        <p className="text-center mt-2 text-green-600 dark:text-green-400 font-semibold">
                                            ✅ This IP is whitelisted
                                        </p>
                                    ) : (
                                        <p className="text-center mt-2 text-red-600 dark:text-red-400 font-semibold">
                                            ❌ This IP is NOT whitelisted
                                        </p>
                                    )}
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mt-3 text-center">
                                    Ito ang IP address na kailangan mong i-whitelist sa admin page
                                </p>
                            </div>

                            {/* All Detected IPs */}
                            {ipInfo.allDetectedIPs && ipInfo.allDetectedIPs.length > 1 && (
                                <div className="p-6 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-lg border-2 border-purple-200 dark:border-purple-800">
                                    <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                        📋 All Detected Public IP Addresses
                                    </h3>
                                    <div className="space-y-2">
                                        {ipInfo.allDetectedIPs.map((ip, idx) => (
                                            <div
                                                key={idx}
                                                className={`p-3 rounded-lg border font-mono text-sm ${
                                                    ip === ipInfo.selectedIP
                                                        ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600'
                                                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className={ip === ipInfo.selectedIP ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}>
                                                        {ip === ipInfo.selectedIP && <span className="mr-2">→</span>}
                                                        {ip}
                                                    </span>
                                                    {ip === ipInfo.selectedIP && (
                                                        <span className="text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-1 rounded">
                                                            Selected
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-3 italic">
                                        Kung ang selected IP ay hindi tama, subukan mong i-whitelist ang iba pang detected IPs
                                    </p>
                                </div>
                            )}

                            {/* Allowed IPs List */}
                            <div className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border-2 border-green-200 dark:border-green-800">
                                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                    ✅ Whitelisted IPs ({ipInfo.allowedIPsCount})
                                </h3>
                                {ipInfo.allowedIPs && ipInfo.allowedIPs.length > 0 ? (
                                    <div className="space-y-2">
                                        {ipInfo.allowedIPs.map((ip, idx) => (
                                            <div
                                                key={idx}
                                                className="bg-white dark:bg-gray-900 p-3 rounded-lg border border-green-300 dark:border-green-700 font-mono text-sm"
                                            >
                                                {ip}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-gray-600 dark:text-gray-400 text-center py-4">
                                        No IPs whitelisted yet
                                    </p>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <a
                                    href="/admin"
                                    className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all text-center"
                                >
                                    Go to Admin to Whitelist IP
                                </a>
                                <button
                                    onClick={fetchIPInfo}
                                    className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
                                >
                                    Refresh
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

