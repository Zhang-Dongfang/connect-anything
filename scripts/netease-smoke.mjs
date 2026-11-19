import { spawn } from 'node:child_process';
import readline from 'node:readline';

const child = spawn(process.execPath, ['src/cli.js', 'serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = readline.createInterface({ input: child.stdout });
const waiting = new Map();
rl.on('line', (line) => {
  const t = line.replace(/^\uFEFF+/, '');
  if (!t.trim()) return;
  let msg; try { msg = JSON.parse(t); } catch { return; }
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
let id = 0;
const rpc = (method, params) => new Promise((resolve) => { const rid = ++id; waiting.set(rid, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n'); });

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
console.log('server:', init.result.serverInfo.name, init.result.serverInfo.version);
const list = await rpc('tools/list', {});
const names = list.result.tools.map(t => t.name);
console.log('tools:', names.length, names.filter(n => n.startsWith('netease__')).join(' '));

async function call(name, args, show = 300) {
  const res = await rpc('tools/call', { name, arguments: args });
  const text = res.result.content[0].text;
  console.log(`\n=== ${name} isError=${res.result.isError}`);
  console.log(text.slice(0, show).replace(/\s+/g, ' '));
  return text;
}

await call('netease__search_songs', { s: '告五人', type: 1, limit: 2 }, 260);
await call('netease__song_detail', { body: { c: '[{"id":65538}]' } }, 260);
await call('netease__song_lyric', { body: { id: '65538' } }, 200);
await call('netease__toplist', {}, 200);
await call('netease__playlist_detail', { body: { id: '3778678', n: 5, s: 8 } }, 200);
await call('netease__artist_detail', { artist_id: '2116' }, 200);
await call('netease__album_detail', { album_id: '6434' }, 160);
await call('netease__song_comments', { song_id: '65538', limit: 2 }, 200);
await call('netease__song_url', { body: { ids: '[65538]', level: 'standard', encodeType: 'aac' } }, 200);
await call('netease__search_songs_web', { body: { s: '告五人', type: 1, limit: 2 } }, 160);

child.stdin.end();
setTimeout(() => { child.kill(); process.exit(0); }, 500);
