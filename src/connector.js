// Load connector specs and execute their tools over HTTP.
import fs from 'node:fs';
import path from 'node:path';

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

export function missingAuth(connector, env = process.env) {
  return (connector.auth ?? []).filter(a => !env[a.env]).map(a => a.env);
}

export function buildRequest(connector, tool, args = {}, env = process.env) {
  let p = tool.path;
  for (const name of tool.pathParams ?? []) {
    if (args[name] === undefined) throw new Error(`missing path parameter: ${name}`);
    p = p.replace(`{${name}}`, encodeURIComponent(String(args[name])));
  }
  const url = new URL(p, connector.baseUrl);
  for (const k of Object.keys(tool.query ?? {})) if (args[k] !== undefined) url.searchParams.set(k, String(args[k]));
  const headers = { accept: 'application/json' };
  for (const a of connector.auth ?? []) if (env[a.env]) headers[a.header] = env[a.env];
  const init = { method: tool.method, headers };
  if (tool.body && args.body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(args.body); }
  return { url: url.toString(), init };
}

export async function callTool(connector, tool, args, { env = process.env, fetchImpl = fetch, maxChars = 20000 } = {}) {
  const { url, init } = buildRequest(connector, tool, args, env);
  const res = await fetchImpl(url, init);
  let text = await res.text();
  if (text.length > maxChars) text = text.slice(0, maxChars) + `\n...[truncated ${text.length - maxChars} chars]`;
  return { ok: res.ok, status: res.status, url, body: text };
}