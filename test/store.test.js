import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyDbFile, isRuntimeDb, scanStore } from '../src/store.js';

function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-store-'));
  fs.writeFileSync(path.join(d, 'plain.db'), Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(4080)]));
  fs.writeFileSync(path.join(d, 'secret.db'), Buffer.from([0x19, 0xbf, 0x55, 0x35, 0x79, 0x38, 0x5e, 0xbc, 1, 2, 3, 4, 5, 6, 7, 8]));
  fs.mkdirSync(path.join(d, 'nested'));
  fs.writeFileSync(path.join(d, 'nested', 'deep.sqlite'), Buffer.from('SQLite format 3\0' + 'x'.repeat(100), 'latin1'));
  fs.writeFileSync(path.join(d, 'notes.txt'), 'ignore me');
  return d;
}

test('classifyDbFile distinguishes plaintext SQLite from encrypted stores', () => {
  const d = tmp();
  assert.equal(classifyDbFile(path.join(d, 'plain.db')).state, 'plaintext-sqlite');
  assert.equal(classifyDbFile(path.join(d, 'secret.db')).state, 'encrypted');
});

test('scanStore walks nested dirs, ignores non-db files, reports sizes', () => {
  const r = scanStore(tmp());
  assert.equal(r.total, 3);
  assert.equal(r.plaintext, 2);
  assert.equal(r.encrypted, 1);
  assert.ok(r.totalBytes > 0);
  assert.ok(r.files.some(f => f.name === 'deep.sqlite'));
  assert.ok(!r.files.some(f => f.name === 'notes.txt'));
  assert.match(r.note, /Mixed/);
});

test('all-encrypted store points the user at the app or a vendor API, with a policy warning', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-enc-'));
  fs.writeFileSync(path.join(d, 'message_0.db'), Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11, 12, 13, 14, 15, 16]));
  const r = scanStore(d);
  assert.equal(r.encrypted, 1);
  assert.equal(r.plaintext, 0);
  assert.match(r.note, /SQLCipher/);
  assert.match(r.note, /not authorized/);
});

test('an empty directory is reported honestly', () => {
  const r = scanStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-none-')));
  assert.equal(r.total, 0);
  assert.match(r.note, /No database files/);
  assert.deepEqual(r.largest, []);
});

// WebView2/Tauri ship their own SQLite files into an app data directory. They are real SQLite,
// but they hold runtime telemetry - counting them makes the probe report a readable store
// where there is nothing to read.
const sqlite = (pad = 200) => Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(pad)]);

test('isRuntimeDb knows the runtime families, including the heavy_ad_ prefix', () => {
  assert.equal(isRuntimeDb('declarative_performance_observer.db'), true);
  assert.equal(isRuntimeDb('cache.db'), true);
  assert.equal(isRuntimeDb('heavy_ad_intervention_opt_out.db'), true);
  assert.equal(isRuntimeDb('heavy_ad_anything.db'), true);
  assert.equal(isRuntimeDb('msg.db'), false);
});

test('a directory with only WebView2 runtime databases is not an app store', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-noise-'));
  fs.writeFileSync(path.join(d, 'declarative_performance_observer.db'), sqlite());
  fs.writeFileSync(path.join(d, 'cache.db'), sqlite());
  const r = scanStore(d);
  assert.equal(r.total, 0);
  assert.equal(r.plaintext, 0);
  assert.equal(r.totalBytes, 0);
  assert.deepEqual(r.noise.sort(), ['cache.db', 'declarative_performance_observer.db']);
  assert.match(r.note, /runtime databases/);
  assert.match(r.note, /no app data/);
  assert.deepEqual(r.largest, []);
});

test('a real store next to WebView2 noise counts only the real data', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-mixed-'));
  fs.mkdirSync(path.join(d, 'EBWebView', 'Default'), { recursive: true });
  fs.writeFileSync(path.join(d, 'EBWebView', 'Default', 'Local State.db'), sqlite(100));
  fs.writeFileSync(path.join(d, 'msg.db'), sqlite(4096));
  const r = scanStore(d);
  assert.equal(r.total, 1);
  assert.equal(r.plaintext, 1);
  assert.equal(r.files[0].name, 'msg.db');
  assert.ok(r.noise.includes('Local State.db'));
  assert.match(r.note, /plain SQLite/);
});

test('classifyDbFile marks a database inside EBWebView as runtime even if the name is unknown', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-ebw-'));
  fs.mkdirSync(path.join(d, 'EBWebView', 'Default'), { recursive: true });
  const f = path.join(d, 'EBWebView', 'Default', 'something_odd.db');
  fs.writeFileSync(f, sqlite(100));
  assert.equal(classifyDbFile(f, 'EBWebView\\Default\\something_odd.db').runtime, true);
  assert.equal(classifyDbFile(path.join(d, 'something_odd.db')).runtime, false);
});