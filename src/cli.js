#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { harToConnector } from './har.js';
import { serveStdio } from './mcp.js';
import { loadConnectors } from './connector.js';
import { probeApp } from './probe.js';
import { findStore } from './discover.js';
import { installSkill, validateSkill, skillSourceDir } from './skill.js';
import { classifyDbFile, scanStore } from './store.js';
import { route } from './router.js';
import { runAct, pickTarget, patternFor, describeTarget, rejectPixelArgs } from './act.js';
import { HOSTS, configText, writeConfig, hostById } from './mcpconfig.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const connectorsDir = flag('dir') ?? process.env.CXA_CONNECTORS ?? path.join(os.homedir(), '.connect-anything', 'connectors');

switch (cmd) {
  case 'serve':
    serveStdio({ connectorsDir });
    break;
  case 'har': {
    const file = rest[0];
    if (!file) { console.error('usage: cxa har <capture.har> [--name app] [--host api.example.com] [--augment spec.json] [--dir dir]'); process.exit(1); }
    const har = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const augmentFile = flag('augment');
    const augment = augmentFile ? JSON.parse(fs.readFileSync(augmentFile, 'utf8').replace(/^\uFEFF/, '')) : undefined;
    const c = harToConnector(har, { name: flag('name'), host: flag('host'), augment });
    fs.mkdirSync(connectorsDir, { recursive: true });
    const out = path.join(connectorsDir, `${c.name}.json`);
    fs.writeFileSync(out, JSON.stringify(c, null, 2));
    console.log(`connector "${c.name}" -> ${out}`);
    for (const t of c.tools) console.log(`  ${t.name.padEnd(36)} ${t.method} ${t.path}${t.codec ? ` [${t.codec}]` : ""}`);
    if (c.auth.length) console.log(`set credentials via env: ${c.auth.map(a => a.env).join(', ')}`);
    break;
  }
  case 'probe': {
    const name = rest[0];
    if (!name) { console.error('usage: cxa probe <processName>'); process.exit(1); }
    const conns = loadConnectors(connectorsDir);
    const hints = (flag('find-store') ?? name).split(',').map(s => s.trim()).filter(Boolean);
    let storeDirs = [];
    const explicit = flag('store');
    if (explicit) storeDirs = [explicit];
    else {
      const hits = findStore({ hints });
      if (hits.length) {
        storeDirs = [hits[0].dir];
        console.log(`found store: ${hits[0].dir} (${hits[0].dbFiles} db files, ${hits[0].dbBytes} bytes)`);
      }
    }
    const { verdict } = await probeApp(name, { connectors: conns, storeDirs });
    console.log(verdict.app + ' (running: ' + verdict.running + ') -> recommended: ' + verdict.recommended);
    for (const l of verdict.layers) {
      console.log('  ' + String(l.status).padEnd(14) + l.id.padEnd(14) + l.note);
      for (const e of l.evidence.slice(0, 4)) console.log('              - ' + e);
    }
    console.log('route: ' + JSON.stringify(route(name, conns, {}, verdict).use));
    break;
  }
  case 'skill': {
    if (rest.includes('--check')) {
      const r = validateSkill(skillSourceDir());
      console.log('skill ' + r.name + ': ' + (r.ok ? 'valid' : 'INVALID') + ' (' + r.bodyLines + ' body lines, ' + r.files.length + ' files)');
      for (const e of r.errors) console.log('  error: ' + e);
      for (const w of r.warnings) console.log('  warn:  ' + w);
      if (!r.ok) process.exit(1);
      break;
    }
    try {
      const r = installSkill({ target: flag('target'), force: rest.includes('--force') });
      console.log('skill installed -> ' + r.installedTo);
      for (const f2 of r.files) console.log('  ' + f2);
      console.log('restart the agent or reload skills to pick it up');
    } catch (e) { console.error(e.message); process.exit(1); }
    break;
  }
  case 'mcp-config': {
    const dirFlag = flag('dir');
    const platform = rest.includes('--windows') ? 'win32' : rest.includes('--posix') ? 'posix' : undefined;
    const wants = rest.find((a) => !a.startsWith('--') && a !== dirFlag && a !== 'mcp-config');
    if (rest.includes('--list') || !wants) {
      for (const h of HOSTS) console.log('  ' + h.id.padEnd(8) + h.path.padEnd(26) + h.note);
      console.log('');
      console.log('  cxa mcp-config <host>            print the snippet and where it goes');
      console.log('  cxa mcp-config <host> --write    merge it into this project (or --dir <path>)');
      if (!wants) break;
    }
    const host = hostById(wants);
    if (!host) { console.error('unknown host ' + wants + '; try: ' + HOSTS.map((h) => h.id).join(', ')); process.exit(2); }
    if (rest.includes('--write')) {
      const target = writeConfig(wants, { dir: dirFlag ?? process.cwd(), platform });
      console.log('wrote ' + host.id + ' config -> ' + target);
      if (host.format === 'toml') console.log('  project scope; for every project merge the same table into ~/.codex/config.toml');
    } else {
      console.log('# ' + host.path + '  -  ' + host.note);
      process.stdout.write(configText(wants, { platform }));
    }
    break;
  }
  case 'store': {
    const target = rest[0];
    if (!target) {
      console.error('usage: cxa store <dir|file.db> [--db <name>] [--tables] [--sql "<select ...>"] [--limit 50] [--json]');
      process.exit(1);
    }
    // node:sqlite still prints an ExperimentalWarning on load; keep the CLI output clean.
    const emit = process.emitWarning;
    process.emitWarning = (w, ...args) => (String(w).includes('SQLite is an experimental feature') ? undefined : emit.call(process, w, ...args));
    const { openReadOnly, tableNames, runQuery, sqliteAvailable, SQLITE_REQUIREMENT } = await import('./sqlite.js');
    if (!sqliteAvailable) { console.error(SQLITE_REQUIREMENT); process.exit(1); }
    process.emitWarning = emit;
    let candidates;
    if (fs.statSync(target).isDirectory()) {
      const scanned = scanStore(target);
      candidates = scanned.files.filter(f => f.state === 'plaintext-sqlite');
      if (!candidates.length) {
        console.error(scanned.note);
        console.error('Nothing readable here. Locate the real store with: cxa probe <app> --find-store "<hint>,<hint>"');
        process.exit(1);
      }
    } else {
      candidates = [classifyDbFile(target)];
    }
    const pick = flag('db');
    const chosen = pick ? candidates.filter(f => f.name.toLowerCase() === pick.toLowerCase()) : candidates;
    if (!chosen.length) {
      console.error('no database named ' + pick + '; candidates: ' + candidates.map(f => f.name).join(', '));
      process.exit(1);
    }
    const sql = flag('sql');
    if (chosen.length > 1 && (sql || rest.includes('--tables'))) {
      console.error('multiple databases; pick one with --db <name>:');
      for (const f of chosen) console.error('  ' + f.name + '  ' + f.size + 'B');
      process.exit(1);
    }
    const out = [];
    for (const f of chosen) {
      if (f.state !== 'plaintext-sqlite') { out.push({ file: f.name, state: f.state, note: 'not a plaintext SQLite database; not opened' }); continue; }
      let db;
      try {
        db = openReadOnly(f.file);
        out.push(sql ? { file: f.name, ...runQuery(db, sql, { limit: Number(flag('limit') ?? 50) }) }
          : { file: f.name, size: f.size, tables: tableNames(db) });
      } catch (e) {
        console.error(f.name + ': ' + e.message);
        process.exit(1);
      } finally { if (db) db.close(); }
    }
    if (rest.includes('--json')) { console.log(JSON.stringify(out, null, 2)); break; }
    for (const r of out) {
      if (r.note) { console.log(r.file + ': ' + r.note); continue; }
      if (r.rows) {
        console.log(r.file + ': ' + r.total + ' row(s)' + (r.truncated ? ' (showing ' + r.rows.length + ')' : ''));
        console.table(r.rows);
      } else {
        console.log(r.file + '  ' + r.size + 'B');
        for (const t of r.tables) console.log('  ' + t.type.padEnd(5) + ' ' + t.name);
      }
    }
    break;
  }
  case 'act': {
    const app = rest[0];
    const usage = 'usage: cxa act <processName> [--list] [--name <name> | --autoId <id>] [--index n]' + String.fromCharCode(10) +
      '               [--invoke] [--set-value <text>] [--get-text] [--window <title-regex>] [--confirm] [--json]';
    if (!app || app.startsWith('--')) { console.error(usage); process.exit(1); }
    const pixel = rejectPixelArgs(rest.slice(1));
    if (pixel) {
      console.error('refused: ' + pixel + ' addresses pixels or raw input. cxa only drives named controls'
        + ' (invoke / set-value / get-text); use a computer-use MCP when the UI exposes no controls.');
      process.exit(1);
    }
    const autoId = flag('autoId') ?? flag('auto-id') ?? '';
    const targetName = flag('name') ?? '';
    const targetIndex = Number(flag('index') ?? 0);
    const winTitle = flag('window') ?? '';
    const asJson = rest.includes('--json');
    const action = rest.includes('--invoke') ? 'invoke'
      : flag('set-value') !== undefined ? 'set'
        : (rest.includes('--get-text') || rest.includes('--get')) ? 'get' : 'list';
    const confirm = rest.includes('--confirm') || rest.includes('--yes');
    try {
      if (action === 'list') {
        const snap = await runAct({ processName: app, mode: 'list', window: winTitle });
        if (!snap.ok) { console.error('act failed: ' + snap.error); process.exit(1); }
        if (asJson) { console.log(JSON.stringify(snap, null, 2)); break; }
        const elements = snap.elements ?? [];
        const actionable = elements.filter(e => (e.actions ?? []).length);
        if (targetName || autoId) {
          const hit = pickTarget(elements, { name: targetName, autoId, index: targetIndex });
          if (!hit.target) { console.error(hit.reason ?? 'no match'); process.exit(1); }
          console.log('target: ' + describeTarget(hit.target) + '  actions: ' + ((hit.target.actions ?? []).join(', ') || 'none'));
          for (const c of hit.candidates.slice(0, 8)) console.log('  candidate: ' + describeTarget(c));
          break;
        }
        console.log(app + ' (window "' + (snap.windowName ?? '') + '"): ' + snap.total + ' control(s), '
          + elements.length + ' listed, ' + actionable.length + ' actionable');
        for (const e of actionable.slice(0, 40)) {
          console.log('  [' + String(e.controlType).padEnd(16) + '] ' + (e.name || '(unnamed)').slice(0, 46).padEnd(46)
            + ' ' + String(e.autoId ?? '').padEnd(20) + ' ' + (e.actions ?? []).join(','));
        }
        if (!actionable.length) {
          console.log('  no control exposes a semantic action: this is a self-drawn surface, computer-use is the only path');
        }
        break;
      }
      if (!confirm && action !== 'get') {
        const snap = await runAct({ processName: app, mode: 'list', window: winTitle });
        if (!snap.ok) { console.error('act failed: ' + snap.error); process.exit(1); }
        const hit = pickTarget(snap.elements ?? [], { name: targetName, autoId, index: targetIndex });
        if (!hit.target) { console.error(hit.reason ?? 'no match'); process.exit(1); }
        const pattern = patternFor(hit.target, action);
        console.log('dry run: would ' + action + ' ' + describeTarget(hit.target) + ' via ' + (pattern ?? '(no usable pattern)'));
        console.log('add --confirm to execute');
        if (!pattern) process.exit(1);
        break;
      }
      const r = await runAct({ processName: app, mode: action, name: targetName, autoId, index: targetIndex, value: flag('set-value') ?? '', window: winTitle });
      if (!r.ok) { console.error('act failed: ' + r.error); process.exit(1); }
      if (asJson) { console.log(JSON.stringify(r, null, 2)); break; }
      if (action === 'get') { console.log(describeTarget(r.target) + ' = ' + JSON.stringify(r.text ?? '')); break; }
      console.log(action + ' ' + describeTarget(r.target) + ' via ' + r.pattern);
      if (r.windowClosed) { console.log('  verified: the window is gone after the action'); break; }
      const state = r.after ? r.after.element : null;
      if (state) console.log('  now: ' + describeTarget(state) + (state.value ? '  value=' + JSON.stringify(state.value) : ''));
      if (r.verified && r.before && r.after) console.log('  verified: control tree changed (' + r.before.signature + ' -> ' + r.after.signature + ')');
      else { console.error('  NOT verified: ' + (r.note ?? 'no change observed')); process.exit(1); }
      break;
    } catch (e) { console.error(e.message); process.exit(1); }
  }
  case 'list':
    for (const c of loadConnectors(connectorsDir)) console.log(`${c.name} [${c.layer}] ${c.tools.length} tools  ${c.baseUrl}`);
    break;
  case 'version':
  case '--version':
  case '-v':
    console.log(pkg.version);
    break;
  case 'help':
  case '--help':
  case '-h':
  default:
    console.log(`connect-anything (cxa) - turn any app into MCP tools

  cxa har <file.har> [--name app] [--host h]   reverse a private API from traffic
                                                [--augment spec.json] merge authored schemas
  cxa probe <processName> [--store <dir>] [--find-store <hint,..>]
                                                detect which integration layers an app supports
  cxa store <dir|file.db> [--db <name>] [--tables] [--sql "<select>"]
                                                read a plaintext SQLite store, read-only
  cxa act <processName> [--name <n>|--autoId <id>] [--invoke|--set-value <v>|--get-text]
                                                drive named UI Automation controls (no pixels)
  cxa skill [--target <dir>] [--force]           install the Agent Skill
  cxa skill --check                             validate the bundled skill
  cxa list                                      list installed connectors
  cxa serve                                     run the MCP server on stdio

  connectors dir: ${connectorsDir}`);
}
