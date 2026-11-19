// Local data layer: what an app keeps on disk, and whether it is readable.
// This layer was missing from the first version of the probe. It matters because for
// closed apps the on-disk store is often the only place the real data lives.
import fs from 'node:fs';
import path from 'node:path';

const SQLITE_MAGIC = 'SQLite format 3\u0000';
const DB_EXT = new Set(['.db', '.sqlite', '.sqlite3', '.db3', '.wcdb']);

function readHead(file, bytes = 16) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const b = Buffer.alloc(bytes);
      const n = fs.readSync(fd, b, 0, bytes, 0);
      return b.subarray(0, n);
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

export function classifyDbFile(file) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return { file, name: path.basename(file), size: 0, state: 'unreadable' }; }
  const head = readHead(file);
  if (!head || head.length < 16) return { file, name: path.basename(file), size, state: 'empty' };
  const text = head.toString('latin1');
  if (text.startsWith(SQLITE_MAGIC)) return { file, name: path.basename(file), size, state: 'plaintext-sqlite' };
  // Random-looking header where a SQLite header should be is the SQLCipher signature.
  return { file, name: path.basename(file), size, state: 'encrypted' };
}

export function scanStore(dir, { maxDepth = 6, maxFiles = 500 } = {}) {
  const found = [];
  const walk = (d, depth) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= maxFiles) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < maxDepth) walk(p, depth + 1); }
      else if (DB_EXT.has(path.extname(e.name).toLowerCase())) found.push(p);
    }
  };
  walk(dir, 0);

  const files = found.map(classifyDbFile);
  const count = (s) => files.filter(f => f.state === s).length;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const encrypted = count('encrypted');
  const plaintext = count('plaintext-sqlite');

  return {
    dir,
    total: files.length,
    plaintext,
    encrypted,
    unreadable: count('unreadable'),
    empty: count('empty'),
    totalBytes,
    largest: [...files].sort((a, b) => b.size - a.size).slice(0, 5).map(f => ({ name: f.name, size: f.size, state: f.state })),
    files,
    note: files.length === 0
      ? 'No database files found under this directory.'
      : encrypted > 0 && plaintext === 0
        ? 'All databases are encrypted (SQLCipher-style). The key is not on disk: expect to need the app running, or a vendor API. Do not attempt to decrypt a store you are not authorized to access.'
        : plaintext > 0 && encrypted === 0
          ? 'Databases are plain SQLite: readable directly for interoperability and backup.'
          : 'Mixed: some stores are plain SQLite, others are encrypted.',
  };
}