// HAR -> connector spec. Clusters observed requests into endpoint templates
// and infers parameters. Credentials are never written, only referenced by env name.
//
// Encrypted form bodies (params=...&encSecKey=...) are recognised but their
// plaintext cannot be recovered from traffic, so those tools ship without a
// parameter schema until an authored augment spec supplies one.

const STATIC_EXT = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map|html?)$/i;
const AUTH_HEADER = /^(authorization|cookie|x-api-key|x-csrf-token|x-xsrf-token|x-[\w-]*token)$/i;

export function isIdSegment(seg) {
  return /^\d+$/.test(seg)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
    || /^[0-9a-f]{16,}$/i.test(seg)
    || (seg.length >= 20 && /\d/.test(seg) && /[a-z]/i.test(seg));
}

function singular(word) {
  return word.replace(/ies$/, 'y').replace(/s$/, '');
}

export function templatePath(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  const params = [];
  const out = segs.map((seg, i) => {
    if (!isIdSegment(seg)) return seg;
    let name = `${i > 0 ? singular(segs[i - 1]) : 'param'}_id`.replace(/[^\w]/g, '_');
    while (params.includes(name)) name += '_';
    params.push(name);
    return `{${name}}`;
  });
  return { path: '/' + out.join('/'), params };
}

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'string';
  return ['number', 'boolean', 'object'].includes(typeof v) ? typeof v : 'string';
}

function toolName(method, path, taken) {
  const words = path.split('/').filter(s => s && !s.startsWith('{') && !/^(api|v\d+)$/i.test(s));
  let name = [method.toLowerCase(), ...words].join('_').replace(/[^\w]/g, '_').replace(/_+/g, '_').slice(0, 60);
  let n = name, i = 2;
  while (taken.has(n)) n = `${name}_${i++}`;
  taken.add(n);
  return n;
}

