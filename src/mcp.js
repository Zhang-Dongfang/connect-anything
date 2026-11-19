// Minimal zero-dependency MCP server over stdio (newline-delimited JSON-RPC 2.0).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadConnectors, toolInputSchema, callTool, missingAuth } from './connector.js';
import { harToConnector } from './har.js';
import { route, LAYERS } from './router.js';
import { reaAnalyzeApp } from './rea.js';
import { probeApp } from './probe.js';
import { findStore } from './discover.js';
import { runAct, pickTarget, patternFor } from './act.js';

const PROTOCOL = '2025-06-18';
const SEP = '__';

export function createServer({ connectorsDir, env = process.env, fetchImpl = fetch, reaRunner } = {}) {
  let connectors = loadConnectors(connectorsDir);
  const health = {};
  const reload = () => { connectors = loadConnectors(connectorsDir); };

  const builtins = {
    cxa_route: {
      description: 'Pick the best integration layer for an app (official API > scripting > private API > accessibility > computer use). Call this before falling back to computer use.',
      inputSchema: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] },
      run: ({ app }) => route(app, connectors, health),
    },
    cxa_list_connectors: {
      description: 'List installed connectors, their layer, tools and missing credentials.',
      inputSchema: { type: 'object', properties: {} },
      run: () => ({ layers: LAYERS, connectors: connectors.map(c => ({ name: c.name, layer: c.layer, baseUrl: c.baseUrl, tools: c.tools.map(t => t.name), missingAuth: missingAuth(c, env) })) }),
    },
    cxa_generate_from_har: {
      description: 'Reverse-engineer a private API from a HAR capture and install it as a connector. Credentials are not stored; set the listed env vars instead.',
      inputSchema: { type: 'object', properties: { har_path: { type: 'string' }, name: { type: 'string' }, host: { type: 'string', description: 'only keep requests to this host' } }, required: ['har_path'] },
      run: ({ har_path, name, host }) => {
        const har = JSON.parse(fs.readFileSync(har_path, 'utf8').replace(/^\uFEFF/, ''));
        const c = harToConnector(har, { name, host });
        fs.mkdirSync(connectorsDir, { recursive: true });
        const file = path.join(connectorsDir, `${c.name}.json`);
        fs.writeFileSync(file, JSON.stringify(c, null, 2));
        reload();
        return { installed: file, tools: c.tools.map(t => t.name), setEnv: c.auth.map(a => a.env) };
      },
    },
    cxa_probe_app: {
      description: 'Detect which automation layers an installed desktop app supports (official API, URL schemes, private API, DevTools, accessibility tree). Call this before deciding to fall back to Computer Use.',
      inputSchema: { type: 'object', properties: { process_name: { type: 'string', description: 'e.g. Weixin, chrome, Code' }, store_dir: { type: 'string', description: 'explicit local data directory' }, store_hints: { type: 'array', items: { type: 'string' }, description: 'path substrings used to auto-discover the store' } }, required: ['process_name'] },
      run: async ({ process_name, store_dir, store_hints }) => {
        let storeDirs = store_dir ? [store_dir] : [];
        if (!storeDirs.length) {
          const hints = store_hints?.length ? store_hints : [process_name];
          const hits = findStore({ hints });
          if (hits.length) storeDirs = [hits[0].dir];
        }
        const { facts, verdict } = await probeApp(process_name, { connectors, storeDirs });
        return { verdict, route: route(process_name, connectors, health, verdict), facts: { windows: facts.windows, listeners: facts.listeners, schemes: facts.schemes, cdpPorts: facts.cdpPorts } };
      },
    },
    cxa_act: {
      description: 'Drive a Windows app through UI Automation semantics: list its controls, then invoke / set a value / read text by name or AutomationId. Coordinates and synthetic input are not supported by design. Actions need confirm:true; otherwise this returns a dry-run plan of exactly what would be pressed.',
      inputSchema: {
        type: 'object',
        properties: {
          process_name: { type: 'string', description: 'process name, e.g. notepad, CalculatorApp' },
          mode: { type: 'string', enum: ['list', 'invoke', 'set', 'get'], description: 'list = snapshot controls; get = read the control value' },
          name: { type: 'string', description: 'visible control name' },
          auto_id: { type: 'string', description: 'AutomationId, when the name is ambiguous or localized' },
          index: { type: 'number', description: 'pick the nth match, default 0' },
          value: { type: 'string', description: 'text for mode=set' },
          window: { type: 'string', description: 'window title regex, needed for UWP/hosted apps' },
          confirm: { type: 'boolean', description: 'must be true to actually act' },
        },
        required: ['process_name'],
      },
      run: async ({ process_name, mode = 'list', name, auto_id, index, value, window, confirm }) => {
        const opts = { processName: process_name, mode, name, autoId: auto_id, index, value, window };
        if (mode === 'list' || mode === 'get') return runAct(opts);
        if (!confirm) {
          const snap = await runAct({ processName: process_name, mode: 'list', window });
          if (!snap.ok) return snap;
          const pick = pickTarget(snap.elements ?? [], { name, autoId: auto_id, index });
          return { dryRun: true, wouldDo: { mode, pattern: patternFor(pick.target, mode), target: pick.target ?? null }, reason: pick.reason, hint: 'call again with confirm: true to execute' };
        }
        return runAct(opts);
      },
    },    cxa_rea_analyze_app: {
      description: 'Delegate static analysis of an extracted JavaScript/Electron app (dir or .asar) to upstream REA (rea-agents). Use the findings to locate API endpoints before capturing traffic.',
      inputSchema: { type: 'object', properties: { app_path: { type: 'string', description: 'absolute path' } }, required: ['app_path'] },
      run: ({ app_path }) => reaAnalyzeApp(app_path, { runner: reaRunner }),
    },
  };

  function listTools() {
    const tools = Object.entries(builtins).map(([name, b]) => ({ name, description: b.description, inputSchema: b.inputSchema }));
    for (const c of connectors) for (const t of c.tools)
      tools.push({ name: `${c.name}${SEP}${t.name}`.slice(0, 64), description: `[${c.name} | ${c.layer}] ${t.description}`, inputSchema: toolInputSchema(t) });
    return tools;
  }

  async function callAny(name, args) {
    if (builtins[name]) return builtins[name].run(args ?? {});
    const [app, toolName] = name.split(SEP);
    const c = connectors.find(x => x.name === app);
    const t = c?.tools.find(x => x.name === toolName);
    if (!t) throw new Error(`unknown tool: ${name}`);
    const missing = missingAuth(c, env);
    if (missing.length) throw new Error(`missing credentials, set env: ${missing.join(', ')}`);
    const r = await callTool(c, t, args, { env, fetchImpl });
    if ([401, 403, 404].includes(r.status) || r.status >= 500) health[c.name] = false;
    return r;
  }

  async function handle(msg) {
    const { id, method, params } = msg;
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize':
        return reply({ protocolVersion: params?.protocolVersion ?? PROTOCOL, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'connect-anything', version: '0.1.0' } });
      case 'notifications/initialized': return null;
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: listTools() });
      case 'tools/call':
        try {
          const out = await callAny(params.name, params.arguments);
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: out?.ok === false });
        } catch (e) {
          return reply({ content: [{ type: 'text', text: String(e.message ?? e) }], isError: true });
        }
      default:
        if (id === undefined) return null;
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
    }
  }

  return { handle, listTools, reload };
}

export function serveStdio(opts) {
  const server = createServer(opts);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    line = line.replace(/^\uFEFF+/, '');
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
    const before = server.listTools().length;
    const res = await server.handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
    if (server.listTools().length !== before) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n');
  });
}