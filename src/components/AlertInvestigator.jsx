'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export default function AlertInvestigator({ isOpen, onClose, jsonData }) {
    const [messages, setMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const messagesEndRef = useRef(null);


    useEffect(() => {
        if (isOpen && jsonData) {
            // Initialize with a welcome message and alert summary
            const alertName = jsonData.xdr_event?.display_name || jsonData.event_name || 'Unknown Alert';
            const initialMessage = {
                role: 'assistant',
                content: `Hello! I'm your Alert Investigator. I can help you investigate this alert: **${alertName}**\n\nI have access to the alert JSON data. What would you like to know about this alert?`
            };
            setMessages([initialMessage]);
            setInputMessage('');
            setError('');
        }
    }, [isOpen, jsonData]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async () => {
        if (!inputMessage.trim() || loading) return;

        const userMessage = {
            role: 'user',
            content: inputMessage.trim()
        };

        setMessages(prev => [...prev, userMessage]);
        setInputMessage('');
        setLoading(true);
        setError('');

        try {
            // Use Next.js API route to avoid CORS issues
            const response = await fetch('/api/investigate-alert', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [...messages, userMessage],
                    jsonData: jsonData
                })
            });

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (e) {
                    errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
                }
                const errorMessage = errorData.error || errorData.message || `API error: ${response.status}`;
                throw new Error(errorMessage);
            }

            const data = await response.json();
            let content = data.content || 'No response from AI';
            
            // Clean up the content - remove extra blank lines and normalize spacing
            content = content
                .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
                .replace(/^\s+|\s+$/gm, '') // Trim each line
                .replace(/\n\n\n+/g, '\n\n') // Remove excessive blank lines
                .trim();
            
            const assistantMessage = {
                role: 'assistant',
                content: content
            };

            setMessages(prev => [...prev, assistantMessage]);
        } catch (err) {
            setError('Failed to get response: ' + err.message);
            const errorMessage = {
                role: 'assistant',
                content: `Sorry, I encountered an error: ${err.message}. Please try again.`
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-white dark:bg-gray-900 z-50 flex flex-col">
            {/* Close button - Top right corner */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full p-2 transition-all"
                aria-label="Close"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>

            {/* Messages - Larger */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 md:p-6 bg-gray-50 dark:bg-gray-800 min-h-0">
                    <div className="space-y-3 sm:space-y-4">
                        {messages.map((message, index) => (
                            <div
                                key={index}
                                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[85%] sm:max-w-[80%] md:max-w-[75%] lg:max-w-[65%] rounded-lg ${
                                        message.role === 'user'
                                            ? 'bg-blue-600 text-white p-3 sm:p-4'
                                            : 'bg-transparent text-gray-900 dark:text-gray-100 p-0'
                                    }`}
                                >
                                    {message.role === 'assistant' ? (
                                        <div className="markdown-content text-sm sm:text-base leading-relaxed">
                                            <ReactMarkdown
                                                components={{
                                                    table: ({ node, ...props }) => (
                                                        <div className="overflow-x-auto my-4 -mx-2 sm:mx-0">
                                                            <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600" {...props} />
                                                        </div>
                                                    ),
                                                    thead: ({ node, ...props }) => (
                                                        <thead className="bg-gray-100 dark:bg-gray-800" {...props} />
                                                    ),
                                                    th: ({ node, ...props }) => (
                                                        <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left font-semibold text-sm" {...props} />
                                                    ),
                                                    td: ({ node, ...props }) => (
                                                        <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" {...props} />
                                                    ),
                                                    code: ({ node, inline, ...props }) => {
                                                        if (inline) {
                                                            return (
                                                                <code className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono" {...props} />
                                                            );
                                                        }
                                                        return (
                                                            <code className="block bg-gray-100 dark:bg-gray-900 p-3 rounded-lg overflow-x-auto text-sm font-mono my-3" {...props} />
                                                        );
                                                    },
                                                    pre: ({ node, ...props }) => (
                                                        <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded-lg overflow-x-auto my-3 text-sm" {...props} />
                                                    ),
                                                    h1: ({ node, ...props }) => (
                                                        <h1 className="text-2xl font-bold mt-6 mb-3 first:mt-0" {...props} />
                                                    ),
                                                    h2: ({ node, ...props }) => (
                                                        <h2 className="text-xl font-bold mt-5 mb-2 first:mt-0" {...props} />
                                                    ),
                                                    h3: ({ node, ...props }) => (
                                                        <h3 className="text-lg font-semibold mt-4 mb-2 first:mt-0" {...props} />
                                                    ),
                                                    ul: ({ node, ...props }) => (
                                                        <ul className="list-disc list-outside my-3 ml-6 space-y-1" {...props} />
                                                    ),
                                                    ol: ({ node, ...props }) => (
                                                        <ol className="list-decimal list-outside my-3 ml-6 space-y-1" {...props} />
                                                    ),
                                                    li: ({ node, ...props }) => (
                                                        <li className="pl-2" {...props} />
                                                    ),
                                                    p: ({ node, ...props }) => (
                                                        <p className="my-3 first:mt-0 last:mb-0" {...props} />
                                                    ),
                                                    strong: ({ node, ...props }) => (
                                                        <strong className="font-semibold" {...props} />
                                                    ),
                                                    em: ({ node, ...props }) => (
                                                        <em className="italic" {...props} />
                                                    ),
                                                    blockquote: ({ node, ...props }) => (
                                                        <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-3 italic" {...props} />
                                                    ),
                                                    hr: ({ node, ...props }) => (
                                                        <hr className="my-4 border-gray-300 dark:border-gray-600" {...props} />
                                                    ),
                                                }}
                                            >
                                                {message.content}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <div className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed">
                                            {message.content}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="flex justify-start">
                                <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4">
                                    <div className="flex items-center gap-2">
                                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-600 border-t-transparent"></div>
                                        <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">Investigating...</span>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
            </div>

            {/* Input - Smaller */}
            <div className="p-2 sm:p-3 border-t border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 flex-shrink-0">
                    {error && (
                        <div className="mb-1.5 sm:mb-2 p-1.5 sm:p-2 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg text-xs">
                            {error}
                        </div>
                    )}
                    <div className="flex gap-1.5 sm:gap-2 items-end">
                        <div className="flex-1">
                            <label htmlFor="chat-input" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Message
                            </label>
                            <textarea
                                id="chat-input"
                                value={inputMessage}
                                onChange={(e) => setInputMessage(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="Ask about the alert, request investigation, or get recommendations..."
                                rows={1}
                                className="w-full p-2 text-sm border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-purple-500 dark:bg-gray-800 dark:text-gray-100 resize-none"
                                disabled={loading}
                                aria-label="Chat input"
                            />
                        </div>
                        <button
                            onClick={handleSend}
                            disabled={loading || !inputMessage.trim()}
                            className="px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 flex-shrink-0"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                            <span className="hidden sm:inline text-sm">Send</span>
                        </button>
                    </div>
            </div>
        </div>
    );
}

