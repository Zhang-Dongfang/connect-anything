import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (p) => fs.existsSync(path.join(root, p));

const REQUIRED = [
  'LICENSE', 'README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'CHANGELOG.md',
  '.gitattributes', '.editorconfig', '.gitignore',
  '.github/workflows/ci.yml', '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml',
  'docs/architecture.md', 'skills/connect-anything/SKILL.md'
];

test('ships the files an open-source project is expected to have', () => {
  const missing = REQUIRED.filter(f => !has(f));
  assert.deepEqual(missing, [], 'missing repository files');
});

test('package metadata is publishable and links back to the repository', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'MIT');
  assert.match(read('LICENSE'), /^MIT License/);
  assert.ok(!pkg.private, 'private:true would block publishing');
  assert.match(pkg.repository?.url ?? '', /^git\+https:\/\//, 'repository.url is needed for npm provenance');
  assert.ok(pkg.bugs?.url && pkg.homepage);
  assert.ok(pkg.engines?.node);
  assert.equal(pkg.bin.cxa, 'src/cli.js');
  for (const dir of ['src', 'scripts', 'skills']) {
    assert.ok(pkg.files.includes(dir), pkg.name + ' must ship ' + dir);
  }
});

test('CI tests the package on Windows and Linux for every supported Node', () => {
  const yml = read('.github/workflows/ci.yml');
  for (const needle of ['npm test', 'ubuntu-latest', 'windows-latest', 'node: [20, 22, 24]', 'skill --check', 'npm pack --dry-run']) {
    assert.ok(yml.includes(needle), 'ci.yml should mention ' + needle);
  }
});

// Personal paths, real account ids and live tokens must never reach a public repo.
const LEAKS = [
  { re: /[A-Za-z]:\\Users\\(?!user\\|<)/, why: 'absolute Windows path with a real username' },
  { re: /wxid_[A-Za-z0-9]{8,}/, why: 'WeChat account id' },
  { re: /Bearer\s+[A-Za-z0-9._\-]{16,}/, why: 'a token that looks live' }
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|json|md|yml|yaml|ps1|py|cs|mjs|txt)$/.test(e.name)) out.push(full);
  }
  return out;
}

test('no personal path, account id or live token is committed', () => {
  const hits = [];
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { re, why } of LEAKS) {
      const m = text.match(re);
      if (m) hits.push(path.relative(root, file) + ': ' + why + ' -> ' + m[0]);
    }
  }
  assert.deepEqual(hits, [], 'sanitise before committing');
});

test('README links point at files that exist', () => {
  const links = [...read('README.md').matchAll(/\]\((?!https?:|#)([^)]+)\)/g)].map(m => m[1].split('#')[0]);
  const missing = [...new Set(links)].filter(l => l && !has(l));
  assert.deepEqual(missing, []);
});
test('no template placeholder points at a fake repository', () => {
  const hits = [];
  for (const file of walk(root)) {
    if (fs.readFileSync(file, 'utf8').includes('github.com/' + 'OWNER/')) hits.push(path.relative(root, file));
  }
  assert.deepEqual(hits, [], 'replace OWNER with the real account before publishing');
});