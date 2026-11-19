// Turn raw host facts into a per-layer automation verdict.
// The OS-specific fact collection lives in scripts/probe-win.ps1; all judgement lives here
// so it can be unit-tested against captured real-world output.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUS = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown',
};

import { rankOf } from './router.js';
import { scanStore } from './store.js';

// A window is semantically drivable when the OS exposes real controls, not just a canvas.
const MIN_NAMED_CONTROLS = 6;

// Classic Win32 controls surfaced through MSAA (oleacc). Self-drawn toolkits (Qt/Flutter/Electron,
// game engines) expose only their own window classes here, which are not operable.
const REAL_CONTROL_CLASS = /^(Sys[A-Z]\w*|RichEdit\w*|Edit$|Button$|ComboBox$|Static$|Afx\w*|WindowsForms\w*|Chrome_\w*|Mozilla\w*|DirectUIHWND|Internet Explorer_Server|Trident)/;

export function hasRealControls(childClasses = []) {
  return childClasses.some(c => REAL_CONTROL_CLASS.test(c));
}

export function classify(facts, { connectors = [] } = {}) {
  const layers = [];
  const has = (l) => connectors.some(c => c.layer === l);
  const add = (id, status, evidence, note) => layers.push({ id, rank: rankOf(id), status, evidence, note });

  add('official-api',
    has('official-api') ? STATUS.AVAILABLE : STATUS.UNKNOWN,
    has('official-api') ? ['connector installed'] : [],
    has('official-api') ? 'Official connector available.' : 'No official API connector installed. Check the vendor developer portal before automating.');

  const allStores = facts.stores ?? [];
  const stores = allStores.filter(s => s.total > 0);
  const plain = stores.filter(s => s.plaintext > 0);
  const enc = stores.filter(s => s.encrypted > 0 && s.plaintext === 0);
  // A directory that only holds WebView2/Chromium runtime databases is not an app store: say so
  // instead of reporting a readable store that contains nothing an agent wants.
  const noAppData = allStores.filter(s => s.total === 0 && (s.noise?.length ?? 0) > 0);
  const storeEvidence = stores.flatMap(s => [s.dir,
    `total=${s.total} plaintext=${s.plaintext} encrypted=${s.encrypted} bytes=${s.totalBytes}`,
    ...s.largest.slice(0, 2).map(f => `${f.name} ${f.size}B ${f.state}`)]);
  add('local-store',
    plain.length ? STATUS.AVAILABLE : enc.length ? STATUS.BLOCKED : STATUS.UNAVAILABLE,
    storeEvidence.length ? storeEvidence : noAppData.map(s => `${s.dir} (runtime databases only: ${s.noise.slice(0, 3).join(', ')})`),
    !stores.length
      ? (noAppData.length
        ? 'Only browser/WebView2 runtime databases found. That directory holds no app data; point --store at the real data directory.'
        : 'No local database store found.')
      : plain.length ? 'Plain SQLite store found: readable directly for interoperability and backup, without touching the UI.'
        : 'The local store exists but is encrypted (SQLCipher-style) and the key is not on disk. Reading it would require extracting a key from a running process or bypassing app protections; not done here. Use an official API or Computer Use instead.');
  const schemes = facts.schemes ?? [];
  add('scripting', schemes.length ? STATUS.AVAILABLE : STATUS.UNAVAILABLE, schemes.map(s => `${s.scheme}:// (${s.scope})`),
    schemes.length ? 'Only a URL protocol handler was found. That is a coarse entry point (open/deep-link), not an arbitrary command interface.'
      : 'No URL protocol handler launches this executable.');

  const listeners = facts.listeners ?? [];
  add('private-api', listeners.length ? STATUS.BLOCKED : STATUS.UNAVAILABLE, listeners,
    listeners.length
      ? 'Only loopback IPC listeners found. Speaking an app private protocol is out of policy scope: it breaks service terms and triggers anti-automation bans. Use this project on APIs you are authorized to call.'
      : 'No local listener found. Capture traffic with the app own client if it calls a remote API you are authorized to use.');

  const cdpPorts = facts.cdpPorts ?? [];
  const cdpOk = (facts.cdpProbe ?? []).filter(p => p.ok);
  const chromiumish = /chromium|--type=|--user-lib-dir|--remote-debugging/i.test((facts.instances ?? []).map(i => i.cmd ?? '').join(' '));
  // WebView2 (Tauri, Edge, WinUI) hosts Chromium in msedgewebview2.exe children, so the app process
  // itself never looks Chromium; without this the note is a false "Not a Chromium app".
  const webview2 = facts.webview2?.detected === true;
  add('devTools',
    cdpOk.length ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    cdpOk.length ? cdpOk.map(p => `http://127.0.0.1:${p.port}`) : cdpPorts,
    cdpOk.length ? 'Chrome DevTools Protocol reachable: full DOM and network access.'
      : webview2 ? 'WebView2 app (Tauri/Edge): the UI runtime is Chromium. Set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 and restart the app to enable this layer.'
        : chromiumish ? 'Chromium-based processes detected but no remote debugging port is open. Restart the app with --remote-debugging-port=<port> to enable this layer.'
          : 'Not a Chromium app.');

  const windows = facts.windows ?? [];
  const named = windows.reduce((n, w) => n + (w.uiaNamedControl ?? 0), 0);
  const descendants = windows.reduce((n, w) => n + (w.uiaDescendants ?? 0), 0);
  const classes = [...new Set(windows.flatMap(w => w.childClasses ?? []))];
  const samples = [...new Set(windows.flatMap(w => w.uiaSamples ?? []))].slice(0, 6);
  const semantic = named >= MIN_NAMED_CONTROLS;
  const legacy = hasRealControls(classes);
  const drivable = semantic || legacy;
  add('accessibility',
    drivable ? STATUS.AVAILABLE : windows.length ? STATUS.BLOCKED : STATUS.UNKNOWN,
    windows.length
      ? [`${windows.length} top-level window(s)`, `descendants=${descendants}`, `namedControls=${named}`,
         ...(classes.length ? [`childClasses=${classes.join(',')}`] : []), ...samples.map(s => `name:${s}`)]
      : [],
    drivable
      ? (legacy && !semantic
        ? 'Drivable through MSAA controls (classic Win32 widgets). Operate controls by role/name instead of pixels.'
        : 'Semantic automation available: drive controls by name instead of pixels.')
      : windows.length
        ? 'Self-drawn UI: the accessibility tree exposes no operable controls. Computer Use (pixels) is the only remaining layer for this app.'
        : 'App is not running.');

  add('computer-use', STATUS.AVAILABLE, [], 'Always available as the last resort, but the slowest and most fragile layer.');

  layers.sort((a, b) => a.rank - b.rank);
  const recommended = layers.find(l => l.status === STATUS.AVAILABLE) ?? null;
  return {
    app: facts.processName,
    running: !!facts.running,
    layers,
    recommended: recommended?.id ?? null,
    blocked: layers.filter(l => l.status === STATUS.BLOCKED).map(l => l.id),
    stores: (facts.stores ?? []).map(s => ({ dir: s.dir, total: s.total, plaintext: s.plaintext, encrypted: s.encrypted })),
  };
}

const SCRIPT = { win32: 'scripts/probe-win.ps1' };

function defaultRunner(script, args) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error(`probe is not implemented for ${process.platform}`));
    const root = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(root, '..', script);
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { maxBuffer: 16 * 1024 * 1024, timeout: 120000 },
      (err, stdout) => err ? reject(new Error(`probe failed: ${stdout || err.message}`)) : resolve(stdout));
  });
}

export async function probeApp(processName, { connectors = [], runner = defaultRunner, storeDirs = [] } = {}) {
  const script = SCRIPT[process.platform];
  if (!script) throw new Error(`probe is not implemented on ${process.platform} yet`);
  const raw = await runner(script, ['-ProcessName', processName]);
  const facts = JSON.parse(raw.replace(/^\uFEFF+/, '').trim());
  facts.stores = storeDirs.map(d => scanStore(d));
  return { facts, verdict: classify(facts, { connectors }) };
}