export function envName(app, header) {
  return `CXA_${app}_${header}`.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function mostCommon(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : undefined;
}

export function harToConnector(har, { name, host, augment } = {}) {
  const entries = (har.log?.entries ?? []).filter(e => {
    const u = new URL(e.request.url);
    if (host && u.host !== host) return false;
    if (STATIC_EXT.test(u.pathname)) return false;
    const mime = e.response?.content?.mimeType ?? '';
    const postText = e.request.postData?.text ?? '';
    const bodyText = (e.response?.content?.text ?? '').trimStart();
    // Encrypted envelopes and JSON served as text/plain are still API traffic.
    const apiShaped = /^(\{|\[)/.test(bodyText) || /(^|&)encSecKey=/.test(postText);
    return mime.includes('json') || (e.request.postData?.mimeType ?? '').includes('json') || apiShaped;
  });
  if (!entries.length) throw new Error('No JSON API requests found in HAR');

  // Most frequent host wins when not specified.
  const hostCount = {};
  for (const e of entries) { const o = new URL(e.request.url).origin; hostCount[o] = (hostCount[o] ?? 0) + 1; }
  const origin = Object.entries(hostCount).sort((a, b) => b[1] - a[1])[0][0];
  const app = name ?? new URL(origin).hostname.split('.').slice(-2, -1)[0] ?? 'app';

  const groups = new Map();
  const authHeaders = new Set();
  const referers = {};
  for (const e of entries) {
    const u = new URL(e.request.url);
    if (u.origin !== origin) continue;
    for (const h of e.request.headers ?? []) {
      if (AUTH_HEADER.test(h.name)) authHeaders.add(h.name.toLowerCase());
      if (h.name.toLowerCase() === 'referer') referers[h.value] = (referers[h.value] ?? 0) + 1;
    }
    const { path, params } = templatePath(u.pathname);
    const key = `${e.request.method} ${path}`;
    const g = groups.get(key) ?? { method: e.request.method, path, pathParams: params, count: 0, query: {}, body: {}, codec: undefined, sample: null };
    g.count++;
    for (const [k, v] of u.searchParams) (g.query[k] ??= { type: /^-?\d+(\.\d+)?$/.test(v) ? 'number' : 'string', seen: 0, example: v }).seen++;

    const post = e.request.postData;
    const text = post?.text;
    if (text && /(^|&)encSecKey=/.test(text)) {
      // Encrypted envelope: the plaintext is unrecoverable, keep the shape only.
      g.codec = 'weapi';
      g.paramsEncrypted = true;
    } else if (text) {
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === 'object' && !Array.isArray(obj))
          for (const [k, v] of Object.entries(obj)) (g.body[k] ??= { type: typeOf(v), seen: 0, example: v }).seen++;
      } catch {
        if ((post?.mimeType ?? '').includes('form')) {
          for (const [k, v] of new URLSearchParams(text)) (g.body[k] ??= { type: /^-?\d+(\.\d+)?$/.test(v) ? 'number' : 'string', seen: 0, example: v }).seen++;
          if (Object.keys(g.body).length) g.bodyEncoding = 'form';
        }
      }
    }
    g.sample ??= (e.response?.content?.text ?? '').slice(0, 300);
    groups.set(key, g);
  }

  const taken = new Set();
  const tools = [...groups.values()].map(g => {
    const fields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, f]) => [k, { type: f.type, required: f.seen === g.count && f.example !== '', example: f.example }]));
    const t = {
      name: toolName(g.method, g.path, taken),
      description: `${g.method} ${g.path} (observed ${g.count}x)` + (g.paramsEncrypted ? ' - request body was encrypted in the capture; parameters must be authored' : ''),
      method: g.method,
      path: g.path,
      pathParams: g.pathParams,
      query: fields(g.query),
      body: Object.keys(g.body).length ? fields(g.body) : null,
      responseSample: g.sample,
    };
    if (g.codec) t.codec = g.codec;
    if (g.bodyEncoding) t.bodyEncoding = g.bodyEncoding;
    return t;
  });

  const staticHeaders = {};
  const commonReferer = mostCommon(referers);
  if (commonReferer) staticHeaders.referer = commonReferer;

  const connector = {
    name: app,
    baseUrl: origin,
    layer: 'private-api',
    staticHeaders,
    auth: [...authHeaders].map(header => ({ header, env: envName(app, header), ...(/^(authorization|x-api-key)$/.test(header) ? {} : { optional: true }) })),
    tools,
  };
  return augment ? applyAugment(connector, augment) : connector;
}

// Authored knowledge wins over inference: rename tools, add schemas that traffic
// cannot reveal, add endpoints found by static analysis, drop noise endpoints.
export function applyAugment(connector, augment = {}) {
  if (augment.description) connector.description = augment.description;
  if (augment.codec) connector.codec = augment.codec;
  if (augment.staticHeaders) connector.staticHeaders = { ...connector.staticHeaders, ...augment.staticHeaders };
  if (augment.auth) connector.auth = augment.auth;

  const drop = new Set((augment.drop ?? []).map(s => String(s).toLowerCase().replace(/\s+/g, ' ').trim()));
  let tools = connector.tools.filter(t => {
    const full = `${t.method} ${t.path}`.toLowerCase();
    return !drop.has(full) && !drop.has(t.path.toLowerCase());
  });

  for (const a of augment.tools ?? []) {
    const method = (a.method ?? 'POST').toUpperCase();
    const i = tools.findIndex(t => t.method === method && t.path === a.path);
    const base = i >= 0 ? tools[i] : { method, path: a.path, pathParams: a.pathParams ?? [], query: {}, body: null };
    const merged = { ...base, ...a, method, path: a.path, name: a.name ?? base.name };
    if (merged.paramsEncrypted) merged.paramsEncrypted = false;
    if (i >= 0) tools[i] = merged; else tools.push(merged);
  }
  connector.tools = tools;
  return connector;
}
