import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

const VT_ENDPOINT = 'https://www.virustotal.com/api/v3/ip_addresses/';

const isValidIPv4 = (ip) => {
    const parts = ip.split('.').map((p) => Number(p));
    return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
};

const isPrivateIPv4 = (ip) => {
    if (!isValidIPv4(ip)) return true;
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    return false;
};

export async function POST(request) {
    try {
        const body = await request.json();
        const { ips } = body || {};

        if (!Array.isArray(ips) || ips.length === 0) {
            return NextResponse.json({ enabled: false, results: [] });
        }

        const settingsSnap = await getDoc(doc(db, 'settings', 'integrations'));
        const vtApiKey = settingsSnap.exists() ? settingsSnap.data()?.virusTotalApiKey : '';
        if (!vtApiKey) {
            return NextResponse.json({ enabled: false, results: [] });
        }

        const uniqueIps = Array.from(new Set(ips.map((ip) => String(ip).trim()).filter(Boolean)));
        const publicIps = uniqueIps.filter((ip) => isValidIPv4(ip) && !isPrivateIPv4(ip));

        const results = [];
        for (const ip of publicIps.slice(0, 10)) {
            try {
                const res = await fetch(`${VT_ENDPOINT}${encodeURIComponent(ip)}`, {
                    headers: { 'x-apikey': vtApiKey }
                });
                if (!res.ok) {
                    results.push({ ip, error: `VT error ${res.status}` });
                    continue;
                }
                const data = await res.json();
                const stats = data?.data?.attributes?.last_analysis_stats || {};
                const malicious = Number(stats.malicious || 0);
                const suspicious = Number(stats.suspicious || 0);
                const harmless = Number(stats.harmless || 0);
                const undetected = Number(stats.undetected || 0);
                const reputation = Number(data?.data?.attributes?.reputation || 0);
                results.push({
                    ip,
                    malicious,
                    suspicious,
                    harmless,
                    undetected,
                    reputation
                });
            } catch (err) {
                results.push({ ip, error: err.message });
            }
        }

        return NextResponse.json({ enabled: true, results });
    } catch (error) {
        return NextResponse.json({ enabled: false, results: [], error: error.message }, { status: 500 });
    }
}
