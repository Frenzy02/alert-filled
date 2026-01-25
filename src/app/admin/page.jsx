'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';

export default function AdminPage() {
    const [allowedIPs, setAllowedIPs] = useState([]);
    const [newIP, setNewIP] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [ipCheckLoading, setIpCheckLoading] = useState(true);
    const [ipAllowed, setIpAllowed] = useState(false);
    const [password, setPassword] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const router = useRouter();

    // Check if already authenticated
    useEffect(() => {
        const authStatus = localStorage.getItem('admin_authenticated');
        if (authStatus === 'true') {
            setIsAuthenticated(true);
            setShowPasswordForm(false);
        } else {
            setShowPasswordForm(true);
        }
    }, []);

    // Check IP access if authenticated
    useEffect(() => {
        if (isAuthenticated) {
            checkIPAccess();
        }
    }, [isAuthenticated]);

    // Fetch allowed IPs from Firebase
    const fetchAllowedIPs = async () => {
        try {
            setLoading(true);
            const q = query(collection(db, 'allowedIPs'), orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            const ips = [];
            querySnapshot.forEach((docSnap) => {
                ips.push({
                    id: docSnap.id,
                    ...docSnap.data()
                });
            });
            setAllowedIPs(ips);
            setError('');
        } catch (err) {
            setError('Failed to fetch IP addresses: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await fetch('/api/admin-auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password }),
            });
            
            const data = await response.json();
            
            if (data.authenticated) {
                setIsAuthenticated(true);
                setShowPasswordForm(false);
                localStorage.setItem('admin_authenticated', 'true');
                setPassword('');
                setError('');
                // Now check IP access
                checkIPAccess();
            } else {
                setError('Incorrect password. Please try again.');
                setPassword('');
            }
        } catch (error) {
            setError('Error authenticating: ' + error.message);
        }
    };

    const checkIPAccess = async () => {
        try {
            const response = await fetch('/api/check-ip');
            const data = await response.json();
            
            // Log for debugging
            console.log('IP Check Response:', data);
            
            if (response.status === 403 || !data.allowed) {
                setIpAllowed(false);
                setIpCheckLoading(false);
                // Show the detected IP in error message for debugging
                const ipInfo = `Detected IP: ${data.ip || 'unknown'}\nTrimmed: ${data.ipTrimmed || 'unknown'}\nLowercase: ${data.ipLower || 'unknown'}\n\nAllowed IPs in database: ${data.allowedIPsCount || 0}\n${data.allowedIPs ? data.allowedIPs.join(', ') : 'None'}`;
                setError(`Your IP is not in the whitelist.\n\n${ipInfo}\n\nYou can still manage IPs with password authentication.`);
                console.log('IP Check Details:', data);
            } else {
                setIpAllowed(true);
                setIpCheckLoading(false);
                // Fetch IPs after access is confirmed
                await fetchAllowedIPs();
            }
        } catch (error) {
            console.error('Error checking IP:', error);
            setIpAllowed(false);
            setIpCheckLoading(false);
            // Don't show error if authenticated with password
            if (isAuthenticated) {
                await fetchAllowedIPs();
            }
        }
    };

    // Helper function to validate IP address
    const isValidIP = (ip) => {
        const trimmed = ip.trim();
        
        // Allow localhost
        if (trimmed === 'localhost') return true;
        
        // IPv4 validation (with CIDR support)
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
        if (ipv4Regex.test(trimmed)) {
            // Check if it's a valid IP (each octet 0-255)
            const parts = trimmed.split('/')[0].split('.');
            const valid = parts.every(part => {
                const num = parseInt(part, 10);
                return num >= 0 && num <= 255;
            });
            
            // Check CIDR prefix if present
            if (trimmed.includes('/')) {
                const prefix = parseInt(trimmed.split('/')[1], 10);
                if (prefix < 0 || prefix > 32) return false;
            }
            
            return valid;
        }
        
        // IPv6 validation (basic)
        const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        if (ipv6Regex.test(trimmed)) return true;
        
        return false;
    };

    // Helper function to check if IP is a private/local IP
    const isPrivateIP = (ip) => {
        if (!ip || ip === 'localhost') return true;
        
        const parts = ip.split('/')[0].split('.');
        if (parts.length !== 4) return false;
        
        const [a, b, c] = parts.map(Number);
        
        // 10.0.0.0/8
        if (a === 10) return true;
        // 172.16.0.0/12
        if (a === 172 && b >= 16 && b <= 31) return true;
        // 192.168.0.0/16
        if (a === 192 && b === 168) return true;
        // 127.0.0.0/8 (localhost)
        if (a === 127) return true;
        
        return false;
    };

    // Helper function to convert IP to /24 CIDR
    const convertToCIDR24 = (ip) => {
        if (!ip || ip.includes('/')) return ip; // Already CIDR or invalid
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
        }
        return ip;
    };

    const handleAddIP = async () => {
        if (!newIP.trim()) {
            setError('Please enter an IP address');
            return;
        }

        let trimmedIP = newIP.trim();
        
        // Auto-convert to /24 CIDR if it's a regular IP (not already CIDR)
        if (!trimmedIP.includes('/')) {
            const parts = trimmedIP.split('.');
            if (parts.length === 4) {
                // Convert to /24 CIDR automatically
                trimmedIP = convertToCIDR24(trimmedIP);
                setSuccess(`Auto-converted to CIDR: ${trimmedIP}`);
            }
        }

        // Validate IP format
        if (!isValidIP(trimmedIP)) {
            setError('Invalid IP address format. Use IPv4 (e.g., 192.168.1.1) or CIDR (e.g., 192.168.1.0/24)');
            return;
        }

        // Check for duplicates
        const isDuplicate = allowedIPs.some(item => item.ip === trimmedIP);
        if (isDuplicate) {
            setError('This IP address is already in the whitelist');
            return;
        }

        try {
            await addDoc(collection(db, 'allowedIPs'), {
                ip: trimmedIP,
                createdAt: new Date().toISOString(),
                createdBy: 'admin',
                isPrivate: isPrivateIP(trimmedIP) // Mark if it's a private/local IP
            });
            
            setNewIP('');
            setSuccess(`IP address added successfully! (Saved as: ${trimmedIP})`);
            setError('');
            setTimeout(() => setSuccess(''), 5000);
            fetchAllowedIPs();
        } catch (err) {
            setError('Failed to add IP address: ' + err.message);
        }
    };

    const handleDeleteIP = async (id) => {
        if (!confirm('Are you sure you want to remove this IP address?')) {
            return;
        }

        try {
            await deleteDoc(doc(db, 'allowedIPs', id));
            setSuccess('IP address removed successfully!');
            setError('');
            setTimeout(() => setSuccess(''), 3000);
            fetchAllowedIPs();
        } catch (err) {
            setError('Failed to remove IP address: ' + err.message);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    // Show password form if not authenticated
    if (showPasswordForm) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800 p-4">
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 max-w-md w-full">
                    <h1 className="text-3xl font-bold text-center mb-2 text-gray-700 dark:text-gray-300">🔐 Admin Access</h1>
                    <p className="text-center text-gray-500 dark:text-gray-400 mb-6">
                        Enter password to access admin panel
                    </p>
                    <form onSubmit={handlePasswordSubmit}>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter admin password"
                            className="w-full p-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-800 dark:text-gray-100 mb-4"
                            required
                            autoFocus
                        />
                        <button
                            type="submit"
                            className="w-full bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-6 py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all"
                        >
                            Login
                        </button>
                    </form>
                    {error && (
                        <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg text-sm">
                            {error}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Show loading while checking IP
    if (ipCheckLoading && isAuthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Verifying access...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800 p-4 md:p-8">
            <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <header className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white p-8 text-center">
                    <div className="flex justify-between items-center mb-2">
                        <h1 className="text-4xl md:text-5xl font-bold">🔐 IP Access Control</h1>
                        <button
                            onClick={() => {
                                localStorage.removeItem('admin_authenticated');
                                setIsAuthenticated(false);
                                setShowPasswordForm(true);
                            }}
                            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm transition-all"
                        >
                            Logout
                        </button>
                    </div>
                    <p className="text-lg opacity-90">Manage allowed IP addresses for the application</p>
                    {!ipAllowed && isAuthenticated && (
                        <p className="text-sm opacity-75 mt-2">
                            ⚠️ Accessing via password authentication (IP not whitelisted)
                        </p>
                    )}
                </header>

                {/* Main Content */}
                <div className="p-6 md:p-8">
                    {/* Add IP Section */}
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold mb-4 text-gray-700 dark:text-gray-300">Add New IP Address</h2>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={newIP}
                                onChange={(e) => setNewIP(e.target.value)}
                                placeholder="Enter IP address (e.g., 192.168.1.1 or 192.168.1.0/24)"
                                className="flex-1 p-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-800 dark:text-gray-100"
                                onKeyPress={(e) => e.key === 'Enter' && handleAddIP()}
                            />
                            <button
                                onClick={handleAddIP}
                                className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-6 py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all transform hover:-translate-y-0.5 hover:shadow-lg"
                            >
                                Add IP
                            </button>
                        </div>
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                            💡 <strong>Tip:</strong> Regular IPs ay automatic na i-convert sa /24 CIDR range (hal. 139.135.192.120 → 139.135.192.0/24)
                            <br />
                            • Maglagay ng IP: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">139.135.192.120</code> → Auto-convert sa <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">139.135.192.0/24</code>
                            <br />
                            • O maglagay ng CIDR diretso: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">192.168.1.0/24</code>
                        </p>
                    </div>

                    {/* IP List */}
                    <div>
                        <h2 className="text-2xl font-bold mb-4 text-gray-700 dark:text-gray-300">
                            Allowed IP Addresses ({allowedIPs.length})
                        </h2>
                        
                        {loading ? (
                            <div className="text-center py-8 text-gray-500">Loading...</div>
                        ) : allowedIPs.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                No IP addresses configured. Add one above to get started.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse border border-gray-300 dark:border-gray-600">
                                    <thead>
                                        <tr className="bg-gray-100 dark:bg-gray-800">
                                            <th className="border border-gray-300 dark:border-gray-600 p-3 text-left">IP Address</th>
                                            <th className="border border-gray-300 dark:border-gray-600 p-3 text-left">Added On</th>
                                            <th className="border border-gray-300 dark:border-gray-600 p-3 text-center">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allowedIPs.map((item) => (
                                            <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                                <td className="border border-gray-300 dark:border-gray-600 p-3 font-mono">
                                                    {item.ip}
                                                </td>
                                                <td className="border border-gray-300 dark:border-gray-600 p-3">
                                                    {formatDate(item.createdAt)}
                                                </td>
                                                <td className="border border-gray-300 dark:border-gray-600 p-3 text-center">
                                                    <button
                                                        onClick={() => handleDeleteIP(item.id)}
                                                        className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition-all"
                                                    >
                                                        Remove
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Messages */}
                    {error && (
                        <div className="mt-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="mt-6 p-4 bg-green-100 dark:bg-green-900/30 border border-green-400 dark:border-green-700 text-green-700 dark:text-green-300 rounded-lg">
                            {success}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

