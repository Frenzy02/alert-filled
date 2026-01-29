'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, query, orderBy, updateDoc } from 'firebase/firestore';
import AddFormatModal from '@/components/AddFormatModal';

export default function AdminPage() {
    const [allowedIPs, setAllowedIPs] = useState([]);
    const [newIP, setNewIP] = useState('');
    const [userName, setUserName] = useState('');
    const [editingIP, setEditingIP] = useState(null);
    const [editIP, setEditIP] = useState('');
    const [editUserName, setEditUserName] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [ipCheckLoading, setIpCheckLoading] = useState(true);
    const [ipAllowed, setIpAllowed] = useState(false);
    const [password, setPassword] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [fieldMappings, setFieldMappings] = useState([]);
    const [newMappingLabel, setNewMappingLabel] = useState('');
    const [newMappingPath, setNewMappingPath] = useState('');
    const [mappingsLoading, setMappingsLoading] = useState(false);
    const [alertFormats, setAlertFormats] = useState([]);
    const [formatsLoading, setFormatsLoading] = useState(false);
    const [showFormatModal, setShowFormatModal] = useState(false);
    const [formatToEdit, setFormatToEdit] = useState(null);
    const [activeTab, setActiveTab] = useState('formats'); // 'formats' | 'mappings' | 'ips' | 'whitelistAlerts'
    const [searchFormats, setSearchFormats] = useState('');
    const [searchMappings, setSearchMappings] = useState('');
    const [searchIPs, setSearchIPs] = useState('');
    const [searchWhitelistAlerts, setSearchWhitelistAlerts] = useState('');
    // Whitelist Alert tab (single text block, parsed on save)
    const [whitelistAlerts, setWhitelistAlerts] = useState([]);
    const [whitelistAlertsLoading, setWhitelistAlertsLoading] = useState(false);
    const [newWhitelistText, setNewWhitelistText] = useState('');
    const [showWhitelistModal, setShowWhitelistModal] = useState(false);
    const [editingWhitelistId, setEditingWhitelistId] = useState(null);
    const [editAlertTitle, setEditAlertTitle] = useState('');
    const [editProcessName, setEditProcessName] = useState('');
    const [editDeviceName, setEditDeviceName] = useState('');
    const [editTenantName, setEditTenantName] = useState('');
    const [editAlertIP, setEditAlertIP] = useState('');
    const [editReason, setEditReason] = useState('');
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
            fetchFieldMappings();
            fetchAlertFormats();
            fetchWhitelistAlerts();
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

        if (!userName.trim()) {
            setError('Please enter a user name');
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
                userName: userName.trim(),
                createdAt: new Date().toISOString(),
                createdBy: 'admin',
                isPrivate: isPrivateIP(trimmedIP) // Mark if it's a private/local IP
            });
            
            setNewIP('');
            setUserName('');
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

    const handleStartEdit = (item) => {
        setEditingIP(item.id);
        setEditIP(item.ip);
        setEditUserName(item.userName || '');
    };

    const handleCancelEdit = () => {
        setEditingIP(null);
        setEditIP('');
        setEditUserName('');
    };

    const handleSaveEdit = async (id) => {
        if (!editIP.trim()) {
            setError('Please enter an IP address');
            return;
        }

        if (!editUserName.trim()) {
            setError('Please enter a user name');
            return;
        }

        let trimmedIP = editIP.trim();
        
        // Auto-convert to /24 CIDR if it's a regular IP (not already CIDR)
        if (!trimmedIP.includes('/')) {
            const parts = trimmedIP.split('.');
            if (parts.length === 4) {
                // Convert to /24 CIDR automatically
                trimmedIP = convertToCIDR24(trimmedIP);
            }
        }

        // Validate IP format
        if (!isValidIP(trimmedIP)) {
            setError('Invalid IP address format. Use IPv4 (e.g., 192.168.1.1) or CIDR (e.g., 192.168.1.0/24)');
            return;
        }

        // Check for duplicates (excluding current item)
        const isDuplicate = allowedIPs.some(item => item.ip === trimmedIP && item.id !== id);
        if (isDuplicate) {
            setError('This IP address is already in the whitelist');
            return;
        }

        try {
            await updateDoc(doc(db, 'allowedIPs', id), {
                ip: trimmedIP,
                userName: editUserName.trim(),
                updatedAt: new Date().toISOString()
            });
            
            setSuccess('IP address updated successfully!');
            setError('');
            setTimeout(() => setSuccess(''), 3000);
            handleCancelEdit();
            fetchAllowedIPs();
        } catch (err) {
            setError('Failed to update IP address: ' + err.message);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    // Fetch field mappings from Firebase
    const fetchFieldMappings = async () => {
        try {
            setMappingsLoading(true);
            const q = query(collection(db, 'fieldMappings'), orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            const mappings = [];
            querySnapshot.forEach((docSnap) => {
                mappings.push({
                    id: docSnap.id,
                    ...docSnap.data()
                });
            });
            setFieldMappings(mappings);
        } catch (err) {
            setError('Failed to fetch field mappings: ' + err.message);
        } finally {
            setMappingsLoading(false);
        }
    };

    // Initialize or update field mappings document
    const initializeFieldMappings = async () => {
        try {
            const q = query(collection(db, 'fieldMappings'));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                // Create initial document with default mappings
                const defaultMappings = [
                    { label: 'Source IP', path: 'srcip' },
                    { label: 'Destination Country', path: 'dstip_geo.countryName' },
                    { label: 'App', path: 'appid_name' },
                    { label: 'Days Silent', path: 'days_silent' },
                    { label: 'Source Host', path: 'srcip_host' },
                    { label: 'Destination Host', path: 'dstip_host' },
                    { label: 'Source Reputation', path: 'srcip_reputation' },
                    { label: 'Connections Summary', path: 'summary_connections' },
                    { label: 'Percent Failed', path: 'num_failed' },
                    { label: 'Destination Port', path: 'dstport' },
                    { label: 'Source Port', path: 'srcport' },
                    { label: 'Host IP', path: 'host.ip' },
                    { label: 'Host Name', path: 'host.name' },
                    { label: 'Process Path', path: 'eset.processname' },
                    { label: 'User Name', path: 'user.name' },
                    { label: 'Trigger Event', path: 'trigger_event' },
                    { label: 'Command Line', path: 'command_line' },
                    { label: 'Source', path: 'office365.Source' },
                    { label: 'Threat Name', path: 'threat.name' },
                    { label: 'Severity', path: 'office365.Severity' },
                    { label: 'Alert Entity List', path: 'event_summary.alert_entity_list' },
                    { label: 'Source User ID', path: 'srcip_usersid' },
                    { label: 'Source Country', path: 'srcip_geo.countryName' },
                    { label: 'Distance Deviation (Miles)', path: 'distance_deviation' },
                    { label: 'Login Result', path: 'login_result' },
                    { label: 'office365.UserId', path: 'office365.UserId' },
                    { label: 'office365.ObjectId', path: 'office365.ObjectId' },
                    { label: 'Shared File', path: 'office365.SourceFileName' },
                    { label: 'Event Source', path: 'event_source' },
                    { label: 'Total Fail Percentage', path: 'failure percentage rate' },
                    { label: 'Actual', path: 'actual' },
                    { label: 'Typical', path: 'typical' },
                    { label: 'Device', path: 'engid_device_class' },
                    { label: 'DNS query', path: 'metadata.request.query' },
                    { label: 'Effective Top-Level Domain', path: 'metadata.request.effective_tld' },
                    { label: 'Request Effective TLD', path: 'metadata.request.effective_tld' },
                    { label: 'Domain Creation Time', path: 'metadata.request.domain_creation' },
                    { label: 'Response Creation Time', path: 'metadata.response.domain_creation' },
                    { label: 'Account Name', path: 'metadata.request.username' },
                    { label: 'Total Number Failed', path: 'event_summary.total_failed' },
                    { label: 'Total Number Successful', path: 'event_summary.total_successful' },
                    { label: 'Login Type', path: 'login_type' },
                    { label: 'IDS Signature', path: 'ids.signature' }
                ];
                
                await addDoc(collection(db, 'fieldMappings'), {
                    mappings: defaultMappings,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
            
            await fetchFieldMappings();
        } catch (err) {
            setError('Failed to initialize field mappings: ' + err.message);
        }
    };

    const handleAddMapping = async () => {
        if (!newMappingLabel.trim() || !newMappingPath.trim()) {
            setError('Please enter both label and JSON path');
            return;
        }

        // Check for duplicate label
        const isDuplicate = fieldMappings.some(m => 
            m.mappings && m.mappings.some(map => map.label === newMappingLabel.trim())
        );
        if (isDuplicate) {
            setError('This label already exists');
            return;
        }

        try {
            const q = query(collection(db, 'fieldMappings'));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                await initializeFieldMappings();
                // Wait a bit for the document to be created
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            const docRef = querySnapshot.docs[0] || (await getDocs(query(collection(db, 'fieldMappings')))).docs[0];
            const currentMappings = docRef.data().mappings || [];
            
            const newMapping = {
                label: newMappingLabel.trim(),
                path: newMappingPath.trim()
            };
            
            await updateDoc(doc(db, 'fieldMappings', docRef.id), {
                mappings: [...currentMappings, newMapping],
                updatedAt: new Date().toISOString()
            });
            
            setNewMappingLabel('');
            setNewMappingPath('');
            setSuccess('Field mapping added successfully!');
            setError('');
            setTimeout(() => setSuccess(''), 3000);
            await fetchFieldMappings();
        } catch (err) {
            setError('Failed to add field mapping: ' + err.message);
        }
    };

    const handleDeleteMapping = async (mappingId, label) => {
        if (!confirm(`Are you sure you want to remove the mapping for "${label}"?`)) {
            return;
        }

        try {
            const q = query(collection(db, 'fieldMappings'));
            const querySnapshot = await getDocs(q);
            const docRef = querySnapshot.docs[0];
            
            if (docRef) {
                const currentMappings = docRef.data().mappings || [];
                const updatedMappings = currentMappings.filter(m => m.label !== label);
                
                await updateDoc(doc(db, 'fieldMappings', docRef.id), {
                    mappings: updatedMappings,
                    updatedAt: new Date().toISOString()
                });
                
                setSuccess('Field mapping removed successfully!');
                setError('');
                setTimeout(() => setSuccess(''), 3000);
                await fetchFieldMappings();
            }
        } catch (err) {
            setError('Failed to remove field mapping: ' + err.message);
        }
    };

    // Fetch alert formats from Firebase
    const fetchAlertFormats = async () => {
        try {
            setFormatsLoading(true);
            const q = query(collection(db, 'alertFormats'), orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            const formats = [];
            querySnapshot.forEach((docSnap) => {
                formats.push({
                    id: docSnap.id,
                    ...docSnap.data()
                });
            });
            setAlertFormats(formats);
        } catch (err) {
            setError('Failed to fetch alert formats: ' + err.message);
        } finally {
            setFormatsLoading(false);
        }
    };

    const handleEditFormat = (format) => {
        // Make sure we have the full format object with all fields
        setFormatToEdit({
            id: format.id,
            alertName: format.alertName,
            expectedFormat: format.expectedFormat || '',
            alertIdentifier: format.alertIdentifier
        });
        setShowFormatModal(true);
    };

    const handleDeleteFormat = async (formatId, alertName) => {
        if (!confirm(`Are you sure you want to delete the format for "${alertName}"?`)) {
            return;
        }

        try {
            await deleteDoc(doc(db, 'alertFormats', formatId));
            setSuccess('Alert format deleted successfully!');
            setError('');
            setTimeout(() => setSuccess(''), 3000);
            await fetchAlertFormats();
        } catch (err) {
            setError('Failed to delete alert format: ' + err.message);
        }
    };

    const handleFormatModalClose = () => {
        setShowFormatModal(false);
        setFormatToEdit(null);
    };

    const handleFormatSave = () => {
        fetchAlertFormats();
    };

    // Whitelist Alert tab: fetch from Firebase
    const fetchWhitelistAlerts = async () => {
        try {
            setWhitelistAlertsLoading(true);
            const q = query(collection(db, 'whitelistAlerts'), orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            const items = [];
            querySnapshot.forEach((docSnap) => {
                items.push({ id: docSnap.id, ...docSnap.data() });
            });
            setWhitelistAlerts(items);
        } catch (err) {
            setError('Failed to fetch whitelist alerts: ' + err.message);
        } finally {
            setWhitelistAlertsLoading(false);
        }
    };

    // Parse single whitelist text block into fields
    // Accepts flexible order: reason can be first, alert line anywhere, process label as "Process Name:" or "processname:"
    const parseWhitelistText = (text) => {
        const raw = (text || '').trim();
        const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
        let alertTitleOrSignature = '';
        let processName = null;
        let deviceName = null;
        let tenantName = null;
        let reason = '';
        let ipAddress = null;
        let appliesToAllAlerts = false;
        let matchTokens = [];
        const processLabel = /^process\s*name\s*:?\s*$/i;
        const processLabelAlt = /^processname\s*:?\s*$/i;

        // Find process path (line after process label)
        const procIdx = lines.findIndex((l) => processLabel.test(l) || processLabelAlt.test(l));
        if (procIdx >= 0) {
            processName = lines[procIdx + 1] || null;
        }

        // Candidate lines exclude process label + process path
        const candidateLines = lines.filter((l, idx) => {
            if (idx === procIdx) return false;
            if (procIdx >= 0 && idx === procIdx + 1) return false;
            return true;
        });

        // Pick alert line: prefer lines that look like alert headers, else longest line
        const alertHeader = candidateLines.find((l) => /alert|detection|threat|event|signature/i.test(l) || /:/.test(l));
        if (alertHeader) {
            alertTitleOrSignature = alertHeader;
            // Reason is the remaining candidate lines excluding the chosen alert line
            reason = candidateLines.filter((l) => l !== alertTitleOrSignature).join(' ');
        } else {
            alertTitleOrSignature = '';
            reason = candidateLines.join(' ');
        }

        // Fallbacks
        if (!reason && lines.length > 1) {
            reason = lines.slice(1).join(' ');
        }

        // Extract process from raw text if not set (e.g. "knime.exe")
        if (!processName) {
            const exeMatch = raw.match(/([A-Za-z0-9._-]+\.exe)\b/i);
            if (exeMatch) processName = exeMatch[1];
        }

        // Extract IP if present
        const ipMatch = raw.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
        if (ipMatch) ipAddress = ipMatch[1];

        // Detect "all endpoints" / "all devices" / "all servers" / "all alerts"
        appliesToAllAlerts = /all\s+(endpoints|endpoint|devices|hosts|machines|servers|alerts|alert names)/i.test(raw);

        // Build match tokens from raw text (simple keyword extraction)
        const stopwords = new Set(['the','and','for','with','this','that','only','as','per','is','are','was','were','to','of','on','in','by','an','a','be','or','if','it','all','authorized','whitelisted','legitimate','software','activity','process','script','remote','management','platform']);
        matchTokens = raw
            .toLowerCase()
            .replace(/[^a-z0-9_.-]+/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 3 && !stopwords.has(w))
            .slice(0, 20);

        const deviceMatch = reason.match(/\b([A-Z]{2}-[A-Z]{2}-[A-Z0-9-]+)\b/) || reason.match(/device\s+([A-Z0-9-]+)/i);
        if (deviceMatch) deviceName = deviceMatch[1].trim();

        const tenantMatch = raw.match(/tenant\s+([A-Za-z0-9._-]+)/i) || reason.match(/tenant\s+([A-Za-z0-9._-]+)/i);
        if (tenantMatch) tenantName = tenantMatch[1].trim();
        return {
            alertTitleOrSignature: alertTitleOrSignature.trim(),
            processName: processName?.trim() || null,
            deviceName: deviceName || null,
            tenantName: tenantName || null,
            ipAddress,
            reason: reason.trim() || raw,
            rawText: raw,
            appliesToAllAlerts,
            matchTokens
        };
    };

    const handleAddWhitelistAlert = async () => {
        const parsed = parseWhitelistText(newWhitelistText);
        if (!parsed.rawText) {
            setError('Please paste a whitelist message');
            return;
        }
        if (!parsed.reason) {
            setError('Please include a reason/description');
            return;
        }
        try {
            await addDoc(collection(db, 'whitelistAlerts'), {
                alertTitleOrSignature: parsed.alertTitleOrSignature,
                processName: parsed.processName,
                deviceName: parsed.deviceName,
                tenantName: parsed.tenantName,
                ipAddress: parsed.ipAddress,
                reason: parsed.reason,
                rawText: parsed.rawText,
                appliesToAllAlerts: parsed.appliesToAllAlerts,
                matchTokens: parsed.matchTokens || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            setNewWhitelistText('');
            setShowWhitelistModal(false);
            setSuccess('Whitelist alert added. It applies only when device/process match.');
            setError('');
            setTimeout(() => setSuccess(''), 4000);
            fetchWhitelistAlerts();
        } catch (err) {
            setError('Failed to add whitelist alert: ' + err.message);
        }
    };

    const handleDeleteWhitelistAlert = async (id) => {
        if (!confirm('Remove this whitelist rule?')) return;
        try {
            await deleteDoc(doc(db, 'whitelistAlerts', id));
            setSuccess('Whitelist rule removed.');
            setError('');
            setTimeout(() => setSuccess(''), 3000);
            fetchWhitelistAlerts();
        } catch (err) {
            setError('Failed to remove: ' + err.message);
        }
    };

    const handleStartEditWhitelist = (item) => {
        setEditingWhitelistId(item.id);
        setEditAlertTitle(item.alertTitleOrSignature || '');
        setEditProcessName(item.processName || '');
        setEditDeviceName(item.deviceName || '');
        setEditTenantName(item.tenantName || '');
        setEditAlertIP(item.ipAddress || '');
        setEditReason(item.reason || '');
    };

    const handleCancelEditWhitelist = () => {
        setEditingWhitelistId(null);
        setEditAlertTitle('');
        setEditProcessName('');
        setEditDeviceName('');
        setEditTenantName('');
        setEditAlertIP('');
        setEditReason('');
    };

    const handleSaveEditWhitelist = async (id) => {
        const title = editAlertTitle.trim();
        const reason = editReason.trim();
        if (!title) {
            setError('Alert title/signature is required');
            return;
        }
        if (!reason) {
            setError('Reason/notes is required');
            return;
        }
        try {
            await updateDoc(doc(db, 'whitelistAlerts', id), {
                alertTitleOrSignature: title,
                processName: (editProcessName || '').trim() || null,
                deviceName: (editDeviceName || '').trim() || null,
                tenantName: (editTenantName || '').trim() || null,
                ipAddress: (editAlertIP || '').trim() || null,
                reason,
                updatedAt: new Date().toISOString()
            });
            setSuccess('Whitelist rule updated.');
            setError('');
            setTimeout(() => setSuccess(''), 3000);
            handleCancelEditWhitelist();
            fetchWhitelistAlerts();
        } catch (err) {
            setError('Failed to update: ' + err.message);
        }
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
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black p-4 md:p-8 text-slate-200">
            <div className="max-w-5xl mx-auto bg-slate-900/80 border border-emerald-500/30 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <header className="bg-gradient-to-r from-emerald-600/80 via-cyan-600/70 to-indigo-700/80 text-white p-4 text-center">
                    <div className="flex justify-between items-center mb-2">
                        <h1 className="text-xl md:text-2xl font-bold tracking-widest">🔐 CYBER ADMIN CONSOLE</h1>
                        <button
                            onClick={() => {
                                localStorage.removeItem('admin_authenticated');
                                setIsAuthenticated(false);
                                setShowPasswordForm(true);
                            }}
                            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-all border border-white/20"
                        >
                            Logout
                        </button>
                    </div>
                    <p className="text-sm opacity-90">Secure access controls, mappings, and whitelist intelligence</p>
                    {!ipAllowed && isAuthenticated && (
                        <p className="text-sm opacity-75 mt-2">
                            ⚠️ Accessing via password authentication (IP not whitelisted)
                        </p>
                    )}
                </header>

                {/* Main Content */}
                <div className="p-6 md:p-8 bg-slate-950/40">
                    {/* Tabs for Alert Formats, Field Mappings, and IP Whitelist */}
                    <div className="mb-8">
                        {/* Tab Navigation */}
                        <div className="flex border-b border-emerald-500/30 mb-4">
                            <button
                                onClick={() => setActiveTab('formats')}
                                className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
                                    activeTab === 'formats'
                                        ? 'border-b-2 border-emerald-400 text-emerald-300'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                Alert Formats ({alertFormats.length})
                            </button>
                            <button
                                onClick={() => setActiveTab('mappings')}
                                className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
                                    activeTab === 'mappings'
                                        ? 'border-b-2 border-emerald-400 text-emerald-300'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                Field Mappings ({fieldMappings.length > 0 && fieldMappings[0].mappings ? fieldMappings[0].mappings.length : 0})
                            </button>
                            <button
                                onClick={() => setActiveTab('ips')}
                                className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
                                    activeTab === 'ips'
                                        ? 'border-b-2 border-emerald-400 text-emerald-300'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                IP Address Whitelist ({allowedIPs.length})
                            </button>
                        </div>

                        {/* Tab Content - Alert Formats */}
                        {activeTab === 'formats' && (
                            <div>
                                <div className="flex justify-between items-center mb-3 gap-2">
                                    <input
                                        type="text"
                                        value={searchFormats}
                                        onChange={(e) => setSearchFormats(e.target.value)}
                                        placeholder="Search formats..."
                                        className="flex-1 p-2 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                                    />
                                    <button
                                        onClick={() => {
                                            setFormatToEdit(null);
                                            setShowFormatModal(true);
                                        }}
                                        className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:from-purple-700 hover:to-indigo-800 transition-all whitespace-nowrap"
                                    >
                                        Add Format
                                    </button>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                                    Manage alert format templates
                                </p>

                                {formatsLoading ? (
                                    <div className="text-center py-4 text-xs text-gray-500">Loading formats...</div>
                                ) : alertFormats.length === 0 ? (
                                    <div className="text-center py-6 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                        No alert formats found. Click "Add Format" to create one.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse border border-gray-300 dark:border-gray-600 text-xs">
                                            <thead>
                                                <tr className="bg-gray-100 dark:bg-gray-800">
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Alert Name</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Format Preview</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Created</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-center">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {alertFormats
                                                    .filter(format => {
                                                        if (!searchFormats.trim()) return true;
                                                        const search = searchFormats.toLowerCase();
                                                        return (format.alertName || '').toLowerCase().includes(search) ||
                                                               (format.expectedFormat || '').toLowerCase().includes(search);
                                                    })
                                                    .map((format) => {
                                                    const formatPreview = format.expectedFormat 
                                                        ? format.expectedFormat.split('\n').slice(0, 3).join('\n') + (format.expectedFormat.split('\n').length > 3 ? '...' : '')
                                                        : 'No format';
                                                    return (
                                                        <tr key={format.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                                            <td className="border border-gray-300 dark:border-gray-600 p-2 font-medium text-xs">
                                                                {format.alertName || 'Unknown'}
                                                            </td>
                                                            <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                <pre className="text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-w-md overflow-hidden">
                                                                    {formatPreview}
                                                                </pre>
                                                            </td>
                                                            <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs">
                                                                {formatDate(format.createdAt)}
                                                            </td>
                                                            <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                <div className="flex gap-1.5 justify-center items-center">
                                                                    <button
                                                                        onClick={() => handleEditFormat(format)}
                                                                        className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
                                                                    >
                                                                        Edit
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeleteFormat(format.id, format.alertName)}
                                                                        className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
                                                                    >
                                                                        Delete
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab Content - Field Mappings */}
                        {activeTab === 'mappings' && (
                            <div>
                                <div className="mb-3">
                                    <input
                                        type="text"
                                        value={searchMappings}
                                        onChange={(e) => setSearchMappings(e.target.value)}
                                        placeholder="Search mappings..."
                                        className="w-full p-2 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                                    />
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                                    Manage label to JSON path mappings used for formatting alerts
                                </p>
                                
                                <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <div className="grid grid-cols-2 gap-2 mb-2">
                                        <input
                                            type="text"
                                            value={newMappingLabel}
                                            onChange={(e) => setNewMappingLabel(e.target.value)}
                                            placeholder="Label (e.g., Source IP)"
                                            className="p-2 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                                        />
                                        <input
                                            type="text"
                                            value={newMappingPath}
                                            onChange={(e) => setNewMappingPath(e.target.value)}
                                            placeholder="JSON Path (e.g., srcip)"
                                            className="p-2 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                                        />
                                    </div>
                                    <button
                                        onClick={handleAddMapping}
                                        className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:from-purple-700 hover:to-indigo-800 transition-all"
                                    >
                                        Add Mapping
                                    </button>
                                </div>

                                {mappingsLoading ? (
                                    <div className="text-center py-4 text-xs text-gray-500">Loading mappings...</div>
                                ) : fieldMappings.length === 0 ? (
                                    <div className="text-center py-6 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                        No field mappings found. Click "Initialize Default Mappings" to add default mappings.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse border border-gray-300 dark:border-gray-600 text-xs">
                                            <thead>
                                                <tr className="bg-gray-100 dark:bg-gray-800">
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Label</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">JSON Path</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-center">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {fieldMappings[0]?.mappings && fieldMappings[0].mappings.length > 0 ? (
                                                    fieldMappings[0].mappings
                                                        .filter(mapping => {
                                                            if (!searchMappings.trim()) return true;
                                                            const search = searchMappings.toLowerCase();
                                                            return (mapping.label || '').toLowerCase().includes(search) ||
                                                                   (mapping.path || '').toLowerCase().includes(search);
                                                        })
                                                        .map((mapping, index) => (
                                                        <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                                            <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs">
                                                                {mapping.label}
                                                            </td>
                                                            <td className="border border-gray-300 dark:border-gray-600 p-2 font-mono text-xs">
                                                                {mapping.path}
                                                            </td>
                                                            <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                <div className="flex justify-center">
                                                                    <button
                                                                        onClick={() => handleDeleteMapping(fieldMappings[0].id, mapping.label)}
                                                                        className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
                                                                    >
                                                                        Remove
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    <tr>
                                                        <td colSpan="3" className="border border-gray-300 dark:border-gray-600 p-2 text-center text-xs text-gray-500">
                                                            No mappings found. Click "Initialize Default Mappings" to add default mappings.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                
                                {fieldMappings.length === 0 && !mappingsLoading && (
                                    <div className="mt-3 text-center">
                                        <button
                                            onClick={initializeFieldMappings}
                                            className="px-4 py-1.5 text-xs bg-gray-500 text-white rounded-lg font-medium hover:bg-gray-600 transition-all"
                                        >
                                            Initialize Default Mappings
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab Content - IP Addresses */}
                        {activeTab === 'ips' && (
                            <div>
                                <div className="mb-3">
                                    <input
                                        type="text"
                                        value={searchIPs}
                                        onChange={(e) => setSearchIPs(e.target.value)}
                                        placeholder="Search IPs or users..."
                                        className="w-full p-2 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                                    />
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                                    Manage allowed IP addresses for the application
                                </p>
                                
                                {/* Add IP Section */}
                                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <h3 className="text-xs font-bold mb-2 text-gray-700 dark:text-gray-300">Add New IP Address</h3>
                                    <div className="grid grid-cols-2 gap-2 mb-2">
                                        <input
                                            type="text"
                                            value={userName}
                                            onChange={(e) => setUserName(e.target.value)}
                                            placeholder="User Name"
                                            className="p-2 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                                        />
                            <input
                                type="text"
                                value={newIP}
                                onChange={(e) => setNewIP(e.target.value)}
                                placeholder="Enter IP address (e.g., 192.168.1.1 or 192.168.1.0/24)"
                                            className="p-2 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                                onKeyPress={(e) => e.key === 'Enter' && handleAddIP()}
                            />
                                    </div>
                            <button
                                onClick={handleAddIP}
                                        className="w-full bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-medium hover:from-purple-700 hover:to-indigo-800 transition-all"
                            >
                                Add IP
                            </button>
                        </div>
                        
                        {loading ? (
                                    <div className="text-center py-4 text-xs text-gray-500">Loading...</div>
                        ) : allowedIPs.length === 0 ? (
                                    <div className="text-center py-6 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                No IP addresses configured. Add one above to get started.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                        <table className="w-full border-collapse border border-gray-300 dark:border-gray-600 text-xs">
                                    <thead>
                                        <tr className="bg-gray-100 dark:bg-gray-800">
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">User Name</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">IP Address</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Added On</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-center">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allowedIPs
                                            .filter(item => {
                                                if (!searchIPs.trim()) return true;
                                                const search = searchIPs.toLowerCase();
                                                return (item.userName || '').toLowerCase().includes(search) ||
                                                       (item.ip || '').toLowerCase().includes(search);
                                            })
                                            .map((item) => (
                                            <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                                {editingIP === item.id ? (
                                                    <>
                                                        <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                            <input
                                                                type="text"
                                                                value={editUserName}
                                                                onChange={(e) => setEditUserName(e.target.value)}
                                                                className="w-full p-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100"
                                                            />
                                                        </td>
                                                        <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                            <input
                                                                type="text"
                                                                value={editIP}
                                                                onChange={(e) => setEditIP(e.target.value)}
                                                                className="w-full p-1 text-xs border border-gray-300 dark:border-gray-600 rounded font-mono dark:bg-gray-700 dark:text-gray-100"
                                                            />
                                                        </td>
                                                        <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs">
                                                            {formatDate(item.createdAt)}
                                                        </td>
                                                        <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                            <div className="flex gap-1 justify-center">
                                                                <button
                                                                    onClick={() => handleSaveEdit(item.id)}
                                                                    className="bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
                                                                >
                                                                    Save
                                                                </button>
                                                                <button
                                                                    onClick={handleCancelEdit}
                                                                    className="bg-gray-500 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </>
                                                ) : (
                                                    <>
                                                        <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs">
                                                            {item.userName || 'N/A'}
                                                        </td>
                                                        <td className="border border-gray-300 dark:border-gray-600 p-2 font-mono text-xs">
                                                    {item.ip}
                                                </td>
                                                        <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs">
                                                    {formatDate(item.createdAt)}
                                                </td>
                                                        <td className="border border-gray-300 dark:border-gray-600 p-2 text-center">
                                                            <div className="flex gap-1 justify-center">
                                                                <button
                                                                    onClick={() => handleStartEdit(item)}
                                                                    className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
                                                                >
                                                                    Edit
                                                                </button>
                                                    <button
                                                        onClick={() => handleDeleteIP(item.id)}
                                                                    className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
                                                    >
                                                        Remove
                                                    </button>
                                                            </div>
                                                </td>
                                                    </>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab Content - Whitelist Alert */}
                        {false && (
                            <div>
                                <div className="flex justify-between items-center mb-3 gap-2">
                                    <input
                                        type="text"
                                        value={searchWhitelistAlerts}
                                        onChange={(e) => setSearchWhitelistAlerts(e.target.value)}
                                        placeholder="Search by alert, device, process, reason..."
                                        className="flex-1 p-2 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                                    />
                                    <button
                                        onClick={() => setShowWhitelistModal(true)}
                                        className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:from-purple-700 hover:to-indigo-800 transition-all whitespace-nowrap"
                                    >
                                        Add Whitelist Alert
                                    </button>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                                    Alerts listed here are considered whitelisted only when they match both the alert and the specific device/process/IP. Used on home page when pasting JSON.
                                </p>

                                {whitelistAlertsLoading ? (
                                    <div className="text-center py-4 text-xs text-gray-500">Loading...</div>
                                ) : whitelistAlerts.length === 0 ? (
                                    <div className="text-center py-6 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                        No whitelist rules. Click "Add Whitelist Alert" to add one. Each rule applies only when alert + device/process match.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse border border-gray-300 dark:border-gray-600 text-xs">
                                            <thead>
                                                <tr className="bg-gray-100 dark:bg-gray-800">
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Message</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Alert / Signature</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Process</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Device</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Tenant</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">IP</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-left">Reason</th>
                                                    <th className="border border-gray-300 dark:border-gray-600 p-2 text-center">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {whitelistAlerts
                                                    .filter((item) => {
                                                        if (!searchWhitelistAlerts.trim()) return true;
                                                        const s = searchWhitelistAlerts.toLowerCase();
                                                        return (item.rawText || '').toLowerCase().includes(s) ||
                                                               (item.alertTitleOrSignature || '').toLowerCase().includes(s) ||
                                                               (item.processName || '').toLowerCase().includes(s) ||
                                                               (item.deviceName || '').toLowerCase().includes(s) ||
                                                               (item.tenantName || '').toLowerCase().includes(s) ||
                                                               (item.ipAddress || '').toLowerCase().includes(s) ||
                                                               (item.reason || '').toLowerCase().includes(s);
                                                    })
                                                    .map((item) => (
                                                        <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                                            {editingWhitelistId === item.id ? (
                                                                <>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                        <input value={editAlertTitle} onChange={(e) => setEditAlertTitle(e.target.value)} className="w-full p-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100" />
                                                                    </td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                        <input value={editProcessName} onChange={(e) => setEditProcessName(e.target.value)} className="w-full p-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100" placeholder="Process" />
                                                                    </td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                        <input value={editDeviceName} onChange={(e) => setEditDeviceName(e.target.value)} className="w-full p-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100" placeholder="Device" />
                                                                    </td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                        <input value={editTenantName} onChange={(e) => setEditTenantName(e.target.value)} className="w-full p-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100" placeholder="Tenant" />
                                                                    </td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                        <input value={editAlertIP} onChange={(e) => setEditAlertIP(e.target.value)} className="w-full p-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100" placeholder="IP" />
                                                                    </td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                        <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} className="w-full p-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100" />
                                                                    </td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2">
                                                                        <div className="flex gap-1 justify-center">
                                                                            <button onClick={() => handleSaveEditWhitelist(item.id)} className="bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded text-xs font-medium">Save</button>
                                                                            <button onClick={handleCancelEditWhitelist} className="bg-gray-500 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs font-medium">Cancel</button>
                                                                        </div>
                                                                    </td>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs max-w-[260px] truncate" title={item.rawText || ''}>{item.rawText || '—'}</td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs max-w-[180px] truncate" title={item.alertTitleOrSignature || ''}>{item.alertTitleOrSignature || '—'}</td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs max-w-[120px] truncate" title={item.processName || ''}>{item.processName || '—'}</td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs">{item.deviceName || '—'}</td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs">{item.tenantName || '—'}</td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs font-mono">{item.ipAddress || '—'}</td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-xs max-w-[200px] truncate" title={item.reason || ''}>{item.reason || '—'}</td>
                                                                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-center">
                                                                        <div className="flex gap-1 justify-center">
                                                                            <button onClick={() => handleStartEditWhitelist(item)} className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">Edit</button>
                                                                            <button onClick={() => handleDeleteWhitelistAlert(item.id)} className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs font-medium">Remove</button>
                                                                        </div>
                                                                    </td>
                                                                </>
                                                            )}
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
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

            {/* Format Modal */}
            <AddFormatModal
                isOpen={showFormatModal}
                onClose={handleFormatModalClose}
                formatToEdit={formatToEdit}
                onSave={handleFormatSave}
            />

            {/* Whitelist Alert Modal */}
            {showWhitelistModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Add Whitelist Alert</h2>
                            <button
                                onClick={() => { setShowWhitelistModal(false); setNewWhitelistText(''); }}
                                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto max-h-[70vh]">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                                I-paste ang kahit anong whitelist message. Hindi kailangan ng format. Halimbawa:
                            </p>
                            <textarea
                                value={newWhitelistText}
                                onChange={(e) => setNewWhitelistText(e.target.value)}
                                placeholder={`ESET Protect (ESET Inspect Alert): Common AutoStart registry modified by an unpopular process [A0103a]\nProcess Name:\n%LOCALAPPDATA%\\programs\\twinkle-tray\\twinkle tray.exe\nSir Justin confirmed to whitelist the twinkle tray software only for this device UC-DR-JPADLAN as legitimate software since they use it to adjust the brightness on their device.`}
                                rows={10}
                                className="w-full p-3 text-xs border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-800 dark:text-gray-100 font-mono whitespace-pre-wrap"
                                autoFocus
                            />
                        </div>
                        <div className="flex gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
                            <button
                                onClick={() => { setShowWhitelistModal(false); setNewWhitelistText(''); }}
                                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded-lg text-sm font-medium transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddWhitelistAlert}
                                className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white rounded-lg text-sm font-medium transition-all"
                            >
                                Add Whitelist
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

