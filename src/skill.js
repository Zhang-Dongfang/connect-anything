// Package the project as an Agent Skill (SKILL.md + references) and install it into a host.
// A skill carries the procedure; the MCP server carries the tools. Both read the same connector
// specs, so an agent can use either one.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const SKILL_NAME = 'connect-anything';
export const KNOWN_COMMANDS = ['serve', 'har', 'probe', 'list', 'skill'];

const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// A referenced support file, with or without surrounding backticks.
const REF_LINK_RE = /(?:reference|scripts)\/[\w.-]+\.(?:md|mjs|js|sh|ps1)/g;

export function skillSourceDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', SKILL_NAME);
}

/** Split a SKILL.md into frontmatter and body. Returns null when absent. */
export function parseFrontmatter(md) {
  const m = md.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return { meta, body: m[2] };
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Validate a skill directory. Returns every problem, not just the first. */
export function validateSkill(dir) {
  const errors = [];
  const warnings = [];
  const skillFile = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    return { ok: false, name: null, errors: ['SKILL.md is missing'], warnings, files: [], bodyLines: 0 };
  }
  const md = fs.readFileSync(skillFile, 'utf8');
  const fm = parseFrontmatter(md);
  if (!fm) return { ok: false, name: path.basename(dir), errors: ['SKILL.md has no --- frontmatter ---'], warnings, files: [], bodyLines: 0 };

  const name = fm.meta.name;
  if (!name) errors.push('frontmatter is missing `name`');
  else if (!NAME_RE.test(name)) errors.push(`name ${name} must be lowercase letters, digits and hyphens`);
  if (name && name !== path.basename(dir)) errors.push(`name ${name} must match the directory name ${path.basename(dir)}`);

  const desc = fm.meta.description ?? '';
  if (!desc) errors.push('frontmatter is missing `description`');
  else {
    if (desc.length < 40) errors.push('description is too short to tell an agent when to use the skill');
    if (desc.length > MAX_DESCRIPTION) errors.push(`description is ${desc.length} chars; the limit is ${MAX_DESCRIPTION}`);
  }

  const bodyLines = fm.body.split(/\r?\n/).length;
  if (bodyLines > MAX_BODY_LINES) errors.push(`body is ${bodyLines} lines; keep the main file under ${MAX_BODY_LINES} and move detail into reference/`);

  // Every support file named in the body must exist, backticked or not.
  for (const rel of new Set(fm.body.match(REF_LINK_RE) ?? [])) {
    if (!fs.existsSync(path.join(dir, rel))) errors.push(`body links to ${rel}, which does not exist`);
  }

  // The npm name belongs to another project: never teach a host to run it.
  const squatted = 'npx -y connect-' + 'anything';
  if (fm.body.includes(squatted)) errors.push('body tells hosts to run ' + squatted + ', which is a different project on npm; point them at the github: spec');
  const files = walk(dir);
  if (!files.some(f => f.startsWith('reference/'))) warnings.push('no reference/ files: everything the agent needs must fit in SKILL.md');

  return { ok: errors.length === 0, name: name ?? null, description: desc, bodyLines, errors, warnings, files };
}

/** Copy the bundled skill into a host skills directory. */
export function installSkill({ target, force = false } = {}) {
  const src = skillSourceDir();
  const check = validateSkill(src);
  if (!check.ok) throw new Error(`bundled skill is invalid: ${check.errors.join('; ')}`);

  const destRoot = target ?? defaultSkillsDir();
  const dest = path.join(destRoot, SKILL_NAME);
  if (fs.existsSync(dest)) {
    if (!force) throw new Error(`${dest} already exists; pass --force to replace it`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(destRoot, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return { installedTo: dest, files: walk(dest), description: check.description };
}

/** Prefer an existing host skills dir, otherwise ~/.claude/skills. */
export function defaultSkillsDir() {
  const candidates = [path.join(os.homedir(), '.claude', 'skills'), path.join(os.homedir(), '.codex', 'skills')];
  const existing = candidates.find(d => fs.existsSync(d));
  return existing ?? candidates[0];
}