// Emit the same MCP server entry in the shape each agent host expects.
//
// Every host below speaks the same stdio protocol; only the file format and key names differ.
// Formats follow the vendor docs as of 2026-11: Codex uses TOML tables, Cursor and Copilot use
// mcpServers, the VS Code editor-managed workspace file uses servers with an explicit type.
//
// Windows detail: Node cannot spawn `npx` directly, because it is a .cmd shim (spawn gives ENOENT).
// Hosts that run the command without a shell, Codex included, therefore need cmd.exe on Windows.
import fs from 'node:fs';
import path from 'node:path';

export const SERVER_NAME = 'connect-anything';
export const GIT_SPEC = 'github:Zhang-Dongfang/connect-anything';
export const TABLE = 'mcp_servers.' + SERVER_NAME;

export const HOSTS = [
  { id: 'claude', path: '.mcp.json', format: 'json', key: 'mcpServers', note: 'Claude Code project scope; also the portable file VS Code Copilot can read' },
  { id: 'cursor', path: '.cursor/mcp.json', format: 'json', key: 'mcpServers', note: 'Cursor, project scope' },
  { id: 'copilot', path: '.copilot/mcp-config.json', format: 'json', key: 'mcpServers', note: 'VS Code Copilot, native global config' },
  { id: 'vscode', path: '.vscode/mcp.json', format: 'json', key: 'servers', typed: true, note: 'VS Code, editor-managed workspace config' },
  { id: 'codex', path: '.codex/config.toml', format: 'toml', shellOnWindows: true, note: 'Codex CLI and IDE extension, project scope' }
];

function isWindows(platform) {
  return (platform || process.platform) === 'win32';
}

export function serverEntry(opts = {}) {
  if (opts.typed) return { type: 'stdio', command: 'npx', args: ['-y', GIT_SPEC, 'serve'] };
  if (opts.shellOnWindows && isWindows(opts.platform)) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npx', '-y', GIT_SPEC, 'serve'] };
  }
  return { command: 'npx', args: ['-y', GIT_SPEC, 'serve'] };
}

export function hostById(id) {
  return HOSTS.find(function (h) { return h.id === id; }) || null;
}

export function configText(id, opts = {}) {
  const host = hostById(id);
  if (!host) throw new Error('unknown host ' + id + '; pick one of ' + HOSTS.map(function (h) { return h.id; }).join(', '));
  const entry = serverEntry({ typed: host.typed, shellOnWindows: host.shellOnWindows, platform: opts.platform });
  if (host.format === 'toml') {
    const args = entry.args.map(function (a) { return JSON.stringify(a); }).join(', ');
    return ['[' + TABLE + ']', 'command = ' + JSON.stringify(entry.command), 'args = [' + args + ']', ''].join('\n');
  }
  const one = {};
  one[SERVER_NAME] = entry;
  const body = {};
  body[host.key] = one;
  return JSON.stringify(body, null, 2) + '\n';
}

/** Replace our TOML table, or append it, without touching the others. */
function mergeToml(existing, block) {
  const lines = (existing || '').split(/\r?\n/);
  const header = '[' + TABLE + ']';
  const start = lines.findIndex(function (l) { return l.trim() === header; });
  const blockLines = block.trimEnd().split('\n');
  if (start < 0) {
    const tail = (existing || '').trimEnd();
    return (tail ? tail + '\n\n' : '') + blockLines.join('\n') + '\n';
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  return lines.slice(0, start).concat(blockLines, lines.slice(end)).join('\n').replace(/\n{3,}/g, '\n\n');
}

export function mergeInto(existing, id, opts = {}) {
  const host = hostById(id);
  if (!host) throw new Error('unknown host ' + id);
  if (host.format === 'toml') return mergeToml(existing, configText(id, opts));
  let parsed = {};
  if (existing && existing.trim()) {
    try {
      parsed = JSON.parse(existing);
    } catch (e) {
      throw new Error('existing ' + host.path + ' is not valid JSON: ' + e.message);
    }
  }
  const current = parsed[host.key] || {};
  current[SERVER_NAME] = serverEntry({ typed: host.typed, shellOnWindows: host.shellOnWindows, platform: opts.platform });
  parsed[host.key] = current;
  return JSON.stringify(parsed, null, 2) + '\n';
}

export function writeConfig(id, opts = {}) {
  const host = hostById(id);
  if (!host) throw new Error('unknown host ' + id);
  const dir = opts.dir || process.cwd();
  const target = path.join(dir, host.path);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (existing && opts.force === false) throw new Error(target + ' already exists; pass --force to merge into it');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, mergeInto(existing, id, { platform: opts.platform }), 'utf8');
  return target;
}