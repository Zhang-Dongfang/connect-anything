import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configText, mergeInto, writeConfig, hostById, serverEntry, HOSTS, SERVER_NAME, GIT_SPEC } from '../src/mcpconfig.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-host-'));

test('every host has a path, a format and a note', () => {
  for (const h of HOSTS) {
    assert.ok(h.id && h.path && h.format && h.note, 'incomplete host ' + h.id);
  }
  assert.deepEqual(HOSTS.map((h) => h.id), ['claude', 'cursor', 'copilot', 'vscode', 'codex']);
});

test('codex gets a TOML table, not JSON', () => {
  const text = configText('codex', { platform: 'linux' });
  assert.match(text, /^\[mcp_servers\.connect-anything\]$/m);
  assert.match(text, /^command = "npx"$/m);
  assert.match(text, /^args = \["-y", "github:Zhang-Dongfang\/connect-anything", "serve"\]$/m);
});

test('on Windows codex is pointed at cmd.exe, because npx is a .cmd shim', () => {
  const text = configText('codex', { platform: 'win32' });
  assert.match(text, /^command = "cmd\.exe"$/m);
  assert.match(text, /\/d/);
  assert.match(text, /npx/);
  const entry = serverEntry({ shellOnWindows: true, platform: 'win32' });
  assert.deepEqual(entry.args.slice(0, 3), ['/d', '/s', '/c']);
});

test('JSON hosts use mcpServers, VS Code uses servers with a type', () => {
  const cursor = JSON.parse(configText('cursor'));
  assert.equal(cursor.mcpServers[SERVER_NAME].command, 'npx');
  assert.deepEqual(cursor.mcpServers[SERVER_NAME].args, ['-y', GIT_SPEC, 'serve']);
  const vscode = JSON.parse(configText('vscode'));
  assert.equal(vscode.servers[SERVER_NAME].type, 'stdio');
  assert.equal(vscode.servers[SERVER_NAME].command, 'npx');
});

test('merging keeps the servers that were already configured', () => {
  const existing = JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }, null, 2);
  const merged = JSON.parse(mergeInto(existing, 'cursor'));
  assert.equal(merged.mcpServers.other.command, 'other-server');
  assert.equal(merged.mcpServers[SERVER_NAME].command, 'npx');
});

test('merging a TOML file keeps other tables and does not duplicate ours', () => {
  const existing = '[model]' + String.fromCharCode(10) + 'name = "gpt"' + String.fromCharCode(10) + String.fromCharCode(10) + '[mcp_servers.connect-anything]' + String.fromCharCode(10) + 'command = "old"' + String.fromCharCode(10);
  const once = mergeInto(existing, 'codex', { platform: 'linux' });
  const twice = mergeInto(once, 'codex', { platform: 'linux' });
  assert.equal(once, twice, 'merging twice must be stable');
  assert.match(once, /\[model\]/);
  assert.equal(once.split('[mcp_servers.connect-anything]').length, 2, 'exactly one table');
  assert.ok(!once.includes('command = "old"'), 'the old command is replaced');
});

test('writing creates the file and merges on a second run', () => {
  const dir = tmp();
  const target = writeConfig('vscode', { dir });
  assert.ok(fs.existsSync(target));
  const first = fs.readFileSync(target, 'utf8');
  writeConfig('vscode', { dir });
  assert.equal(fs.readFileSync(target, 'utf8'), first, 'idempotent');
});

test('an unknown host is refused with the list of hosts', () => {
  assert.throws(() => configText('emacs'), /unknown host emacs/);
  assert.equal(hostById('emacs'), null);
});

test('the files this repository ships match what the generator produces', () => {
  const cases = [
    ['.mcp.json', 'claude'],
    ['.cursor/mcp.json', 'cursor'],
    ['.vscode/mcp.json', 'vscode'],
    ['.codex/config.toml', 'codex']
  ];
  for (const [file, host] of cases) {
    assert.ok(fs.existsSync(path.join(root, file)), file + ' should be shipped');
    assert.equal(read(file).trimEnd(), configText(host, { platform: 'linux' }).trimEnd(), file + ' is stale; run cxa mcp-config ' + host + ' --write --posix');
  }
});