const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

// Load .env.local if present
try {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch (e) {
  // ignore env load errors
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

const required = Object.entries(firebaseConfig).filter(([, v]) => !v).map(([k]) => k);
if (required.length) {
  console.error(`Missing Firebase env vars: ${required.join(', ')}`);
  process.exit(1);
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

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

  const procIdx = lines.findIndex((l) => processLabel.test(l) || processLabelAlt.test(l));
  if (procIdx >= 0) {
    processName = lines[procIdx + 1] || null;
  }

  const candidateLines = lines.filter((l, idx) => {
    if (idx === procIdx) return false;
    if (procIdx >= 0 && idx === procIdx + 1) return false;
    return true;
  });

  const alertHeader = candidateLines.find((l) => /alert|detection|threat|event|signature/i.test(l) || /:/.test(l));
  if (alertHeader) {
    alertTitleOrSignature = alertHeader;
    reason = candidateLines.filter((l) => l !== alertTitleOrSignature).join(' ');
  } else {
    alertTitleOrSignature = '';
    reason = candidateLines.join(' ');
  }

  if (!reason && lines.length > 1) {
    reason = lines.slice(1).join(' ');
  }

  if (!processName) {
    const exeMatch = raw.match(/([A-Za-z0-9._-]+\.exe)\b/i);
    if (exeMatch) processName = exeMatch[1];
  }

  const ipMatch = raw.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  if (ipMatch) ipAddress = ipMatch[1];

  appliesToAllAlerts = /all\s+(endpoints|endpoint|devices|hosts|machines|servers|alerts|alert names)/i.test(raw);

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

const entries = [
  `For tenant siycha; ESET Protect (ESET Inspect Alert): Unpopular process makes HTTP request to a popular Web Service,  with the process name tableau.exe has now been whitelisted. If you encounter like this again, tag it as FP, Whitelisted and Remediated.`,
  `For tenant siycha ESET Protect (ESET Inspect Alert): PowerShell Creates an External Network Connection [A0502b]
A Powershell Creates an External Network Connection was detected and has been verified as whitelisted, legitimate activity associated with Kaseya.`,
  `For tenant siycha The endpoint uc-co-hlegaspi with the process name cursorchanger.exe has now been remediated by Sir Justine, if this alert shows up again it needs to be reported again as it shows the executable still has remnants in the user's endpoint.`,
  `For tenant siycha ESET Protect (ESET Inspect Alert): Injection into system process [F0413c][C].The alert was triggered by the executable reader_en_install.exe on the device associated with user uc-fi-jingdacu(whitelisted)`,
  `For tenant siycha (appflowy.exe) Unpopular process makes HTTP request to a popular Web Service has now been whitelisted across all endpoints as per Sir Justine, if you encounter this alert in Stellar again, just tag it as FP and Whitelisted.`,
  `For tenant siycha ESET Protect (ESET Inspect Alert): Common AutoStart registry modified by an unpopular process [A0103a]`,
  `For tenant siycha The endpoint uc-co-hlegaspi with the process name cursorchanger.exe has now been remediated by Sir Justine, if this alert shows up again it needs to be reported again as it shows the executable still has remnants in the user's endpoint.`,
  `For tenant siycha ESET Protect (ESET Inspect Alert): Injection into system process. The alert was triggered by the executable reader_en_install.exe on the device associated with user uc-fi-jingdacu (whitelisted)`,
  `In tenant siycha, the process C:\\Program Files (x86)\\Microsoft SQL Server Management Studio 20\\Common7\\IDE\\CommonExtensions\\Microsoft\\SSIS\\160\\Binn\\DTSWizard.exe is alreaddy filtered on server UCFCFISDB501 as sir Justine said that this is a confirmed application in that server. If you received an alert regarding this process in different Device or server kindly send a report for confirmation if this process is authorized for use in this server or device.`,
  `For tenant siycha ESET Protect (ESET Inspect Alert): Common AutoStart registry modified by an unpopular process [A0103a]
Process Name:
%LOCALAPPDATA%\\programs\\twinkle-tray\\twinkle tray.exe
Sir Justin confirmed to whitelist the twinkle tray software only for this device UC-DR-JPADLAN as legitimate software since they use it to adjust the brightness on their device.`,
  `For tenant siycha ESET Protect (ESET Inspect Alert): Dropped Executable Similar to a Known Malware [X0402]
The client confirmed to whitelist the Kaseya VSA X automation process for all endpoints as legitimate software. The PowerShell script executed through Kaseya VSA X remote management platform is authorized activity.`,
  `For tenant siycha The application  knime.exe is authorized  and whitelisted as per si Justine. For the server that only has KNIME detection.
ESET Protect (ESET Inspect Alert): External SSL Comms Over Non-Standard Port, Unpopular Process [E0523]
processname:
%LOCALAPPDATA%\\programs\\knime\\knime.exe`
];

(async () => {
  for (const rawText of entries) {
    const parsed = parseWhitelistText(rawText);
    if (!parsed.rawText) continue;
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
    console.log('Added whitelist:', parsed.alertTitleOrSignature || parsed.processName || parsed.rawText.slice(0, 60));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
