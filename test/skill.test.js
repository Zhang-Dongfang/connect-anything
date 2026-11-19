import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkill, parseFrontmatter, installSkill, skillSourceDir, SKILL_NAME } from '../src/skill.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** Build a throwaway skill dir with the given SKILL.md and optional references. */
function makeSkill(md, { name = 'demo-skill' } = {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-skill-')), name);
  fs.mkdirSync(path.join(dir, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
  return dir;
}

const GOOD_DESC = 'Use when an agent must operate a real app without an official API and clicking pixels is too slow or fragile.';

// ---------- the bundled skill is valid ----------

test('bundled skill validates cleanly', () => {
  const r = validateSkill(skillSourceDir());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.name, SKILL_NAME);
  assert.ok(r.files.includes('SKILL.md'));
  assert.ok(r.files.filter(f => f.startsWith('reference/')).length >= 3);
});

test('bundled skill description says when to use it, within the limit', () => {
  const r = validateSkill(skillSourceDir());
  assert.ok(r.description.length >= 40 && r.description.length <= 1024);
  assert.match(r.description, /Use when/i);
});

test('bundled skill stays small enough for progressive disclosure', () => {
  assert.ok(validateSkill(skillSourceDir()).bodyLines <= 500);
});

test('every CLI command shown in SKILL.md code blocks exists in the CLI', () => {
  const body = read('skills/connect-anything/SKILL.md');
  const cli = read('src/cli.js');
  const blocks = [...body.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.ok(blocks.length > 0, 'SKILL.md should contain fenced command blocks');
  const named = new Set([...blocks.join('\n').matchAll(/cxa ([a-z][a-z-]*)/g)].map(m => m[1]));
  assert.ok(named.size > 0, 'SKILL.md should show real CLI commands in code blocks');
  for (const cmd of named) {
    assert.ok(cli.includes("case '" + cmd + "'"), 'SKILL.md mentions cxa ' + cmd + ' but the CLI has no such command');
  }
});

test('SKILL.md does not promise layers the code does not implement', () => {
  const body = read('skills/connect-anything/SKILL.md');
  const router = read('src/router.js');
  for (const layer of ['official-api', 'local-store', 'private-api', 'devTools', 'accessibility', 'scripting', 'computer-use']) {
    if (body.includes(layer)) assert.ok(router.includes(layer), 'SKILL.md mentions layer ' + layer + ' which the router does not define');
  }
});

test('every reference file linked from SKILL.md is on disk and non-trivial', () => {
  const body = read('skills/connect-anything/SKILL.md');
  const linked = [...body.matchAll(/reference\/[\w-]+\.md/g)].map(m => m[0]);
  assert.ok(linked.length >= 3);
  for (const rel of new Set(linked)) {
    const f = path.join(skillSourceDir(), rel);
    assert.ok(fs.existsSync(f), rel + ' is linked but missing');
    assert.ok(fs.statSync(f).size > 300, rel + ' looks like a stub');
  }
});

// ---------- rejection cases ----------

test('frontmatter parsing: absent frontmatter returns null', () => {
  assert.equal(parseFrontmatter('# no frontmatter here\n'), null);
});

test('rejects a skill without frontmatter', () => {
  const r = validateSkill(makeSkill('# plain markdown\nno frontmatter\n'));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /frontmatter/);
});

test('rejects a name that does not match the directory', () => {
  const r = validateSkill(makeSkill('---\nname: other-name\ndescription: ' + GOOD_DESC + '\n---\n\n# x\n', { name: 'demo-skill' }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /must match the directory name/);
});

test('rejects an uppercase or underscore name', () => {
  const r = validateSkill(makeSkill('---\nname: Bad_Name\ndescription: ' + GOOD_DESC + '\n---\n\n# x\n', { name: 'Bad_Name' }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /lowercase/);
});

test('rejects a missing or overlong description', () => {
  assert.match(validateSkill(makeSkill('---\nname: demo-skill\n---\n\n# x\n')).errors.join(' '), /description/);
  const tooLong = '---\nname: demo-skill\ndescription: ' + 'x'.repeat(1100) + '\n---\n\n# x\n';
  assert.match(validateSkill(makeSkill(tooLong)).errors.join(' '), /limit is 1024/);
});

test('rejects a body that is too long to be a skill index', () => {
  const md = '---\nname: demo-skill\ndescription: ' + GOOD_DESC + '\n---\n' + '\nline\n'.repeat(600);
  assert.match(validateSkill(makeSkill(md)).errors.join(' '), /keep the main file under/);
});

test('rejects links to reference files that do not exist', () => {
  const md = '---\nname: demo-skill\ndescription: ' + GOOD_DESC + '\n---\n\nSee reference/missing.md.\n';
  assert.match(validateSkill(makeSkill(md)).errors.join(' '), /does not exist/);
});

test('accepts a well-formed skill and warns when it has no references', () => {
  const md = '---\nname: demo-skill\ndescription: ' + GOOD_DESC + '\n---\n\n# Demo\n\nDo the thing.\n';
  const r = validateSkill(makeSkill(md));
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(' '), /no reference/);
});

// ---------- install ----------

test('installSkill copies the bundled skill and refuses to clobber without force', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-install-'));
  const r = installSkill({ target });
  assert.equal(path.basename(r.installedTo), SKILL_NAME);
  assert.ok(fs.existsSync(path.join(r.installedTo, 'SKILL.md')));
  assert.ok(r.files.some(f => f === 'reference/policy.md'));
  assert.throws(() => installSkill({ target }), /already exists/);
  const again = installSkill({ target, force: true });
  assert.equal(again.installedTo, r.installedTo);
  assert.ok(again.files.includes('SKILL.md'));
});
// ---------- publishing ----------

test('npm tarball settings ship the skill and the probe script', () => {
  const pkg = JSON.parse(read('package.json'));
  const files = pkg.files ?? [];
  assert.ok(files.includes('src'));
  assert.ok(files.includes('skills'), 'skills/ must ship so `npx connect-anything skill` can install it');
  assert.ok(files.includes('scripts'), 'scripts/probe-win.ps1 must ship for `cxa probe`');
});