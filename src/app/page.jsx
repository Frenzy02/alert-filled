'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import AddFormatModal from '@/components/AddFormatModal';

// Format timestamp to readable date
function formatDate(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
        // Try parsing as UTC string
        const utcDate = new Date(timestamp);
        if (isNaN(utcDate.getTime())) return '';
        return formatDateFromDate(utcDate);
    }
    return formatDateFromDate(date);
}

function formatDateFromDate(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear().toString().slice(-2);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    
    return `${month}/${day}/${year}, ${displayHours}:${displayMinutes} ${ampm}`;
}

// Extract fields from JSON based on alert type
function extractFields(data) {
    const alertName = data.xdr_event?.display_name || data.event_name || 'Unknown Alert';
    const description = data.xdr_event?.description || '';
    
    // Get tenant name
    const tenantName = data.tenant_name || '';
    const allowedTenants = ['selene', 'belmont', 'orion', 'siycha'];
    const isAllowedTenant = allowedTenants.some(tenant => 
        tenantName.toLowerCase().includes(tenant.toLowerCase())
    );
    
    // Try to get timestamp from various fields
    let timestamp = data.alert_time || data.timestamp || data.orig_timestamp;
    if (!timestamp && data.timestamp_utc) {
        timestamp = new Date(data.timestamp_utc).getTime();
    }
    if (!timestamp && data.orig_timestamp_utc) {
        timestamp = new Date(data.orig_timestamp_utc).getTime();
    }
    
    const dateTime = formatDate(timestamp);
    
    // Get time occurred (UTC timestamp string) for allowed tenants
    let timeOccurred = null;
    if (isAllowedTenant) {
        timeOccurred = data.timestamp_utc || data.orig_timestamp_utc || 
                      (timestamp ? new Date(timestamp).toISOString() : null);
    }
    
    // Extract common fields
    const fields = {
        alertName,
        dateTime,
        description,
        timeOccurred,
        isAllowedTenant
    };
    
    // Extract fields for "Recently Registered Domains" alert type
    if (data.metadata?.request?.effective_tld) {
        fields.requestEffectiveTLD = data.metadata.request.effective_tld;
    }
    
    if (data.srcip || data.srcip_host) {
        fields.sourceIP = data.srcip;
        fields.sourceHost = data.srcip_host || data.srcip;
    }
    
    if (data.srcport) {
        fields.sourcePort = data.srcport;
    }
    
    if (data.dstip) {
        fields.destinationIP = data.dstip;
    }
    
    if (data.dstip_host || data.dstip) {
        fields.destinationHost = data.dstip_host || data.dstip;
    }
    
    if (data.dstport) {
        fields.destinationPort = data.dstport;
    }
    
    if (data.metadata?.request?.domain_creation || data.metadata?.response?.domain_creation) {
        fields.domainCreationTime = data.metadata.request.domain_creation || data.metadata.response.domain_creation;
    }
    
    // Extract from detected_values if available
    if (data.detected_fields && data.detected_values) {
        data.detected_fields.forEach((field, index) => {
            if (field.includes('effective_tld') && data.detected_values[index]) {
                fields.requestEffectiveTLD = data.detected_values[index];
            }
            if (field.includes('domain_creation') && data.detected_values[index]) {
                fields.domainCreationTime = data.detected_values[index];
            }
        });
    }
    
    return fields;
}

// Field configuration with priority and display names
const fieldConfig = [
    // Domain-related fields (for DNS/domain alerts)
    { key: 'requestEffectiveTLD', label: 'Request Effective TLD', priority: 1, category: 'domain' },
    { key: 'domainCreationTime', label: 'Domain Creation Time', priority: 4, category: 'domain' },
    
    // Source fields
    { key: 'sourceIP', label: 'Source IP', priority: 1, category: 'network' },
    { key: 'sourceHost', label: 'Source Host', priority: 2, category: 'network' },
    { key: 'sourcePort', label: 'Source Port', priority: 3, category: 'network' },
    
    // Destination fields
    { key: 'destinationIP', label: 'Destination IP', priority: 1, category: 'network' },
    { key: 'destinationHost', label: 'Destination Host', priority: 2, category: 'network' },
    { key: 'destinationPort', label: 'Destination Port', priority: 3, category: 'network' },
];

