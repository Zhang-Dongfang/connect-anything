import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findStore, scoreDir } from '../src/discover.js';

function build() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-disc-'));
  const store = path.join(root, 'Documents', 'myapp_files', 'acct', 'db_storage');
  fs.mkdirSync(path.join(store, 'message'), { recursive: true });
  for (const f of ['a.db', 'b.db', 'c.db']) fs.writeFileSync(path.join(store, 'message', f), Buffer.alloc(2048));
  fs.mkdirSync(path.join(root, 'Documents', 'unrelated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Documents', 'unrelated', 'x.db'), Buffer.alloc(10));
  return { root, store };
}

test('scoreDir counts db files and bytes, and rewards hint matches', () => {
  const { store } = build();
  const s = scoreDir(store);
  assert.equal(s.dbFiles, 3);
  assert.equal(s.dbBytes, 6144);
  assert.ok(scoreDir(store, { hints: ['myapp_files'] }).score > s.score);
});

test('findStore locates the store by hint and ranks the densest one first', () => {
  const { root, store } = build();
  const hits = findStore({ hints: ['myapp_files', 'db_storage'], searchRoots: [root], maxDepth: 5 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].dir, store);
  assert.equal(hits[0].dbFiles, 3);
});

test('findStore returns nothing when no hint matches', () => {
  const { root } = build();
  assert.deepEqual(findStore({ hints: ['no-such-app-xyz'], searchRoots: [root], maxDepth: 5 }), []);
});