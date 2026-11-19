// Load connector specs and execute their tools over HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { weapiForm } from './weapi.js';

export function loadConnectors(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, '')));
}

export function toolInputSchema(tool) {
  const properties = {};
  const required = [];
  for (const p of tool.pathParams ?? []) { properties[p] = { type: 'string', description: 'path parameter' }; required.push(p); }
  for (const [k, f] of Object.entries(tool.query ?? {})) {
    properties[k] = { type: f.type === 'number' ? 'number' : 'string', description: `query, e.g. ${JSON.stringify(f.example)}` };
    if (f.required) required.push(k);
  }
  if (tool.body) {
    const bodyProps = {}; const bodyReq = [];
    for (const [k, f] of Object.entries(tool.body)) {
      bodyProps[k] = { type: f.type, description: `e.g. ${JSON.stringify(f.example)}`.slice(0, 120) };
      if (f.required) bodyReq.push(k);
    }
    properties.body = { type: 'object', properties: bodyProps, required: bodyReq, additionalProperties: true };
    if (bodyReq.length) required.push('body');
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

// `optional: true` auth entries are sent when the env var exists and skipped
// otherwise (cookies that only unlock extra data, not the whole endpoint).
export function missingAuth(connector, env = process.env) {
  return (connector.auth ?? []).filter(a => !a.optional && !env[a.env]).map(a => a.env);
}

function headerMap(...sources) {
  const out = {};
  for (const s of sources) for (const [k, v] of Object.entries(s ?? {})) out[k.toLowerCase()] = String(v);
  return out;
}

export function buildRequest(connector, tool, args = {}, env = process.env) {
  let p = tool.path;
  for (const name of tool.pathParams ?? []) {
    if (args[name] === undefined) throw new Error(`missing path parameter: ${name}`);
    p = p.replace(`{${name}}`, encodeURIComponent(String(args[name])));
  }
  const url = new URL(p, connector.baseUrl);
  for (const k of Object.keys(tool.query ?? {})) if (args[k] !== undefined) url.searchParams.set(k, String(args[k]));

  const headers = headerMap({ accept: 'application/json' }, connector.staticHeaders, tool.staticHeaders);
  for (const a of connector.auth ?? []) if (env[a.env]) headers[a.header.toLowerCase()] = env[a.env];

  const init = { method: tool.method, headers };
  const codec = tool.codec ?? connector.codec ?? (tool.body ? 'json' : undefined);
  const payload = args.body ?? {};
  if (codec === 'weapi') {
    // Every param travels inside the encrypted blob; the URL only carries csrf_token.
    headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = weapiForm({ ...(tool.bodyDefaults ?? {}), ...payload });
  } else if (tool.body && args.body !== undefined) {
    if (tool.bodyEncoding === 'form') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(args.body).toString();
    } else {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(args.body);
    }
  }
  return { url: url.toString(), init };
}

function pickPath(obj, dotted) {
  let cur = obj;
  for (const key of String(dotted).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

export async function callTool(connector, tool, args, { env = process.env, fetchImpl = fetch, maxChars = 20000 } = {}) {
  const { url, init } = buildRequest(connector, tool, args, env);
  const res = await fetchImpl(url, init);
  let text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not JSON */ }

  // Many private APIs answer 200 with a business code; treat that as the result.
  const code = json && typeof json === 'object' && json.code !== undefined ? json.code : undefined;
  const ok = res.ok && (code === undefined || code === 200);
  const out = { ok, status: res.status, url };
  if (code !== undefined) out.code = code;
  if (tool.resultPath) {
    const picked = pickPath(json, tool.resultPath);
    if (picked !== undefined) out.data = picked;
  }
  if (text.length > maxChars) text = text.slice(0, maxChars) + `\n...[truncated ${text.length - maxChars} chars]`;
  out.body = text;
  return out;
}