// Intelligent field detection and ordering
function detectFieldOrder(fields, alertName) {
    const alertNameLower = (alertName || '').toLowerCase();
    
    // Check if this is a domain-related alert
    const isDomainAlert = alertNameLower.includes('domain') || 
                         alertNameLower.includes('dns') ||
                         fields.requestEffectiveTLD || 
                         fields.domainCreationTime;
    
    // Check if this is a network/connection alert
    const isNetworkAlert = fields.sourceIP || fields.destinationIP || 
                          fields.sourcePort || fields.destinationPort ||
                          alertNameLower.includes('anomaly') ||
                          alertNameLower.includes('smb') ||
                          alertNameLower.includes('connection');
    
    // Build ordered field list
    const orderedFields = [];
    
    // For domain alerts, prioritize domain fields first
    if (isDomainAlert) {
        orderedFields.push(...fieldConfig.filter(f => f.category === 'domain'));
        // Then add network fields if available
        if (isNetworkAlert) {
            orderedFields.push(...fieldConfig.filter(f => f.category === 'network'));
        }
    }
    // For network alerts, show network fields in order
    else if (isNetworkAlert) {
        // Source fields first
        orderedFields.push(...fieldConfig.filter(f => f.category === 'network' && f.key.startsWith('source')));
        // Then destination fields
        orderedFields.push(...fieldConfig.filter(f => f.category === 'network' && f.key.startsWith('destination')));
        // Then domain fields if available
        if (isDomainAlert) {
            orderedFields.push(...fieldConfig.filter(f => f.category === 'domain'));
        }
    }
    // Default: show all fields in priority order
    else {
        orderedFields.push(...fieldConfig.sort((a, b) => a.priority - b.priority));
    }
    
    // Remove duplicates and filter to only fields that have values
    const uniqueFields = [];
    const seen = new Set();
    
    for (const field of orderedFields) {
        if (!seen.has(field.key) && fields[field.key]) {
            uniqueFields.push(field);
            seen.add(field.key);
        }
    }
    
    return uniqueFields;
}

// Format extracted fields into text output based on alert type
function formatOutput(fields) {
    let output = '';
    
    // Alert name
    if (fields.alertName) {
        output += fields.alertName + '\n\n';
    }
    
    // Date and time
    if (fields.dateTime) {
        output += fields.dateTime + '\n\n';
    }
    
    // Description
    if (fields.description) {
        output += fields.description + '\n\n';
    }
    
    // Intelligently detect and order fields based on alert type
    const orderedFields = detectFieldOrder(fields, fields.alertName);
    
    // Output fields in detected order
    for (const field of orderedFields) {
        if (fields[field.key]) {
            output += field.label + '\n';
            output += fields[field.key] + '\n\n';
        }
    }
    
    return output.trim();
}

// Get value from nested object using path string
function getNestedValue(obj, path) {
    if (!path) return null;
    // Handle array indices like "field[0]"
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (part.includes('[')) {
            const [key, index] = part.split('[');
            const idx = parseInt(index.replace(']', ''));
            current = current?.[key]?.[idx];
        } else {
            current = current?.[part];
        }
        if (current === null || current === undefined) break;
    }
    return current;
}

// Find value in data by label (fuzzy matching)
function findValueByLabel(obj, label, prefix = '', visited = new Set()) {
    if (!label) return null;
    
    const objKey = JSON.stringify(obj);
    if (visited.has(objKey)) return null;
    visited.add(objKey);
    
    const labelLower = label.toLowerCase().replace(/\s+/g, '');
    
    for (const key in obj) {
        const value = obj[key];
        const currentPath = prefix ? `${prefix}.${key}` : key;
        const keyLower = key.toLowerCase().replace(/_/g, '').replace(/-/g, '');
        
        // Check if key matches label
        if (keyLower.includes(labelLower) || labelLower.includes(keyLower)) {
            return value;
        }
        
        // For nested objects
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const found = findValueByLabel(value, label, currentPath, visited);
            if (found !== null) return found;
        }
    }
    return null;
}

// Find corresponding value in new data based on sample value
function findValueInData(data, sampleValue, visited = new Set()) {
    if (!sampleValue) return null;
    
    const objKey = JSON.stringify(data);
    if (visited.has(objKey)) return null;
    visited.add(objKey);
    
    const sampleStr = String(sampleValue).trim();
    
    for (const key in data) {
        const value = data[key];
        
        // Exact match
        if (String(value).trim() === sampleStr) {
            return value;
        }
        
        // For arrays
        if (Array.isArray(value)) {
            for (const item of value) {
                if (String(item).trim() === sampleStr) {
                    return item;
                }
            }
        }
        
        // For nested objects
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const found = findValueInData(value, sampleValue, visited);
            if (found !== null) return found;
        }
    }
    return null;
}

