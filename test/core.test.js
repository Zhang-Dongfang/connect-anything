import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { harToConnector, templatePath } from '../src/har.js';
import { buildRequest, toolInputSchema } from '../src/connector.js';
import { createServer } from '../src/mcp.js';
import { route } from '../src/router.js';
import { extractEndpoints } from '../src/rea.js';

const har = JSON.parse(fs.readFileSync(new URL('./fixtures/sample.har', import.meta.url), 'utf8'));

test('templatePath parameterizes ids', () => {
  assert.deepEqual(templatePath('/api/v1/projects/101/tasks'), { path: '/api/v1/projects/{project_id}/tasks', params: ['project_id'] });
});

test('HAR -> connector: clusters endpoints, filters noise, never stores secrets', () => {
  const c = harToConnector(har, { name: 'demo' });
  assert.equal(c.baseUrl, 'https://app.example.com');
  const sigs = c.tools.map(t => `${t.method} ${t.path}`).sort();
  assert.deepEqual(sigs, ['GET /api/v1/projects', 'GET /api/v1/projects/{project_id}/tasks', 'POST /api/v1/projects/{project_id}/tasks']);
  const post = c.tools.find(t => t.method === 'POST');
  assert.equal(post.body.title.required, true);
  assert.equal(post.body.assignee.required, false);
  assert.equal(post.body.priority.type, 'number');
  assert.deepEqual(c.auth, [{ header: 'authorization', env: 'CXA_DEMO_AUTHORIZATION' }]);
  assert.ok(!JSON.stringify(c).includes('SECRET'));
});

test('buildRequest fills path/query/body and injects auth from env', () => {
  const c = harToConnector(har, { name: 'demo' });
  const get = c.tools.find(t => t.method === 'GET' && t.pathParams.length);
  const r = buildRequest(c, get, { project_id: '7', status: 'open' }, { CXA_DEMO_AUTHORIZATION: 'Bearer X' });
  assert.equal(r.url, 'https://app.example.com/api/v1/projects/7/tasks?status=open');
  assert.equal(r.init.headers.authorization, 'Bearer X');
  assert.deepEqual(toolInputSchema(get).required, ['project_id', 'status']);
});

test('router prefers better layers and falls back to computer use', () => {
  const cs = [{ name: 'demo', layer: 'private-api' }, { name: 'demo', layer: 'official-api' }];
  assert.equal(route('demo', cs).use.layer, 'official-api');
  assert.equal(route('unknown', cs).use.layer, 'computer-use');
});

test('REA bridge extracts candidate endpoints from evidence', () => {
  const e = extractEndpoints('fetch("https://api.x.com/v2/items") ... "/api/user/{id}"');
  assert.deepEqual(e.urls, ['https://api.x.com/v2/items']);
  assert.deepEqual(e.paths, ['/api/user/{id}']);
});

test('MCP server end to end: generate from HAR, list, call', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-'));
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response('{"id":"t42"}', { status: 201 }); };
  const s = createServer({ connectorsDir: dir, env: { CXA_DEMO_AUTHORIZATION: 'Bearer T' }, fetchImpl, reaRunner: async () => '{"x":"https://a.b/api"}' });
  const init = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.serverInfo.name, 'connect-anything');
  const gen = await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cxa_generate_from_har', arguments: { har_path: new URL('./fixtures/sample.har', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), name: 'demo' } } });
  assert.equal(gen.result.isError, false, gen.result.content[0].text);
  const list = await s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const tool = list.result.tools.find(t => t.name === 'demo__post_projects_tasks');
  assert.ok(tool, list.result.tools.map(t => t.name).join(','));
  const res = await s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: tool.name, arguments: { project_id: '5', body: { title: 'hi' } } } });
  assert.equal(res.result.isError, false);
  assert.equal(calls[0].url, 'https://app.example.com/api/v1/projects/5/tasks');
  assert.equal(calls[0].init.body, '{"title":"hi"}');
  const rea = await s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'cxa_rea_analyze_app', arguments: { app_path: '/x' } } });
  assert.match(rea.result.content[0].text, /https:\/\/a\.b\/api/);
  const r = await s.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'cxa_route', arguments: { app: 'demo' } } });
  assert.match(r.result.content[0].text, /private-api/);
});