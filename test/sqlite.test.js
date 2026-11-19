import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isReadOnlySql, openReadOnly, tableNames, runQuery, sqliteAvailable } from '../src/sqlite.js';

const noSqlite = sqliteAvailable ? false : 'node:sqlite needs Node >= 22.5';

// A tiny real database, built with the same driver the CLI uses, so the tests exercise
// the actual read path instead of a mock of it.
function seedDb() {
  if (!sqliteAvailable) throw new Error('node:sqlite unavailable');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-sql-'));
  const file = path.join(dir, 'app.db');
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const w = new DatabaseSync(file);
  w.exec('create table session (id integer primary key, name text)');
  w.exec('create view named as select name from session');
  for (const n of ['alpha', 'beta', 'gamma']) w.prepare('insert into session (name) values (?)').run(n);
  w.close();
  return file;
}

test('isReadOnlySql accepts only statements that cannot write', () => {
  for (const sql of ['select 1', '  SELECT * from t', 'with x as (select 1) select * from x', 'pragma table_info(t)', 'explain select 1', '(select 1)']) {
    assert.equal(isReadOnlySql(sql), true, sql);
  }
  for (const sql of ['insert into t values (1)', 'UPDATE t set a=1', 'delete from t', 'drop table t', 'alter table t add c', 'create table t (a)', 'replace into t values (1)', 'attach database ? as x', 'vacuum', 'begin', 'select 1; delete from t', '']) {
    assert.equal(isReadOnlySql(sql), false, sql);
  }
});
test('tableNames lists tables and views but hides sqlite internals', { skip: noSqlite }, () => {
  const db = openReadOnly(seedDb());
  try {
    assert.deepEqual(tableNames(db), [{ name: 'named', type: 'view' }, { name: 'session', type: 'table' }]);
  } finally { db.close(); }
});

test('runQuery copies rows and reports truncation honestly', { skip: noSqlite }, () => {
  const db = openReadOnly(seedDb());
  try {
    const all = runQuery(db, 'select name from session order by id');
    assert.equal(all.total, 3);
    assert.equal(all.truncated, false);
    assert.deepEqual(all.rows.map(r => r.name), ['alpha', 'beta', 'gamma']);
    const cut = runQuery(db, 'select name from session order by id', { limit: 2 });
    assert.equal(cut.total, 3);
    assert.equal(cut.truncated, true);
    assert.equal(cut.rows.length, 2);
    assert.notEqual(Object.getPrototypeOf(cut.rows[0]), null);
  } finally { db.close(); }
});

test('a write is rejected before it reaches SQLite and the file is untouched', { skip: noSqlite }, () => {
  const file = seedDb();
  const before = fs.statSync(file).size;
  const db = openReadOnly(file);
  try {
    assert.throws(() => runQuery(db, 'delete from session'), /read-only/);
    assert.throws(() => runQuery(db, 'select 1; update session set name = 1'), /read-only/);
  } finally { db.close(); }
  const check = openReadOnly(file);
  try {
    assert.equal(runQuery(check, 'select count(*) as n from session').rows[0].n, 3);
  } finally { check.close(); }
  assert.equal(fs.statSync(file).size, before);
});

test('the file handle itself is read-only: a bypass write still cannot land', { skip: noSqlite }, () => {
  const file = seedDb();
  const db = openReadOnly(file);
  try {
    assert.throws(() => db.exec('insert into session (name) values (\'hack\')'));
  } finally { db.close(); }
  const check = openReadOnly(file);
  try {
    assert.equal(runQuery(check, 'select count(*) as n from session').rows[0].n, 3);
  } finally { check.close(); }
});