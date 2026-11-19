// HAR -> connector spec. Clusters observed requests into endpoint templates
// and infers parameters. Credentials are never written, only referenced by env name.

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

export function harToConnector(har, { name, host } = {}) {
  const entries = (har.log?.entries ?? []).filter(e => {
    const u = new URL(e.request.url);
    if (host && u.host !== host) return false;
    if (STATIC_EXT.test(u.pathname)) return false;
    const mime = e.response?.content?.mimeType ?? '';
    return mime.includes('json') || (e.request.postData?.mimeType ?? '').includes('json');
  });
  if (!entries.length) throw new Error('No JSON API requests found in HAR');

  // Most frequent host wins when not specified.
  const hostCount = {};
  for (const e of entries) { const o = new URL(e.request.url).origin; hostCount[o] = (hostCount[o] ?? 0) + 1; }
  const origin = Object.entries(hostCount).sort((a, b) => b[1] - a[1])[0][0];
  const app = name ?? new URL(origin).hostname.split('.').slice(-2, -1)[0] ?? 'app';

  const groups = new Map();
  const authHeaders = new Set();
  for (const e of entries) {
    const u = new URL(e.request.url);
    if (u.origin !== origin) continue;
    for (const h of e.request.headers ?? []) if (AUTH_HEADER.test(h.name)) authHeaders.add(h.name.toLowerCase());
    const { path, params } = templatePath(u.pathname);
    const key = `${e.request.method} ${path}`;
    const g = groups.get(key) ?? { method: e.request.method, path, pathParams: params, count: 0, query: {}, body: {}, sample: null };
    g.count++;
    for (const [k, v] of u.searchParams) (g.query[k] ??= { type: /^-?\d+(\.\d+)?$/.test(v) ? 'number' : 'string', seen: 0, example: v }).seen++;
    const text = e.request.postData?.text;
    if (text) {
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === 'object' && !Array.isArray(obj))
          for (const [k, v] of Object.entries(obj)) (g.body[k] ??= { type: typeOf(v), seen: 0, example: v }).seen++;
      } catch { /* non-JSON body: ignore */ }
    }
    g.sample ??= (e.response?.content?.text ?? '').slice(0, 300);
    groups.set(key, g);
  }

  const taken = new Set();
  const tools = [...groups.values()].map(g => {
    const fields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, f]) => [k, { type: f.type, required: f.seen === g.count, example: f.example }]));
    return {
      name: toolName(g.method, g.path, taken),
      description: `${g.method} ${g.path} (observed ${g.count}x)`,
      method: g.method,
      path: g.path,
      pathParams: g.pathParams,
      query: fields(g.query),
      body: Object.keys(g.body).length ? fields(g.body) : null,
      responseSample: g.sample,
    };
  });

  return {
    name: app,
    baseUrl: origin,
    layer: 'private-api',
    auth: [...authHeaders].map(header => ({ header, env: envName(app, header) })),
    tools,
  };
}
