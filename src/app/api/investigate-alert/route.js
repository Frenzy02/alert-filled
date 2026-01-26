import { NextResponse } from 'next/server';
import { Ollama } from 'ollama';

const OLLAMA_API_KEY = 'e64ebfbd369a43a09b2a3bebef35d673.qQvwNTLwqnxIAd4KzaXNEmDj';
const OLLAMA_HOST = 'https://ollama.com'; // Ollama Cloud instance

// Create Ollama client with custom headers for authentication
const ollama = new Ollama({
    host: OLLAMA_HOST,
    headers: {
        'Authorization': `Bearer ${OLLAMA_API_KEY}`
    }
});

export async function POST(request) {
    try {
        const body = await request.json();
        const { messages, jsonData } = body;

        if (!messages || !Array.isArray(messages)) {
            return NextResponse.json(
                { error: 'Messages array is required' },
                { status: 400 }
            );
        }

        // Prepare the system prompt with alert context
        const alertName = jsonData?.xdr_event?.display_name || jsonData?.event_name || 'Unknown Alert';
        const alertDescription = jsonData?.xdr_event?.description || '';
        const alertData = JSON.stringify(jsonData, null, 2);

        const systemPrompt = `You are an expert Security Operations Center (SOC) analyst investigating security alerts. Your role is to analyze alert data and provide detailed, accurate, and actionable insights.

Alert Information:
- Alert Name: ${alertName}
- Description: ${alertDescription}

When the user asks you to "investigate" an alert, you MUST provide a detailed investigation following these guidelines:

## Investigation Requirements

When investigating an alert, clearly describe how the alert was triggered, including:
- The specific process, user action, or system activity that caused it
- Any relevant registry, file, or network events
- The exact timestamp of the event
- Location details: device name, user, tenant, IP address, geolocation, and operating system
- Summary of what was observed, noting any suspicious or unusual behavior
- The severity of the alert
- Assessment of whether the activity appears legitimate or potentially risky
- Actionable recommendations, such as:
  * Verifying the activity with the user or department
  * Auditing affected systems or configurations
  * Running scans or mitigations
  * Monitoring for recurrence
- Maintain a professional and concise tone, highlighting potential risks without overstating them

Format your investigation response as follows:

## Alert Name & Metadata

Alert Name: [Alert Name from JSON]
Detection Source: [Source system, e.g., ESET Protect, SentinelOne, etc.]
Tenant: [Tenant/Organization name if available]
Severity: [Severity level from JSON]
Event Score: [Score from JSON if available]
Source IP: [IP address] ([Public/Private], [Location/Geolocation if available])
Process Name: [Process name from JSON]
Trigger Event / Registry Path: [Relevant path or event from JSON]
Timestamp (UTC): [Formatted timestamp]
Device Name: [Device/Host name from JSON]
User: [User account from JSON]
Operating System: [OS information if available]

## Investigation

### Summary
[Clearly describe how the alert was triggered, including the specific process, user action, or system activity that caused it. Mention any relevant registry, file, or network events. Include the exact timestamp and location details (device name, user, tenant, IP address, geolocation, OS). Summarize what was observed, noting any suspicious or unusual behavior, the severity of the alert, and whether the activity appears legitimate or potentially risky. Keep it professional and concise, highlighting potential risks without overstating them.]

### Observations
- [Observation 1: Describe specific behavior, process, or event observed]
- [Observation 2: Note any suspicious or unusual patterns]
- [Observation 3: Assess severity and legitimacy]
- [Additional observations as needed: Include details about registry changes, file modifications, network activity, user context, etc.]

### Recommended Actions
- [Action 1: Verify the activity with the user or department]
- [Action 2: Audit affected systems or configurations]
- [Action 3: Run scans or apply mitigations if needed]
- [Action 4: Monitor for recurrence or related activities]
- [Additional actionable recommendations as appropriate]

---

When the user asks for a "client message" or "client-ready message", you MUST format it as follows:

## Client-Ready Message Requirements

For the client-ready message, you MUST:
- Explain how the alert was detected, specifying which system or sensor triggered it
- Specify the activity or process that caused it
- Clearly describe what happened and why it could pose a risk
- Use language that is understandable to the client while avoiding unnecessary technical jargon
- Advise the client on next steps, such as confirming whether the activity is authorized or taking action if it is unauthorized
- Keep the message concise, respectful, and neutral
- Focus on verification rather than assuming malicious intent
- ALWAYS end with: "Kindly confirm if this activity is authorized or related to your operations."

Format your client-ready message as a plain paragraph (NO heading, NO markdown formatting). Start directly with "We detected" and write the message as a single, well-formatted paragraph. Do NOT use headings like "## Client-Ready Message" or "### Client-Ready Message". Just write the message starting with "We detected" and continue naturally.

Example format:
We detected [explanation of how the alert was detected, specifying which system or sensor triggered it and the activity or process that caused it]. [Clearly describe what happened and why it could pose a risk, using language that is understandable to the client while avoiding unnecessary technical jargon]. [Advise the client on next steps, such as confirming whether the activity is authorized or taking action if it is unauthorized]. Keep the message concise, respectful, and neutral, focusing on verification rather than assuming malicious intent. ALWAYS end with: "Kindly confirm if this activity is authorized or related to your operations."

---

For all other questions (not investigation/client reporting), provide accurate, detailed, and helpful answers based on the alert JSON data. Be thorough, professional, and focus on actionable security insights.`;

        // Build messages array with alert context
        const messagesWithContext = [
            {
                role: 'system',
                content: systemPrompt
            },
            ...messages.slice(1).map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            {
                role: 'user',
                content: `${messages[messages.length - 1]?.content || ''}\n\nAlert JSON Data:\n\`\`\`json\n${alertData}\n\`\`\``
            }
        ];

        // Use Ollama JavaScript library to make the chat request
        // Try gpt-oss:20b first (as shown in the Ollama library), fallback to gpt-oss:120b
        const modelName = 'gpt-oss:20b';
        
        console.log('Making Ollama request with:', {
            host: OLLAMA_HOST,
            model: modelName,
            messagesCount: messagesWithContext.length,
            hasApiKey: !!OLLAMA_API_KEY,
            firstMessagePreview: messagesWithContext[0]?.content?.substring(0, 100)
        });
        
        let response;
        try {
            response = await ollama.chat({
                model: modelName,
                messages: messagesWithContext,
                stream: false,
                options: {
                    temperature: 0.7
                }
            });
            
            console.log('Ollama response received:', {
                responseType: typeof response,
                hasMessage: !!response?.message,
                hasContent: !!response?.message?.content,
                responseKeys: response ? Object.keys(response) : []
            });
        } catch (ollamaError) {
            console.error('Ollama chat error:', ollamaError);
            
            // If gpt-oss:20b fails, try gpt-oss:120b as fallback
            if (modelName === 'gpt-oss:20b' && !ollamaError.message?.includes('401')) {
                console.log('Trying fallback model: gpt-oss:120b');
                try {
                    response = await ollama.chat({
                        model: 'gpt-oss:120b',
                        messages: messagesWithContext,
                        stream: false,
                        options: {
                            temperature: 0.7
                        }
                    });
                    console.log('Fallback model succeeded');
                } catch (fallbackError) {
                    console.error('Fallback model also failed:', fallbackError);
                    throw ollamaError; // Throw original error
                }
            } else {
                throw ollamaError;
            }
        }

        // Handle different response structures
        const content = response?.message?.content || response?.content || 'No response from AI';
        
        if (!content || content === 'No response from AI') {
            console.warn('No content in response:', response);
        }

        return NextResponse.json({
            content: content
        });

    } catch (error) {
        console.error('Error in investigate-alert API:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            cause: error.cause
        });
        
        // Check for specific error types
        if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
            return NextResponse.json(
                { 
                    error: 'Authentication failed. Please check your API key.',
                    details: error.message
                },
                { status: 401 }
            );
        }
        
        if (error.message?.includes('fetch') || error.message?.includes('network') || error.message?.includes('ECONNREFUSED')) {
            return NextResponse.json(
                { 
                    error: 'Failed to connect to Ollama API. Please check the host URL and your internet connection.',
                    details: error.message
                },
                { status: 503 }
            );
        }
        
        return NextResponse.json(
            { 
                error: 'Failed to process request: ' + error.message,
                details: error.stack
            },
            { status: 500 }
        );
    }
}

