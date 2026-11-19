import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weapiEncrypt, weapiDecrypt, weapiForm, rsaEncryptHex } from '../src/weapi.js';
import { harToConnector, applyAugment } from '../src/har.js';
import { buildRequest, missingAuth, callTool, toolInputSchema } from '../src/connector.js';

// A capture with the three shapes NetEase actually produces: encrypted weapi
// envelope, plaintext JSON endpoint, and JSON served as text/plain.
const har = {
  log: {
    entries: [
      {
        request: {
          method: 'POST',
          url: 'https://music.163.com/weapi/song/lyric?csrf_token=',
          headers: [
            { name: 'Referer', value: 'https://music.163.com/' },
            { name: 'Cookie', value: 'NMTID=abc; JSESSIONID-WYYY=def' },
            { name: 'X-AnticheatToken', value: 'xyz' },
          ],
          postData: { mimeType: 'application/x-www-form-urlencoded', text: 'params=AAA%3D%3D&encSecKey=bb' },
        },
        response: { content: { mimeType: 'application/json;charset=UTF-8', text: '{"code":200,"lrc":{"lyric":"hi"}}' } },
      },
      {
        request: {
          method: 'POST',
          url: 'https://music.163.com/weapi/v6/playlist/detail?csrf_token=',
          headers: [{ name: 'Referer', value: 'https://music.163.com/' }],
          postData: { mimeType: 'application/x-www-form-urlencoded', text: 'params=BBB%3D%3D&encSecKey=cc' },
        },
        // same body but served as text/plain: must not be dropped
        response: { content: { mimeType: 'text/plain;charset=UTF-8', text: '{"code":200,"playlist":{"id":1}}' } },
      },
      {
        request: { method: 'GET', url: 'https://music.163.com/api/toplist/detail', headers: [{ name: 'Referer', value: 'https://music.163.com/' }] },
        response: { content: { mimeType: 'application/json', text: '{"code":200,"list":[]}' } },
      },
    ],
  },
};

test('weapi envelope round-trips and is shaped like the real capture', () => {
  const payload = { id: '65538', lv: -1 };
  const secret = '0123456789abcdef';
  const { params, encSecKey } = weapiEncrypt(payload, secret);
  assert.match(encSecKey, /^[0-9a-f]{256}$/);
  assert.equal(Buffer.from(params, 'base64').length % 16, 0);
  assert.deepEqual(weapiDecrypt(params, secret), payload);
  const form = new URLSearchParams(weapiForm({ id: 1 }, secret));
  assert.deepEqual([...form.keys()].sort(), ['encSecKey', 'params']);
  assert.equal(rsaEncryptHex(secret), encSecKey);
});

test('HAR capture: encrypted envelopes become weapi tools, text/plain JSON is kept', () => {
  const c = harToConnector(har, { name: 'netease', host: 'music.163.com' });
  const lyric = c.tools.find(t => t.path === '/weapi/song/lyric');
  assert.equal(lyric.codec, 'weapi');
  assert.match(lyric.description, /encrypted/);
  assert.ok(c.tools.some(t => t.path === '/weapi/v6/playlist/detail'), 'text/plain JSON endpoint kept');
  assert.equal(c.staticHeaders.referer, 'https://music.163.com/');
  const cookie = c.auth.find(a => a.header === 'cookie');
  assert.equal(cookie.optional, true);
  assert.equal(cookie.env, 'CXA_NETEASE_COOKIE');
  assert.deepEqual(missingAuth(c, {}), [], 'cookie is optional, no hard requirement');
});

test('augment spec drops noise, renames and adds authored endpoints', () => {
  const c = harToConnector(har, {
    name: 'netease',
    host: 'music.163.com',
    augment: {
      drop: ['/weapi/v6/playlist/detail'],
      staticHeaders: { origin: 'https://music.163.com' },
      tools: [
        { name: 'song_lyric', path: '/weapi/song/lyric', method: 'POST', body: { id: { type: 'string', required: true, example: '1' } }, bodyDefaults: { lv: -1 }, resultPath: 'lrc' },
        { name: 'search_songs', path: '/api/cloudsearch/pc', method: 'GET', query: { s: { type: 'string', required: true, example: 'x' } }, resultPath: 'result.songs' },
      ],
    },
  });
  assert.deepEqual(c.tools.map(t => t.name).sort(), ['get_toplist_detail', 'search_songs', 'song_lyric']);
  const lyric = c.tools.find(t => t.name === 'song_lyric');
  assert.equal(lyric.resultPath, 'lrc');
  assert.equal(lyric.method, 'POST');
  assert.deepEqual(Object.keys(lyric.body), ['id']);
  assert.equal(c.staticHeaders.origin, 'https://music.163.com');
  assert.deepEqual(toolInputSchema(lyric).required, ['body']);
});

test('weapi request: plaintext params are encrypted, defaults applied, headers set', () => {
  const c = harToConnector(har, { name: 'netease', host: 'music.163.com' });
  const t = { ...c.tools.find(x => x.path === '/weapi/song/lyric'), bodyDefaults: { lv: -1, kv: -1 }, resultPath: 'lrc' };
  const { url, init } = buildRequest(c, t, { body: { id: '65538', kv: 7 } }, {});
  assert.equal(url, 'https://music.163.com/weapi/song/lyric');
  assert.equal(buildRequest(c, t, { body: { id: '1' }, csrf_token: '' }, {}).url, 'https://music.163.com/weapi/song/lyric?csrf_token=');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(init.headers.referer, 'https://music.163.com/');
  assert.ok(!JSON.stringify(init.body).includes('65538'), 'plaintext must not leave in clear');
  const form = new URLSearchParams(init.body);
  assert.deepEqual([...form.keys()].sort(), ['encSecKey', 'params']);
});

test('callTool: resultPath extraction, business code failures, optional cookie', async () => {
  const c = harToConnector(har, { name: 'netease', host: 'music.163.com' });
  const t = { ...c.tools.find(x => x.path === '/weapi/song/lyric'), resultPath: 'lrc' };
  const okFetch = async () => new Response('{"code":200,"lrc":{"lyric":"[00:00]hi"}}', { status: 200 });
  const ok = await callTool(c, t, { body: { id: '1' } }, { fetchImpl: okFetch, env: { CXA_NETEASE_COOKIE: 'MUSIC_U=x' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.lyric, '[00:00]hi');

  const badFetch = async () => new Response('{"code":50000005}', { status: 200 });
  const bad = await callTool(c, t, {}, { fetchImpl: badFetch, env: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 50000005);
});
