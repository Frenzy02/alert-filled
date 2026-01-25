'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
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
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

// Format using saved format configuration
function formatWithSavedConfig(data, formatConfig) {
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
    
    let output = `${alertName}\n\n`;
    output += `${dateTime}\n\n`;
    output += `${description}\n\n`;
    
    // Check if this is ESET format
    const isESETFormat = alertName.toLowerCase().includes('eset') || 
                        data.dev_type === 'eset_protect' ||
                        data.msg_class === 'eset_protect_enterprise_inspector';
    
    if (isESETFormat) {
        // ESET Protect specific format
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
    } else if (formatConfig && formatConfig.fieldMappings && formatConfig.fieldMappings.length > 0) {
        // Use saved format configuration with field mappings
        formatConfig.fieldMappings.forEach(mapping => {
            const value = getNestedValue(data, mapping.path);
            if (value !== null && value !== undefined && value !== '') {
                output += `${mapping.label}\n${value}\n\n`;
            }
        });
    } else if (formatConfig && formatConfig.expectedFormat) {
        // If we have the expected format template, try to use it
        // This is a fallback if field mappings weren't extracted properly
        let template = formatConfig.expectedFormat;
        
        // Replace alert name, date, and description
        const sampleAlertName = formatConfig.alertName || formatConfig.sampleJson?.xdr_event?.display_name || '';
        const sampleDate = formatDate(formatConfig.sampleJson?.timestamp || formatConfig.sampleJson?.timestamp_utc);
        const sampleDesc = formatConfig.sampleJson?.xdr_event?.description || '';
        
        template = template.replace(sampleAlertName, alertName);
        template = template.replace(sampleDate, dateTime);
        template = template.replace(sampleDesc, description);
        
        // Replace sample values with actual values from data
        if (formatConfig.sampleJson) {
            const sampleData = formatConfig.sampleJson;
            formatConfig.fieldMappings?.forEach(mapping => {
                const sampleValue = getNestedValue(sampleData, mapping.path);
                const actualValue = getNestedValue(data, mapping.path);
                if (sampleValue && actualValue) {
                    template = template.replace(sampleValue, actualValue);
                }
            });
        }
        
        output = template;
    }
    
    return output.trim();
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
            // First try by alert identifier (alert name)
            if (identifier) {
                const formatsQuery = query(
                    collection(db, 'alertFormats'),
                    where('alertIdentifier', '==', identifier)
                );
                const formatsSnapshot = await getDocs(formatsQuery);
                
                if (!formatsSnapshot.empty) {
                    const formatConfig = formatsSnapshot.docs[0].data();
                    return formatWithSavedConfig(data, formatConfig);
                }
            }
            
            // Also check by event name
            if (eventName) {
                const eventQuery = query(
                    collection(db, 'alertFormats'),
                    where('eventName', '==', eventName)
                );
                const eventSnapshot = await getDocs(eventQuery);
                
                if (!eventSnapshot.empty) {
                    const formatConfig = eventSnapshot.docs[0].data();
                    return formatWithSavedConfig(data, formatConfig);
                }
            }
            
            // Try partial match on alert name
            if (alertName) {
                const allFormatsQuery = query(collection(db, 'alertFormats'));
                const allFormatsSnapshot = await getDocs(allFormatsQuery);
                
                for (const docSnap of allFormatsSnapshot.docs) {
                    const formatConfig = docSnap.data();
                    const savedAlertName = formatConfig.alertName?.toLowerCase() || '';
                    const currentAlertName = alertName.toLowerCase();
                    
                    // Check if alert names match (partial or full)
                    if (savedAlertName && currentAlertName.includes(savedAlertName) || 
                        savedAlertName.includes(currentAlertName)) {
                        return formatWithSavedConfig(data, formatConfig);
                    }
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
            return formatWithSavedConfig(data, {});
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
    const pasteTimeoutRef = useRef(null);

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
        <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800 p-4 md:p-8">
            <div className="max-w-7xl mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <header className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white p-8 text-center">
                    <h1 className="text-4xl md:text-5xl font-bold mb-2">🔒 SOC Alerts Converter</h1>
                    <p className="text-lg opacity-90">Paste JSON alert data and get formatted text output</p>
                    <button
                        onClick={() => setShowAddFormatModal(true)}
                        className="mt-4 px-6 py-2 bg-white text-purple-600 rounded-lg font-semibold hover:bg-gray-100 transition-all transform hover:-translate-y-0.5 hover:shadow-lg"
                    >
                        + Add New Alert Format
                    </button>
                </header>

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 md:p-8">
                    {/* Input Section */}
                    <div className="flex flex-col">
                        <label htmlFor="jsonInput" className="font-semibold mb-2 text-gray-700 dark:text-gray-300 text-lg">
                            Paste JSON Alert Data:
                        </label>
                        <textarea
                            id="jsonInput"
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            placeholder="Paste your JSON alert data here..."
                            rows={15}
                            className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm resize-y focus:outline-none focus:border-purple-500 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={handleConvert}
                                className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-6 py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all transform hover:-translate-y-0.5 hover:shadow-lg"
                            >
                                Convert to Text
                            </button>
                            <button
                                onClick={handleClear}
                                className="px-6 py-3 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 transition-all transform hover:-translate-y-0.5"
                            >
                                Clear
                            </button>
                        </div>
        </div>

                    {/* Output Section */}
                    <div className="flex flex-col">
                        <label htmlFor="textOutput" className="font-semibold mb-2 text-gray-700 dark:text-gray-300 text-lg">
                            Formatted Text Output:
                        </label>
                        <textarea
                            id="textOutput"
                            value={textOutput}
                            readOnly
                            placeholder="Formatted text will appear here..."
                            rows={15}
                            className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm resize-y bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={handleCopy}
                                className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-6 py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all transform hover:-translate-y-0.5 hover:shadow-lg"
                            >
                                Copy to Clipboard
                            </button>
                          
                        </div>
                    </div>
                </div>

                {/* Error/Success Messages */}
                {error && (
                    <div className="mx-6 md:mx-8 mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mx-6 md:mx-8 mb-6 p-4 bg-green-100 dark:bg-green-900/30 border border-green-400 dark:border-green-700 text-green-700 dark:text-green-300 rounded-lg">
                        {success}
                    </div>
                )}
            </div>
            
            {/* Add Format Modal */}
            <AddFormatModal 
                isOpen={showAddFormatModal} 
                onClose={() => setShowAddFormatModal(false)} 
            />
    </div>
  );
}
