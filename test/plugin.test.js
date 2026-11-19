import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const pkg = readJson('package.json');

// Built by concatenation so this file does not trip the gate it defines.
const NAME = 'connect-' + 'anything';
const GIT_SPEC = 'github:Zhang-Dongfang/' + NAME;
const BARE_NPX = 'npx -y ' + NAME;
const BARE_JSON_ARG = '"-y", "' + NAME + '"';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|json|md|yml|yaml|mjs|txt)$/.test(e.name)) out.push(full);
  }
  return out;
}

test('the repository is its own Claude Code marketplace', () => {
  const market = readJson('.claude-plugin/marketplace.json');
  assert.equal(market.name, pkg.name);
  assert.ok(market.owner && market.owner.name, 'a marketplace needs an owner');
  const entry = market.plugins.find((p) => p.name === NAME);
  assert.ok(entry, 'the marketplace must list the plugin');
  assert.equal(entry.source, './');
  assert.equal(entry.version, pkg.version, 'the marketplace entry and package.json must agree on the version');
});

test('the plugin manifest agrees with the package', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.equal(plugin.name, pkg.name);
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.license, 'MIT');
  assert.ok(plugin.description.length > 40, 'the listing description is what a marketplace shows');
});

test('the bundled skill lives where a plugin expects it', () => {
  assert.ok(fs.existsSync(path.join(root, 'skills', NAME, 'SKILL.md')));
});

test('the MCP server is wired to the git spec, not the npm name another project owns', () => {
  const mcp = readJson('.mcp.json');
  const server = mcp.mcpServers[NAME];
  assert.ok(server, 'the plugin needs an MCP server entry');
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', GIT_SPEC, 'serve']);
});

test('every JSON manifest in .claude-plugin parses', () => {
  for (const name of fs.readdirSync(path.join(root, '.claude-plugin'))) {
    if (name.endsWith('.json')) assert.doesNotThrow(() => readJson(path.join('.claude-plugin', name)), name);
  }
});

test('nothing tells a host to install the npm name another project owns', () => {
  const hits = [];
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(BARE_NPX) || text.includes(BARE_JSON_ARG)) hits.push(path.relative(root, file));
  }
  assert.deepEqual(hits, [], 'point hosts at ' + GIT_SPEC + ' instead');
});