// Format using saved format configuration
function formatWithSavedConfig(data, formatConfig, globalMappings = []) {
    const alertName = data.xdr_event?.display_name || data.event_name || 'Unknown Alert';
    const description = data.xdr_event?.description || '';
    
    // Try to get timestamp
    let timestamp = data.alert_time || data.timestamp || data.orig_timestamp;
    if (!timestamp && data.timestamp_utc) {
        timestamp = new Date(data.timestamp_utc).getTime();
    }
    if (!timestamp && data.orig_timestamp_utc) {
        timestamp = new Date(data.orig_timestamp_utc).getTime();
    }
    const dateTime = formatDate(timestamp);
    
    // Check if this is ESET format
    const isESETFormat = alertName.toLowerCase().includes('eset') || 
                        data.dev_type === 'eset_protect' ||
                        data.msg_class === 'eset_protect_enterprise_inspector';
    
    // Priority 1: Use field mappings to build output directly (most reliable)
    if (formatConfig && formatConfig.fieldMappings && formatConfig.fieldMappings.length > 0) {
        let output = `${alertName}\n\n`;
        output += `${dateTime}\n\n`;
        output += `${description}\n\n`;
        
        // Use field mappings to build output in the exact order specified
        formatConfig.fieldMappings.forEach(mapping => {
            if (mapping.path && mapping.label) {
                const value = getNestedValue(data, mapping.path);
                // Always show the label, even if value is empty
                output += `${mapping.label}\n`;
                if (value !== null && value !== undefined && value !== '') {
                    // Convert to string for display
                    const valueStr = String(value);
                    output += `${valueStr}\n\n`;
                } else {
                    // Show empty line if value doesn't exist
                    output += '\n\n';
                }
            }
        });
        
        return output.trim();
    }
    
    // Priority 2: Use expectedFormat template if available (fallback)
    if (formatConfig && formatConfig.expectedFormat) {
        let template = formatConfig.expectedFormat;
        const lines = template.split('\n');
        let output = '';
        
        // Build label to JSON path map - merge global mappings, formatConfig mappings, and defaults
        const labelToPathMap = {};
        
        // First, add global field mappings from Firebase (highest priority for user-added mappings)
        if (globalMappings && globalMappings.length > 0) {
            globalMappings.forEach(mapping => {
                if (mapping.label && mapping.path) {
                    labelToPathMap[mapping.label] = mapping.path;
                }
            });
        }
        
        // Then add formatConfig fieldMappings (if any)
        if (formatConfig.fieldMappings && formatConfig.fieldMappings.length > 0) {
            formatConfig.fieldMappings.forEach(mapping => {
                if (mapping.label && mapping.path) {
                    labelToPathMap[mapping.label] = mapping.path;
                }
            });
        }
        
        // Finally, add default mappings (lowest priority - can be overridden by above)
        const defaultMappings = {
            'Source IP': 'srcip',
            'Destination Country': 'dstip_geo.countryName',
            'App': 'appid_name',
            'Days Silent': 'days_silent',
            'Source Host': 'srcip_host',
            'Destination Host': 'dstip_host',
            'Source Reputation': 'srcip_reputation',
            'Connections Summary': 'summary_connections',
            'Percent Failed': 'num_failed',
            'Destination Port': 'dstport',
            'Source Port': 'srcport',
            'Host IP': 'host.ip',
            'Host Name': 'host.name',
            'Process Path': 'eset.processname',
            'User Name': 'user.name',
            'Trigger Event': 'trigger_event',
            'Command Line': 'command_line',
            'Source': 'office365.Source',
            'Threat Name': 'threat.name',
            'Severity': 'office365.Severity',
            'Alert Entity List': 'event_summary.alert_entity_list',
            'Source User ID': 'srcip_usersid',
            'Source Country': 'srcip_geo.countryName',
            'Distance Deviation (Miles)': 'distance_deviation',
            'Login Result': 'login_result',
            'office365.UserId': 'office365.UserId',
            'office365.ObjectId': 'office365.ObjectId',
            'Shared File': 'office365.SourceFileName',
            'Event Source': 'event_source',
            'Total Fail Percentage': 'event_summary.failure_percentage_rate',
            'Actual': 'actual',
            'Typical': 'typical',
            'Device': 'engid_device_class',
            'DNS query': 'metadata.request.query',
            'Effective Top-Level Domain': 'metadata.request.effective_tld',
            'Request Effective TLD': 'metadata.request.effective_tld',
            'Domain Creation Time': 'metadata.request.domain_creation',
            'Response Creation Time': 'metadata.response.domain_creation',
            'Account Name': 'metadata.request.username',
            'Total Number Failed': 'event_summary.total_failed',
            'Total Number Successful': 'event_summary.total_successful',
            'Login Type': 'login_type',
            'IDS Signature': 'ids.signature',
            'dstip': 'dstip'
        };
        
        // Merge default mappings (formatConfig.fieldMappings take priority)
        Object.assign(labelToPathMap, defaultMappings);
        
        // Replace first line with actual alert name
        if (lines.length > 0) {
            output += alertName + '\n\n';
        }
        
        // Process remaining lines - treat them as labels and find values
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines in template - we'll add our own spacing
            if (!line) {
                continue;
            }
            
            // Special handling for common labels
            const lineLower = line.toLowerCase();
            
            // Handle "time occured" or similar time labels - output date/time directly without label
            if (lineLower.includes('time') && (lineLower.includes('occurred') || lineLower.includes('occured'))) {
                output += dateTime + '\n\n';
                continue;
            }
            
            // Handle "Description" label - output description directly without label
            if (lineLower === 'description') {
                output += description + '\n\n';
                continue;
            }
            
            // Check if we have a mapping for this label
            const jsonPath = labelToPathMap[line];
            
            if (jsonPath) {
                // Use the specific JSON path to get the value
                const value = getNestedValue(data, jsonPath);
                
                // Always show the field if it's in the template, even if value is empty
                output += line + '\n';
                if (value !== null && value !== undefined && value !== '') {
                    output += String(value) + '\n\n';
                } else {
                    // Show empty line if value doesn't exist
                    output += '\n\n';
                }
            } else {
                // If no mapping found, try fuzzy matching as fallback
                const value = findValueByLabel(data, line);
                
                // Always show the field if it's in the template
                output += line + '\n';
                if (value !== null && value !== undefined && value !== '') {
                    output += String(value) + '\n\n';
                } else {
                    // Show empty line if value doesn't exist
                    output += '\n\n';
                }
            }
        }
        
        return output.trim();
    }
    
    // Priority 3: ESET format fallback
    if (isESETFormat) {
        let output = `${alertName}\n\n`;
        output += `${dateTime}\n\n`;
        output += `${description}\n\n`;
        
        const esetFieldMappings = [
            { path: 'hostip', label: 'Host IP' },
            { path: 'host.name', label: 'Host Name' },
            { path: 'process.executable', label: 'Process Path' },
            { path: 'user.name', label: 'User Name' },
            { path: 'eset.trigger_event', label: 'Trigger Event' },
            { path: 'eset.command_line', label: 'Command Line' },
        ];
        
        esetFieldMappings.forEach(mapping => {
            const value = getNestedValue(data, mapping.path);
            if (value) {
                output += `${mapping.label}\n${value}\n\n`;
            }
        });
        
        return output.trim();
    }
    
    // Fallback: Default format
    let output = `${alertName}\n\n`;
    output += `${dateTime}\n\n`;
    output += `${description}\n\n`;
    
    return output.trim();
}

