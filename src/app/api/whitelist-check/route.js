import { NextResponse } from 'next/server';
import { Ollama } from 'ollama';

const OLLAMA_API_KEY = 'e64ebfbd369a43a09b2a3bebef35d673.qQvwNTLwqnxIAd4KzaXNEmDj';
const OLLAMA_HOST = 'https://ollama.com';

const ollama = new Ollama({
    host: OLLAMA_HOST,
    headers: {
        Authorization: `Bearer ${OLLAMA_API_KEY}`
    }
});

const SHEET_CSV_URLS = (
    process.env.WHITELIST_SHEET_CSV_URLS ||
    process.env.WHITELIST_SHEET_CSV_URL ||
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vTBhlnIR9nfS0wF4UR8gc-vrX5nabBoUFIK0cyFKlFCnXDJnQH05G6NrGeqyh0gUp2Cywi4UoLoghja/pub?output=csv,https://docs.google.com/spreadsheets/d/e/2PACX-1vQ5DKp_rPWCyn5k3Gxdq2920kPZFLqgCJ7VrgeyHf3KfGPpvpo9pIvBt9IBmkScmbrQK2UKFlSeG-Wd/pub?output=csv'
).split(',').map((u) => u.trim()).filter(Boolean);
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedMessages = null;
let cachedAt = 0;

const parseCsv = (text) => {
    const rows = [];
    let current = '';
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];
        if (char === '"' && next === '"' && inQuotes) {
            current += '"';
            i++;
            continue;
        }
        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (char === ',' && !inQuotes) {
            row.push(current);
            current = '';
            continue;
        }
        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i++;
            row.push(current);
            if (row.some((c) => c.trim() !== '')) rows.push(row);
            row = [];
            current = '';
            continue;
        }
        current += char;
    }
    if (current || row.length) {
        row.push(current);
        if (row.some((c) => c.trim() !== '')) rows.push(row);
    }
    return rows;
};

const getCaseStatus = (text) => {
    const t = (text || '').toLowerCase();
    if (t.includes('resolved')) return 'Resolved';
    if (t.includes('confirmed')) return 'Confirmed';
    if (t.includes('whitelist')) return 'Whitelisted';
    return '';
};

const getVerificationStatus = (text) => {
    const t = (text || '').toLowerCase();
    if (t.includes('true positive')) return 'True Positive';
    if (t.includes('false positive')) return 'False Positive';
    if (t.includes('to be confirmed')) return 'To Be Confirmed';
    return '';
};

const getRemediationStatus = (text) => {
    const t = (text || '').toLowerCase();
    if (t.includes('not remediated')) return 'Not Remediated';
    if (t.includes('remediated')) return 'Remediated';
    return '';
};

const buildMessagesFromSheet = (csvText) => {
    const rows = parseCsv(csvText);
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const colAlert = header.indexOf('alert name');
    const colAction = header.indexOf('action');
    const colConfirmation = header.indexOf('confirmation');
    const colValue = 2; // column C often holds value/detail

    const messages = [];
    let currentCaseStatus = '';
    let currentVerification = '';
    let currentRemediation = '';
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const alertName = colAlert >= 0 ? (r[colAlert] || '').trim() : '';
        const action = colAction >= 0 ? (r[colAction] || '').trim() : '';
        const value = r[colValue] ? r[colValue].trim() : '';
        const confirmation = colConfirmation >= 0 ? (r[colConfirmation] || '').trim() : '';
        const caseFromAlert = getCaseStatus(alertName);
        const verificationFromAlert = getVerificationStatus(alertName);
        const remediationFromAlert = getRemediationStatus(alertName);
        if ((caseFromAlert || verificationFromAlert || remediationFromAlert) && !action && !value && !confirmation) {
            if (caseFromAlert) currentCaseStatus = caseFromAlert;
            if (verificationFromAlert) currentVerification = verificationFromAlert;
            if (remediationFromAlert) currentRemediation = remediationFromAlert;
            continue;
        }
        if (!alertName && !action && !value && !confirmation) continue;
        const statusText = `${alertName} ${confirmation}`;
        const caseStatus = getCaseStatus(statusText) || currentCaseStatus || '';
        const verification = getVerificationStatus(statusText) || currentVerification || '';
        const remediation = getRemediationStatus(statusText) || currentRemediation || '';
        messages.push({
            alertName,
            action,
            value,
            confirmation,
            caseStatus,
            verification,
            remediation
        });
    }
    return messages;
};

