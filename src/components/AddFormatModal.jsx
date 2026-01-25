'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, doc, getDocs, query, where, deleteDoc } from 'firebase/firestore';

export default function AddFormatModal({ isOpen, onClose, formatToEdit = null, onSave }) {
    const [expectedFormat, setExpectedFormat] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    // Load format data when editing
    useEffect(() => {
        if (isOpen) {
            if (formatToEdit && formatToEdit.expectedFormat) {
                // Load the format content
                setExpectedFormat(formatToEdit.expectedFormat);
            } else if (!formatToEdit) {
                // Clear for new format
                setExpectedFormat('');
            }
            // Reset error and success messages when modal opens
            setError('');
            setSuccess('');
        }
    }, [formatToEdit?.id, isOpen]); // Use formatToEdit?.id to trigger when format changes

    // Extract alert name from the first line of the format
    const extractAlertName = (formatText) => {
        const lines = formatText.trim().split('\n');
        const firstLine = lines[0]?.trim() || '';
        return firstLine || 'Unknown Alert';
    };

    const handleSave = async () => {
        if (!expectedFormat.trim()) {
            setError('Please paste the example format');
            return;
        }

        try {
            setLoading(true);
            
            // Extract alert name from first line of format
            const alertName = extractAlertName(expectedFormat);
            const alertIdentifier = alertName.toLowerCase().trim();
            
            if (formatToEdit) {
                // Update existing format
                await updateDoc(doc(db, 'alertFormats', formatToEdit.id), {
                    alertName: alertName,
                    eventName: alertName,
                    alertIdentifier: alertIdentifier,
                    expectedFormat: expectedFormat.trim(),
                    updatedAt: new Date().toISOString()
                });
                setSuccess('Format updated successfully!');
            } else {
                // Check if format already exists
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
                
                // Save new format configuration to Firebase
                await addDoc(collection(db, 'alertFormats'), {
                    alertName: alertName,
                    eventName: alertName,
                    alertIdentifier: alertIdentifier,
                    fieldMappings: [],
                    expectedFormat: expectedFormat.trim(),
                    createdAt: new Date().toISOString(),
                    createdBy: 'admin'
                });
                setSuccess('Format saved successfully!');
            }

            setError('');
            setTimeout(() => {
                setSuccess('');
                onClose();
                setExpectedFormat('');
                if (onSave) onSave();
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
                    <h2 className="text-2xl font-bold">{formatToEdit ? 'Edit Alert Format' : 'Add New Alert Format'}</h2>
                    <p className="text-sm opacity-90 mt-1">Paste the example format</p>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {/* Example Format Input */}
                    <div className="mb-4">
                        <label className="block font-semibold mb-2 text-gray-700 dark:text-gray-300">
                            Example Format: <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={expectedFormat || ''}
                            onChange={(e) => setExpectedFormat(e.target.value)}
                            placeholder="Paste the example formatted output here..."
                            rows={15}
                            className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm resize-y focus:outline-none focus:border-purple-500 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Paste the example format that will be used as a template. The first line will be used as the alert name.
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
                        className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all disabled:opacity-50"
                    >
                        {loading ? 'Saving...' : formatToEdit ? 'Update Format' : 'Save Format'}
                    </button>
                </div>
            </div>
        </div>
    );
}