// Field Mapping Modal Component
function FieldMappingModal({ isOpen, onClose }) {
    const [label, setLabel] = useState('');
    const [path, setPath] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        if (!label.trim() || !path.trim()) {
            setError('Please enter both label and JSON path');
            return;
        }

        try {
            setLoading(true);
            setError('');
            
            // Check if fieldMappings collection exists
            const mappingsQuery = query(collection(db, 'fieldMappings'));
            const mappingsSnapshot = await getDocs(mappingsQuery);
            
            let docRef;
            if (mappingsSnapshot.empty) {
                // Create initial document
                docRef = await addDoc(collection(db, 'fieldMappings'), {
                    mappings: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            } else {
                docRef = mappingsSnapshot.docs[0];
            }
            
            // Get current mappings
            const currentData = mappingsSnapshot.empty ? { mappings: [] } : docRef.data();
            const currentMappings = currentData.mappings || [];
            
            // Check for duplicate label
            const isDuplicate = currentMappings.some(m => m.label === label.trim());
            if (isDuplicate) {
                setError('This label already exists');
                setLoading(false);
                return;
            }
            
            // Add new mapping
            const newMapping = {
                label: label.trim(),
                path: path.trim()
            };
            
            const updatedMappings = [...currentMappings, newMapping];
            
            // Update document
            await updateDoc(doc(db, 'fieldMappings', docRef.id), {
                mappings: updatedMappings,
                updatedAt: new Date().toISOString()
            });
            
            setSuccess('Field mapping added successfully!');
            setLabel('');
            setPath('');
            setError('');
            
            setTimeout(() => {
                setSuccess('');
                onClose();
            }, 2000);
        } catch (err) {
            setError('Failed to add field mapping: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full">
                {/* Header */}
                <div className="bg-gradient-to-r from-green-600 to-emerald-700 text-white p-6">
                    <h2 className="text-2xl font-bold">Add Field Mapping</h2>
                    <p className="text-sm opacity-90 mt-1">Add a new label to JSON path mapping</p>
                </div>

                {/* Content */}
                <div className="p-6">
                    <div className="mb-4">
                        <label className="block font-semibold mb-2 text-gray-700 dark:text-gray-300">
                            Label: <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="e.g., Source IP"
                            className="w-full p-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-green-500 dark:bg-gray-800 dark:text-gray-100"
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block font-semibold mb-2 text-gray-700 dark:text-gray-300">
                            JSON Path: <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            placeholder="e.g., srcip"
                            className="w-full p-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm focus:outline-none focus:border-green-500 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Use dot notation for nested paths (e.g., metadata.request.query)
                        </p>
                    </div>

                    <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                            <strong>Example:</strong> Source IP - srcip
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                            This mapping will be used to extract values from JSON data when formatting alerts.
                        </p>
                    </div>

                    {/* Messages */}
                    {error && (
                        <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="mb-4 p-4 bg-green-100 dark:bg-green-900/30 border border-green-400 dark:border-green-700 text-green-700 dark:text-green-300 rounded-lg">
                            {success}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-300 dark:border-gray-600 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-6 py-3 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-700 text-white rounded-lg font-semibold hover:from-green-700 hover:to-emerald-800 transition-all disabled:opacity-50"
                    >
                        {loading ? 'Saving...' : 'Add Mapping'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Main conversion function
async function convertJsonToText(jsonString) {
    try {
        // Parse JSON
        const data = JSON.parse(jsonString);
        
        // Check for saved format configuration
        const alertName = data.xdr_event?.display_name || data.event_name || '';
        const eventName = data.xdr_event?.name || data.event_name || '';
        const identifier = alertName.toLowerCase() || eventName.toLowerCase();
        
        // Try to find saved format from Firebase
        try {
            // Get all formats for better matching
            const allFormatsQuery = query(collection(db, 'alertFormats'));
            const allFormatsSnapshot = await getDocs(allFormatsQuery);
            
            if (!allFormatsSnapshot.empty) {
                let bestMatch = null;
                let bestMatchScore = 0;
                
                // Fetch global field mappings once
                let globalMappings = [];
                try {
                    const { getDocs: getDocsMapping, query: queryMapping } = await import('firebase/firestore');
                    const mappingsQuery = queryMapping(collection(db, 'fieldMappings'));
                    const mappingsSnapshot = await getDocsMapping(mappingsQuery);
                    
                    if (!mappingsSnapshot.empty) {
                        globalMappings = mappingsSnapshot.docs[0].data().mappings || [];
                    }
                } catch (err) {
                    console.error('Error fetching global field mappings:', err);
                }
                
                // Try exact matches first
                for (const docSnap of allFormatsSnapshot.docs) {
                    const formatConfig = docSnap.data();
                    const savedIdentifier = formatConfig.alertIdentifier?.toLowerCase() || '';
                    const savedAlertName = formatConfig.alertName?.toLowerCase() || '';
                    const savedEventName = formatConfig.eventName?.toLowerCase() || '';
                    
                    // Exact match on identifier (highest priority)
                    if (identifier && savedIdentifier === identifier) {
                        return formatWithSavedConfig(data, formatConfig, globalMappings);
                    }
                    
                    // Exact match on event name
                    if (eventName && savedEventName === eventName.toLowerCase()) {
                        return formatWithSavedConfig(data, formatConfig, globalMappings);
                    }
                    
                    // Exact match on alert name
                    if (alertName && savedAlertName === alertName.toLowerCase()) {
                        return formatWithSavedConfig(data, formatConfig, globalMappings);
                    }
                }
                
                // Try partial/fuzzy matches
                for (const docSnap of allFormatsSnapshot.docs) {
                    const formatConfig = docSnap.data();
                    const savedIdentifier = formatConfig.alertIdentifier?.toLowerCase() || '';
                    const savedAlertName = formatConfig.alertName?.toLowerCase() || '';
                    const savedEventName = formatConfig.eventName?.toLowerCase() || '';
                    
                    let score = 0;
                    
                    // Partial match on identifier
                    if (identifier && savedIdentifier && 
                        (identifier.includes(savedIdentifier) || savedIdentifier.includes(identifier))) {
                        score = Math.max(score, savedIdentifier.length / Math.max(identifier.length, savedIdentifier.length));
                    }
                    
                    // Partial match on alert name
                    if (alertName && savedAlertName) {
                        const currentAlertName = alertName.toLowerCase();
                        if (currentAlertName.includes(savedAlertName) || savedAlertName.includes(currentAlertName)) {
                            score = Math.max(score, savedAlertName.length / Math.max(currentAlertName.length, savedAlertName.length));
                        }
                    }
                    
                    // Partial match on event name
                    if (eventName && savedEventName) {
                        const currentEventName = eventName.toLowerCase();
                        if (currentEventName.includes(savedEventName) || savedEventName.includes(currentEventName)) {
                            score = Math.max(score, savedEventName.length / Math.max(currentEventName.length, savedEventName.length));
                        }
                    }
                    
                    if (score > bestMatchScore && score > 0.5) { // At least 50% match
                        bestMatchScore = score;
                        bestMatch = formatConfig;
                    }
                }
                
                if (bestMatch) {
                    return formatWithSavedConfig(data, bestMatch, globalMappings);
                }
            }
        } catch (firebaseError) {
            // If Firebase query fails, fall back to default formatting
            console.error('Error checking saved formats from Firebase:', firebaseError);
        }
        
        // Check for ESET format
        const isESETFormat = alertName.toLowerCase().includes('eset') || 
                            data.dev_type === 'eset_protect' ||
                            data.msg_class === 'eset_protect_enterprise_inspector';
        
        if (isESETFormat) {
            // Fetch global mappings for ESET format too
            let globalMappings = [];
            try {
                const { getDocs: getDocsMapping, query: queryMapping } = await import('firebase/firestore');
                const mappingsQuery = queryMapping(collection(db, 'fieldMappings'));
                const mappingsSnapshot = await getDocsMapping(mappingsQuery);
                
                if (!mappingsSnapshot.empty) {
                    globalMappings = mappingsSnapshot.docs[0].data().mappings || [];
                }
            } catch (err) {
                console.error('Error fetching global field mappings:', err);
            }
            return formatWithSavedConfig(data, {}, globalMappings);
        }
        
        // Default: Extract fields and format
        const fields = extractFields(data);
        const output = formatOutput(fields);
        
        return output;
    } catch (error) {
        throw new Error('Invalid JSON format: ' + error.message);
    }
}

export default function Home() {
    const [jsonInput, setJsonInput] = useState('');
    const [textOutput, setTextOutput] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showAddFormatModal, setShowAddFormatModal] = useState(false);
    const [showSavedFormatsModal, setShowSavedFormatsModal] = useState(false);
    const [showFieldMappingModal, setShowFieldMappingModal] = useState(false);
    const [savedAlertFormats, setSavedAlertFormats] = useState([]);
    const [loadingFormats, setLoadingFormats] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [formatToEdit, setFormatToEdit] = useState(null);
    const pasteTimeoutRef = useRef(null);

    // Fetch saved alert formats from Firebase
    useEffect(() => {
        const fetchSavedFormats = async () => {
            try {
                setLoadingFormats(true);
                const formatsQuery = query(collection(db, 'alertFormats'));
                const formatsSnapshot = await getDocs(formatsQuery);
                
                const formats = [];
                formatsSnapshot.forEach((doc) => {
                    const data = doc.data();
                    formats.push({
                        id: doc.id,
                        alertName: data.alertName || 'Unknown Alert',
                        eventName: data.eventName || '',
                        expectedFormat: data.expectedFormat || '',
                        alertIdentifier: data.alertIdentifier || '',
                        createdAt: data.createdAt || ''
                    });
                });
                
                // Sort by alert name
                formats.sort((a, b) => a.alertName.localeCompare(b.alertName));
                setSavedAlertFormats(formats);
            } catch (err) {
                console.error('Error fetching saved formats:', err);
            } finally {
                setLoadingFormats(false);
            }
        };

        fetchSavedFormats();
    }, [showAddFormatModal, showSavedFormatsModal]); // Refresh when modal opens/closes

    const handleConvert = async () => {
        const input = jsonInput.trim();
        
        if (!input) {
            setError('Please paste JSON data first');
            setSuccess('');
            return;
        }
        
        try {
            const output = await convertJsonToText(input);
            setTextOutput(output);
            setError('');
            setSuccess('Conversion successful!');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message);
            setTextOutput('');
            setSuccess('');
        }
    };

    const handleClear = () => {
        setJsonInput('');
        setTextOutput('');
        setError('');
        setSuccess('');
    };

    const handleCopy = () => {
        if (!textOutput) {
            setError('No text to copy');
            setSuccess('');
            return;
        }
        
        navigator.clipboard.writeText(textOutput);
        setSuccess('Copied to clipboard!');
        setError('');
        setTimeout(() => setSuccess(''), 3000);
    };

    const handleSaveToFirebase = async () => {
        const input = jsonInput.trim();
        
        if (!input) {
            setError('Please paste JSON data first');
            setSuccess('');
            return;
        }
        
        try {
            // Parse JSON to validate
            const alertData = JSON.parse(input);
            
            // Add formatted text to the data
            const output = await convertJsonToText(input);
            
            // Save to Firebase
            const docRef = await addDoc(collection(db, 'alerts'), {
                originalJson: alertData,
                formattedText: output,
                alertName: alertData.xdr_event?.display_name || alertData.event_name || 'Unknown Alert',
                tenantName: alertData.tenant_name || '',
                timestamp: new Date(),
                createdAt: new Date().toISOString()
            });
            
            setSuccess('Alert saved to Firebase successfully!');
            setError('');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            if (err.message.includes('Invalid JSON')) {
                setError(err.message);
            } else {
                setError('Failed to save to Firebase: ' + err.message);
            }
            setSuccess('');
        }
    };

    const handlePaste = () => {
        // Auto-convert after paste with slight delay
        if (pasteTimeoutRef.current) {
            clearTimeout(pasteTimeoutRef.current);
        }
        pasteTimeoutRef.current = setTimeout(() => {
            if (jsonInput.trim()) {
                handleConvert();
            }
        }, 500);
    };

    // Auto-convert when input changes (debounced)
    useEffect(() => {
        if (pasteTimeoutRef.current) {
            clearTimeout(pasteTimeoutRef.current);
        }
        
        if (jsonInput.trim().length > 50) { // Only auto-convert if there's substantial content
            pasteTimeoutRef.current = setTimeout(async () => {
                try {
                    const output = await convertJsonToText(jsonInput.trim());
                    setTextOutput(output);
                    setError('');
                } catch (err) {
                    // Silently fail on auto-convert, only show error on manual convert
                }
            }, 800);
        }
        
        return () => {
            if (pasteTimeoutRef.current) {
                clearTimeout(pasteTimeoutRef.current);
            }
        };
    }, [jsonInput]);

  return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 md:p-6">
            <div className="max-w-7xl mx-auto">
                {/* Professional Header */}
                <header className="bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg shadow-xl mb-6 p-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                </div>
                                <div>
                                    <h1 className="text-2xl md:text-3xl font-bold text-white">SOC Alert Converter</h1>
                                    <p className="text-sm text-slate-400">Security Operations Center - Alert Formatting Tool</p>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={() => {
                                    setFormatToEdit(null);
                                    setShowAddFormatModal(true);
                                }}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all flex items-center gap-2 text-sm shadow-lg hover:shadow-xl"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                New Format
                            </button>
                            <button
                                onClick={() => setShowFieldMappingModal(true)}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-all flex items-center gap-2 text-sm shadow-lg hover:shadow-xl"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                Add Field Mapping
                            </button>
                            <button
                                onClick={() => setShowSavedFormatsModal(true)}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-all flex items-center gap-2 text-sm border border-slate-600"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Formats ({savedAlertFormats.length})
                            </button>
                        </div>
                    </div>
                </header>

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Input Section */}
                    <div className="bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg shadow-xl p-5">
                        <div className="flex items-center justify-between mb-3">
                            <label htmlFor="jsonInput" className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                JSON Input
                            </label>
                            {jsonInput && (
                                <span className="text-xs text-slate-400 font-mono">
                                    {jsonInput.length} chars
                                </span>
                            )}
                        </div>
                        <textarea
                            id="jsonInput"
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            placeholder="Paste JSON alert data here..."
                            rows={18}
                            className="w-full p-4 bg-slate-900/50 border border-slate-600 rounded-lg font-mono text-xs text-slate-200 resize-y focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-500"
                        />
                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={handleConvert}
                                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm shadow-lg hover:shadow-xl"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Convert
                            </button>
                            <button
                                onClick={handleClear}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-all text-sm border border-slate-600"
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    {/* Output Section */}
                    <div className="bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg shadow-xl p-5">
                        <div className="flex items-center justify-between mb-3">
                            <label htmlFor="textOutput" className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Formatted Output
                            </label>
                            {textOutput && (
                                <span className="text-xs text-slate-400 font-mono">
                                    {textOutput.length} chars
                                </span>
                            )}
        </div>
                        <textarea
                            id="textOutput"
                            value={textOutput}
                            readOnly
                            placeholder="Formatted text will appear here..."
                            rows={18}
                            className="w-full p-4 bg-slate-900/50 border border-slate-600 rounded-lg font-mono text-xs text-slate-200 resize-y placeholder:text-slate-500"
                        />
                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={handleCopy}
                                disabled={!textOutput}
                                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm shadow-lg hover:shadow-xl"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy
                            </button>
                        </div>
                    </div>
                </div>

                {/* Error/Success Messages */}
                <div className="mt-4 space-y-2">
                    {error && (
                        <div className="bg-red-900/30 border border-red-700/50 text-red-300 p-4 rounded-lg flex items-start gap-3">
                            <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-sm">{error}</span>
                        </div>
                    )}
                    {success && (
                        <div className="bg-green-900/30 border border-green-700/50 text-green-300 p-4 rounded-lg flex items-start gap-3">
                            <svg className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-sm">{success}</span>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Add Format Modal */}
            <AddFormatModal 
                isOpen={showAddFormatModal} 
                onClose={() => {
                    setShowAddFormatModal(false);
                    setFormatToEdit(null);
                }}
                formatToEdit={formatToEdit}
                onSave={() => {
                    // Refresh the formats list
                    const fetchSavedFormats = async () => {
                        try {
                            setLoadingFormats(true);
                            const formatsQuery = query(collection(db, 'alertFormats'));
                            const formatsSnapshot = await getDocs(formatsQuery);
                            
                            const formats = [];
                            formatsSnapshot.forEach((doc) => {
                                const data = doc.data();
                                formats.push({
                                    id: doc.id,
                                    alertName: data.alertName || 'Unknown Alert',
                                    eventName: data.eventName || '',
                                    expectedFormat: data.expectedFormat || '',
                                    alertIdentifier: data.alertIdentifier || '',
                                    createdAt: data.createdAt || ''
                                });
                            });
                            
                            formats.sort((a, b) => a.alertName.localeCompare(b.alertName));
                            setSavedAlertFormats(formats);
                        } catch (err) {
                            console.error('Error fetching saved formats:', err);
                        } finally {
                            setLoadingFormats(false);
                        }
                    };
                    fetchSavedFormats();
                }}
            />

            {/* Field Mapping Modal */}
            <FieldMappingModal
                isOpen={showFieldMappingModal}
                onClose={() => setShowFieldMappingModal(false)}
            />

            {/* Saved Formats Modal */}
            {showSavedFormatsModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
                        {/* Header */}
                        <div className="bg-slate-900/50 border-b border-slate-700 p-5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">Saved Alert Formats</h2>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {savedAlertFormats.length} format{savedAlertFormats.length !== 1 ? 's' : ''} configured
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setShowSavedFormatsModal(false);
                                    setSearchQuery('');
                                }}
                                className="text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg p-2 transition-all"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-5 overflow-y-auto flex-1 bg-slate-900/30">
                            {/* Search Input */}
                            <div className="mb-4">
                                <div className="relative">
                                    <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search alert formats..."
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-200 placeholder:text-slate-500 text-sm"
                                    />
                                </div>
                            </div>

                            {loadingFormats ? (
                                <div className="text-center py-12">
                                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-500 mx-auto"></div>
                                    <p className="text-slate-400 mt-3 text-sm">Loading formats...</p>
                                </div>
                            ) : savedAlertFormats.length === 0 ? (
                                <div className="text-center py-12">
                                    <svg className="w-12 h-12 text-slate-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <p className="text-slate-400 text-sm">
                                        No alert formats configured yet
                                    </p>
                                    <p className="text-slate-500 text-xs mt-1">
                                        Click "New Format" to create one
                                    </p>
                                </div>
                            ) : (() => {
                                // Filter formats based on search query
                                const filteredFormats = savedAlertFormats.filter((format) => {
                                    const query = searchQuery.toLowerCase();
                                    return (
                                        format.alertName.toLowerCase().includes(query) ||
                                        (format.eventName && format.eventName.toLowerCase().includes(query))
                                    );
                                });

                                if (filteredFormats.length === 0) {
                                    return (
                                        <div className="text-center py-12">
                                            <svg className="w-12 h-12 text-slate-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                            </svg>
                                            <p className="text-slate-400 text-sm">
                                                No formats found matching "{searchQuery}"
                                            </p>
                                        </div>
                                    );
                                }

                                return (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {filteredFormats.map((format) => (
                                            <div
                                                key={format.id}
                                                className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm font-medium text-slate-200 hover:border-blue-500 hover:bg-slate-800/80 transition-all flex items-center justify-between gap-2 group"
                                            >
                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                                                    <span className="truncate">{format.alertName}</span>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        setFormatToEdit(format);
                                                        setShowSavedFormatsModal(false);
                                                        setShowAddFormatModal(true);
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs flex-shrink-0"
                                                    title="Edit format"
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
        </div>
            )}
    </div>
  );
}
