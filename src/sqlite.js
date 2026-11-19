// Read-only access to a plaintext SQLite store: the last mile of the local-store layer.
// The probe says "plaintext, readable"; this is what actually reads it - with the built-in driver
// (Node >= 22.5) instead of a dependency, and read-only so a typo cannot write to somebody store.
// node:sqlite only exists from Node 22.5. Loading it lazily keeps every other cxa command working on
// Node 20, and lets cxa store say what it needs instead of throwing an import stack trace.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { DatabaseSync = null; }

export const sqliteAvailable = Boolean(DatabaseSync);
export const SQLITE_REQUIREMENT = 'cxa store needs Node >= 22.5 (built-in node:sqlite); running ' + process.version;

const WRITE_WORDS = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|begin|commit|rollback|savepoint|release)\b/i;

/** A query is allowed only when it cannot change the file. */
export function isReadOnlySql(sql = '') {
  const s = sql.trim().replace(/^\(+/, '');
  if (!/^(select|with|pragma|explain)\b/i.test(s)) return false;
  return !WRITE_WORDS.test(s);
}

export function openReadOnly(file) {
  if (!DatabaseSync) throw new Error(SQLITE_REQUIREMENT);
  return new DatabaseSync(file, { readOnly: true });
}

export function tableNames(db) {
  return db.prepare("select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name")
    .all().map(r => ({ name: r.name, type: r.type }));
}

export function runQuery(db, sql, { limit = 50 } = {}) {
  if (!isReadOnlySql(sql)) throw new Error('read-only: only SELECT / WITH / PRAGMA / EXPLAIN statements are allowed here');
  // Rows come back as null-prototype objects; copy them so JSON and console.table behave.
  const rows = db.prepare(sql).all().map(r => ({ ...r }));
  return { rows: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit };
}