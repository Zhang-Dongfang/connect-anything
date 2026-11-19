#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { harToConnector } from './har.js';
import { serveStdio } from './mcp.js';
import { loadConnectors } from './connector.js';
import { probeApp } from './probe.js';
import { route } from './router.js';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const connectorsDir = flag('dir') ?? process.env.CXA_CONNECTORS ?? path.join(os.homedir(), '.connect-anything', 'connectors');

switch (cmd) {
  case 'serve':
    serveStdio({ connectorsDir });
    break;
  case 'har': {
    const file = rest[0];
    if (!file) { console.error('usage: cxa har <capture.har> [--name app] [--host api.example.com] [--dir dir]'); process.exit(1); }
    const har = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const c = harToConnector(har, { name: flag('name'), host: flag('host') });
    fs.mkdirSync(connectorsDir, { recursive: true });
    const out = path.join(connectorsDir, `${c.name}.json`);
    fs.writeFileSync(out, JSON.stringify(c, null, 2));
    console.log(`connector "${c.name}" -> ${out}`);
    for (const t of c.tools) console.log(`  ${t.name.padEnd(36)} ${t.method} ${t.path}`);
    if (c.auth.length) console.log(`set credentials via env: ${c.auth.map(a => a.env).join(', ')}`);
    break;
  }
  case 'probe': {
    const name = rest[0];
    if (!name) { console.error('usage: cxa probe <processName>'); process.exit(1); }
    const conns = loadConnectors(connectorsDir);
    const { verdict } = await probeApp(name, { connectors: conns });
    console.log(verdict.app + ' (running: ' + verdict.running + ') -> recommended: ' + verdict.recommended);
    for (const l of verdict.layers) {
      console.log('  ' + String(l.status).padEnd(14) + l.id.padEnd(14) + l.note);
      for (const e of l.evidence.slice(0, 4)) console.log('              - ' + e);
    }
    console.log('route: ' + JSON.stringify(route(name, conns, {}, verdict).use));
    break;
  }
  case 'list':
    for (const c of loadConnectors(connectorsDir)) console.log(`${c.name} [${c.layer}] ${c.tools.length} tools  ${c.baseUrl}`);
    break;
  default:
    console.log(`connect-anything (cxa) - turn any app into MCP tools

  cxa har <file.har> [--name app] [--host h]   reverse a private API from traffic
  cxa probe <processName>                       detect which integration layers an app supports
  cxa list                                      list installed connectors
  cxa serve                                     run the MCP server on stdio

  connectors dir: ${connectorsDir}`);
}