export async function POST(request) {
    try {
        const body = await request.json();
        const { alertData, whitelistMessages } = body;

        if (!alertData) {
            return NextResponse.json(
                { error: 'alertData is required' },
                { status: 400 }
            );
        }
        let messages = Array.isArray(whitelistMessages) ? whitelistMessages : [];
        if (!messages.length) {
            const now = Date.now();
            if (cachedMessages && now - cachedAt < CACHE_TTL_MS) {
                messages = cachedMessages;
            } else {
            const allMessages = [];
            for (const url of SHEET_CSV_URLS) {
                const sheetRes = await fetch(url, { cache: 'no-store' });
                if (!sheetRes.ok) continue;
                const csvText = await sheetRes.text();
                const parsed = buildMessagesFromSheet(csvText);
                allMessages.push(...parsed);
            }
            messages = allMessages;
                cachedMessages = messages;
                cachedAt = now;
            }
        }
        if (!messages.length) {
            return NextResponse.json({ whitelisted: false, reason: '', matchedMessage: '' });
        }

        const alertName = alertData?.xdr_event?.display_name || alertData?.event_name || 'Unknown Alert';
        const alertDescription = alertData?.xdr_event?.description || alertData?.description || '';
        const hostName = alertData?.host?.name || alertData?.hostname || '';
        const tenantName = alertData?.tenant_name || alertData?.tenant || '';

        const systemPrompt = `You are a SOC analyst. Decide if an alert should be considered WHITELISTED or fall under other statuses based on the provided messages.

Rules:
- A whitelist message can be free-form text and may apply to all alerts or only specific alerts.
- If the message says "all endpoints", "all alerts", or similar, it can apply across alert names.
- Use alert name, description, process, device/host, tenant, and other context.
- A match MUST align on tenant if the message mentions a tenant.
- A match MUST align on process or executable if the message mentions a process/exe/path.
- A match MUST align on device/host if the message mentions a specific device.
- Be strict: only return whitelisted=true if there is a clear, specific match.
- If no message matches, return whitelisted=false.

Respond with strict JSON only, no markdown:
{"whitelisted": boolean, "matchedIndex": number, "reason": string}`;

        const context = {
            alertName,
            description: alertDescription,
            hostName,
            tenantName,
            alertData
        };

        const userPrompt = `Whitelist messages:\n${messages.map((m, i) => `${i + 1}. CASE=${m.caseStatus} | VERIFICATION=${m.verification} | REMEDIATION=${m.remediation} | ALERT=${m.alertName} | ACTION=${m.action} | VALUE=${m.value} | CONFIRMATION=${m.confirmation}`).join('\n')}\n\nAlert context:\n${JSON.stringify(context, null, 2)}\n\nReturn JSON only. If matched, return matchedIndex (1-based).`;

        const response = await ollama.chat({
            model: 'gpt-oss:20b',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            stream: false,
            options: { temperature: 0.2 }
        });

        const content = response?.message?.content || '';
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch {
            return NextResponse.json({ whitelisted: false, reason: '', matchedMessage: '' });
        }

        const idx = Number(parsed.matchedIndex || 0);
        const matched = idx >= 1 && idx <= messages.length ? messages[idx - 1] : null;
        return NextResponse.json({
            whitelisted: !!parsed.whitelisted && !!matched,
            reason: String(parsed.reason || ''),
            matchedMessage: matched ? [matched.alertName, matched.action, matched.value, matched.confirmation].filter(Boolean).join(' - ') : '',
            status: matched?.caseStatus || '',
            verification: matched?.verification || '',
            remediation: matched?.remediation || ''
        });
    } catch (error) {
        return NextResponse.json(
            { error: 'Whitelist AI check failed: ' + error.message },
            { status: 500 }
        );
    }
}
