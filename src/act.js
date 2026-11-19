// The accessibility layer, actually driving: snapshot a native app control tree, act by name/id,
// then re-read the tree to check the action landed. Only Windows UI Automation patterns are used
// (Invoke / Toggle / SelectionItem / Value). Coordinates, mouse and key synthesis are absent by
// design: a caller who wants pixels is told so instead of being silently given something weaker.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACT_MODES = ['list', 'invoke', 'set', 'get'];

// Anything that addresses the screen or raw input rather than a control.
const PIXEL_ARG = /^--(x|y|click|mouse|screenshot|key|keypress|type|press|coord|coords|drag|scroll)$/i;

export function rejectPixelArgs(args = []) {
  const hit = args.find(a => PIXEL_ARG.test(String(a).split('=')[0]));
  return hit ?? null;
}

export function normalizeName(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

// Resolution order: exact AutomationId, exact name, then substring - always preferring on-screen
// controls, because an offscreen duplicate is what makes naive automation press the wrong thing.
export function pickTarget(elements = [], { name = '', autoId = '', index = 0 } = {}) {
  const listed = Array.isArray(elements) ? elements : [];
  const visible = listed.filter(e => !e.offscreen);
  const pool = visible.length ? visible : listed;
  const id = String(autoId ?? '').trim();
  const want = normalizeName(name);
  let candidates = id ? pool.filter(e => String(e.autoId ?? '') === id) : [];
  if (!candidates.length && want) {
    candidates = pool.filter(e => normalizeName(e.name) === want);
    if (!candidates.length) candidates = pool.filter(e => normalizeName(e.name).toLowerCase().includes(want.toLowerCase()));
  }
  if (!candidates.length) {
    return { target: null, candidates: [], reason: id ? `no element matched autoId "${id}"` : want ? `no element matched name "${want}"` : 'no selector given (use --name or --autoId)' };
  }
  const i = Number(index) || 0;
  if (i < 0 || i >= candidates.length) return { target: null, candidates, reason: `index ${i} out of range (${candidates.length} candidate(s))` };
  return { target: candidates[i], candidates, reason: null };
}

// The pattern that will actually be used, so the plan shown before acting is the real one.
export function patternFor(target, action) {
  const a = target?.actions ?? [];
  if (action === 'invoke') return a.includes('invoke') ? 'Invoke' : a.includes('toggle') ? 'Toggle' : a.includes('select') ? 'SelectionItem' : null;
  if (action === 'set') return a.includes('set') ? 'Value' : null;
  if (action === 'list' || action === 'get') return null;
  return null;
}

export function describeTarget(target) {
  if (!target) return '(none)';
  const id = target.autoId ? ` autoId=${target.autoId}` : '';
  return `${target.controlType ?? '?'} "${target.name ?? ''}"${id}`;
}
function defaultRunner(args) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error(`cxa act needs Windows UI Automation; ${process.platform} is not implemented`));
    const root = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(root, '..', 'scripts', 'uia-act.ps1');
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { maxBuffer: 16 * 1024 * 1024, timeout: 120000, windowsHide: true },
      (err, stdout, stderr) => {
        const text = String(stdout ?? '').trim().replace(/^\uFEFF+/, '');
        if (!text) return reject(new Error(`uia-act produced no output${stderr ? ': ' + String(stderr).trim() : ''}`));
        const start = text.indexOf('{');
        try { resolve(JSON.parse(text.slice(start))); } catch { reject(new Error('uia-act returned unparsable output: ' + text.slice(0, 300))); }
      });
  });
}

export function actArgs({ processName, mode = 'list', name = '', autoId = '', index = 0, value = '', window = '', limit = 300 } = {}) {
  const args = ['-ProcessName', String(processName), '-Mode', mode];
  if (name) args.push('-Name', String(name));
  if (autoId) args.push('-AutoId', String(autoId));
  if (index) args.push('-Index', String(index));
  if (value !== '' && value !== undefined) args.push('-Value', String(value));
  if (window) args.push('-Window', String(window));
  if (limit) args.push('-Limit', String(limit));
  return args;
}

export async function runAct(options = {}) {
  const { mode = 'list', runner = defaultRunner } = options;
  if (!ACT_MODES.includes(mode)) throw new Error(`unknown action "${mode}"; expected ${ACT_MODES.join(' / ')}`);
  if (!options.processName) throw new Error('process name is required');
  return runner(actArgs(options));
}