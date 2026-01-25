'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';

export default function AddFormatModal({ isOpen, onClose }) {
    const [jsonInput, setJsonInput] = useState('');
    const [expectedFormat, setExpectedFormat] = useState('');
    const [formatPreview, setFormatPreview] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    // Extract field mappings from expected format
    const extractFieldMappings = (jsonData, expectedFormatText) => {
        const mappings = [];
        const lines = expectedFormatText.split('\n');
        
        // Skip alert name, date/time, and description (first 3 sections)
        let sectionCount = 0;
        let currentLabel = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines
            if (!line) {
                if (currentLabel) {
                    currentLabel = null; // Reset label on empty line
                }
                continue;
            }
            
            // Skip alert name (first non-empty line)
            if (sectionCount === 0 && (line === jsonData.xdr_event?.display_name || line === jsonData.event_name)) {
                sectionCount++;
                continue;
            }
            
            // Skip date/time (format: M/D/YY, H:MM AM/PM)
            if (line.match(/^\d{1,2}\/\d{1,2}\/\d{2},?\s+\d{1,2}:\d{2}\s+(AM|PM)/i)) {
                sectionCount++;
                continue;
            }
            
            // Skip description (usually long text)
            if (sectionCount === 2 && line.length > 50) {
                sectionCount++;
                continue;
            }
            
            // After description, we have field labels and values
            if (sectionCount >= 3) {
                const nextLine = lines[i + 1]?.trim();
                const nextNextLine = lines[i + 2]?.trim();
                
                // If next line exists and is not empty and not a date, this might be a label
                if (nextLine && nextLine.length > 0 && !nextLine.match(/^\d{1,2}\/\d{1,2}\/\d{2}/)) {
                    // Check if next line looks like a value (not a label)
                    const looksLikeValue = nextLine.length > 5 || 
                                         nextLine.includes('\\') || 
                                         nextLine.includes('/') ||
                                         nextLine.includes('.') ||
                                         nextLine.match(/^\d+\.\d+\.\d+\.\d+/) || // IP address
                                         nextLine.match(/^[a-z]:\\/i); // Windows path
                    
                    if (looksLikeValue) {
                        // This line is a label, next line is the value
                        currentLabel = line;
                        const value = nextLine;
                        
                        // Find the path of this value in JSON
                        const fieldPath = findFieldPath(jsonData, value);
                        if (fieldPath) {
                            mappings.push({
                                label: currentLabel,
                                path: fieldPath,
                                sampleValue: value
                            });
                        }
                        i++; // Skip the value line
                        currentLabel = null;
                    }
                }
            }
        }
        
        return mappings;
    };
    
    // Find the path of a value in JSON (improved matching)
    const findFieldPath = (obj, searchValue, prefix = '', visited = new Set()) => {
        if (!searchValue || searchValue.length === 0) return null;
        
        const objKey = JSON.stringify(obj);
        if (visited.has(objKey)) return null;
        visited.add(objKey);
        
        for (const key in obj) {
            const value = obj[key];
            const currentPath = prefix ? `${prefix}.${key}` : key;
            
            // Exact match
            if (value === searchValue) {
                return currentPath;
            }
            
            // String contains match (for partial matches)
            if (typeof value === 'string' && value === searchValue) {
                return currentPath;
            }
            
            // For nested objects
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                const found = findFieldPath(value, searchValue, currentPath, visited);
                if (found) return found;
            }
        }
        return null;
    };

    // Generate format preview from expected format
    const generatePreview = () => {
        if (!jsonInput.trim() || !expectedFormat.trim()) {
            setFormatPreview('');
            if (!expectedFormat.trim()) {
                setError('Please paste both JSON and expected format');
            }
            return;
        }

        try {
            const data = JSON.parse(jsonInput);
            
            // Extract field mappings from expected format
            const mappings = extractFieldMappings(data, expectedFormat);
            
            // Generate preview showing detected mappings
            let preview = 'Detected Field Mappings:\n\n';
            mappings.forEach(mapping => {
                preview += `${mapping.label} → ${mapping.path}\n`;
                preview += `  Sample: ${mapping.sampleValue.substring(0, 50)}${mapping.sampleValue.length > 50 ? '...' : ''}\n\n`;
            });
            
            if (mappings.length === 0) {
                preview = 'Could not automatically detect field mappings. The format will be saved and used as a template.';
            }

            setFormatPreview(preview);
            setError('');
        } catch (err) {
            setError('Invalid JSON: ' + err.message);
            setFormatPreview('');
        }
    };

    const handleSave = async () => {
        if (!jsonInput.trim()) {
            setError('Please paste JSON data');
            return;
        }

        if (!expectedFormat.trim()) {
            setError('Please paste the expected formatted output');
            return;
        }

        try {
            setLoading(true);
            const data = JSON.parse(jsonInput);
            
            // Extract alert identifier from alert name
            const alertName = data.xdr_event?.display_name || data.event_name || '';
            const eventName = data.xdr_event?.name || data.event_name || '';
            
            // Generate identifier from alert name
            const alertIdentifier = alertName.toLowerCase().trim() || eventName.toLowerCase().trim();
            
            if (!alertIdentifier) {
                setError('Could not determine alert name from JSON');
                return;
            }
            
            // Extract field mappings from expected format
            const fieldMappings = extractFieldMappings(data, expectedFormat);
            
            // Check if format already exists
            const { getDocs, query, where, deleteDoc, doc } = await import('firebase/firestore');
            const existingQuery = query(
                collection(db, 'alertFormats'),
                where('alertIdentifier', '==', alertIdentifier)
            );
            const existingSnapshot = await getDocs(existingQuery);
            
            // Delete existing format if found
            if (!existingSnapshot.empty) {
                const deletePromises = existingSnapshot.docs.map(docSnap => 
                    deleteDoc(doc(db, 'alertFormats', docSnap.id))
                );
                await Promise.all(deletePromises);
            }
            
            // Save format configuration to Firebase
            await addDoc(collection(db, 'alertFormats'), {
                alertName: alertName,
                eventName: eventName,
                alertIdentifier: alertIdentifier,
                fieldMappings: fieldMappings,
                expectedFormat: expectedFormat.trim(),
                sampleJson: data,
                createdAt: new Date().toISOString(),
                createdBy: 'admin'
            });

            setSuccess('Format saved successfully to Firebase!');
            setError('');
            setTimeout(() => {
                setSuccess('');
                onClose();
                setJsonInput('');
                setExpectedFormat('');
                setFormatPreview('');
            }, 2000);
        } catch (err) {
            setError('Failed to save format: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white p-6">
                    <h2 className="text-2xl font-bold">Add New Alert Format</h2>
                    <p className="text-sm opacity-90 mt-1">Paste JSON and define the format configuration</p>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {/* JSON Input */}
                    <div className="mb-4">
                        <label className="block font-semibold mb-2 text-gray-700 dark:text-gray-300">
                            Paste Alert JSON:
                        </label>
                        <textarea
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            placeholder="Paste your JSON alert data here..."
                            rows={8}
                            className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm resize-y focus:outline-none focus:border-purple-500 dark:bg-gray-800 dark:text-gray-100"
                        />
                    </div>

                    {/* Expected Format Input */}
                    <div className="mb-4">
                        <label className="block font-semibold mb-2 text-gray-700 dark:text-gray-300">
                            Paste Expected Formatted Output:
                        </label>
                        <textarea
                            value={expectedFormat}
                            onChange={(e) => setExpectedFormat(e.target.value)}
                            placeholder="Paste the expected formatted text output here..."
                            rows={10}
                            className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm resize-y focus:outline-none focus:border-purple-500 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <button
                            onClick={generatePreview}
                            className="mt-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-all"
                        >
                            Analyze Format
                        </button>
                    </div>

                    {/* Format Preview */}
                    {formatPreview && (
                        <div className="mb-4">
                            <label className="block font-semibold mb-2 text-gray-700 dark:text-gray-300">
                                Format Preview:
                            </label>
                            <textarea
                                value={formatPreview}
                                readOnly
                                rows={10}
                                className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                            />
                        </div>
                    )}

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
                        className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all disabled:opacity-50"
                    >
                        {loading ? 'Saving...' : 'Save Format'}
                    </button>
                </div>
            </div>
        </div>
    );
}

