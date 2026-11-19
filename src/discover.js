// Find an app local data store without asking the user for paths.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DB_EXT = new Set(['.db', '.sqlite', '.sqlite3', '.db3', '.wcdb']);

// Roots worth scanning once, most specific first.
function roots() {
  const home = os.homedir();
  return [
    home,
    path.join(home, 'Documents'),
    path.join(home, 'AppData', 'Roaming'),
    path.join(home, 'AppData', 'Local'),
  ];
}

/**
 * Score a directory by how much it looks like an app database store.
 * `hints` are case-insensitive substrings that must appear in the path.
 */
export function scoreDir(dir, { hints = [], maxEntries = 4000 } = {}) {
  let dbFiles = 0, dbBytes = 0, subdirs = 0, entries = 0;
  const stack = [dir];
  while (stack.length && entries < maxEntries) {
    const d = stack.pop();
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      entries++;
      if (entries >= maxEntries) break;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { subdirs++; stack.push(p); }
      else if (DB_EXT.has(path.extname(e.name).toLowerCase())) {
        dbFiles++;
        try { dbBytes += fs.statSync(p).size; } catch { /* ignore */ }
      }
    }
  }
  const lower = dir.toLowerCase();
  const hintBonus = hints.filter(h => lower.includes(h.toLowerCase())).length * 50;
  return { dir, dbFiles, dbBytes, subdirs, score: dbFiles * 10 + hintBonus + Math.min(subdirs, 20) };
}

export function findStore({ hints = [], searchRoots = roots(), maxDepth = 4 } = {}) {
  const candidates = [];
  const seen = new Set();
  for (const root of searchRoots) {
    const walk = (d, depth) => {
      if (depth > maxDepth || seen.has(d)) return;
      seen.add(d);
      let list;
      try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      // Skip noisy or irrelevant trees.
      const skip = /^(node_modules|AppData\\Local\\Temp|\.git|Windows|\$Recycle\.Bin|Program Files.*)$/i;
      for (const e of list) {
        if (!e.isDirectory()) continue;
        const p = path.join(d, e.name);
        if (skip.test(e.name)) continue;
        const lower = p.toLowerCase();
        if (hints.some(h => lower.includes(h.toLowerCase()))) {
          const s = scoreDir(p, { hints });
          if (s.dbFiles > 0) candidates.push(s);
        }
        walk(p, depth + 1);
      }
    };
    walk(root, 0);
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}