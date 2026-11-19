import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelsFor, triageComment, run } from '../scripts/pr-triage.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const out = handler(url, init);
    return { ok: true, status: 200, text: async () => JSON.stringify(out === undefined ? null : out) };
  };
  return { impl, calls };
}

test('a docs-only pull request is labelled docs', () => {
  assert.deepEqual(labelsFor(['README.md', 'docs/weixin.md'], 'CONTRIBUTOR'), ['area: docs']);
});

test('a probe script and its fixture both point at the probe area', () => {
  assert.deepEqual(labelsFor(['scripts/probe-linux.sh', 'test/fixtures/probe/linux.json'], 'CONTRIBUTOR'), ['area: probe', 'area: tests']);
});

test('code and its test get two labels, not one', () => {
  assert.deepEqual(labelsFor(['src/act.js', 'test/act.test.js'], 'CONTRIBUTOR'), ['area: act', 'area: tests']);
});

test('workflow and dependabot changes are labelled ci', () => {
  assert.deepEqual(labelsFor(['.github/dependabot.yml'], 'CONTRIBUTOR'), ['area: ci']);
});

test('an unknown path gets no area label, and a first-timer still gets a greeting', () => {
  assert.deepEqual(labelsFor(['NOTICE.txt'], 'CONTRIBUTOR'), []);
  assert.deepEqual(labelsFor(['NOTICE.txt'], 'FIRST_TIME_CONTRIBUTOR'), ['first-time contributor']);
});

test('the greeting says no issue was needed and promises 72 hours', () => {
  const body = triageComment({ paths: ['README.md'], labels: ['area: docs'] });
  assert.match(body, /No issue was needed/);
  assert.match(body, /72 hours/);
  assert.match(body, /No CLA/);
  assert.match(body, /cxa-pr-triage/);
});

test('a first-time contributor gets a different opening line', () => {
  const body = triageComment({ paths: ['README.md'], labels: ['area: docs', 'first-time contributor'] });
  assert.match(body, /first patch here/);
});

test('an already triaged pull request is not commented twice', async () => {
  const { impl, calls } = fakeFetch((url) => {
    if (url.includes('/files')) return [{ filename: 'README.md' }];
    if (url.includes('/comments')) return [{ body: 'hello <!-- cxa-pr-triage -->' }];
    return null;
  });
  const out = await run({ token: 't', repo: 'o/r', pr: 7, fetchImpl: impl });
  assert.equal(out.commented, false);
  assert.deepEqual(out.labels, ['area: docs']);
  assert.ok(!calls.some((c) => c.method === 'POST' && c.url.includes('/comments')), 'must not post a second comment');
});

test('a fresh pull request is labelled and greeted exactly once', async () => {
  const { impl, calls } = fakeFetch((url) => {
    if (url.includes('/files')) return [{ filename: 'src/har.js' }, { filename: 'specs/demo.json' }];
    if (url.includes('/comments')) return [];
    return {};
  });
  const out = await run({ token: 't', repo: 'o/r', pr: 8, fetchImpl: impl });
  assert.equal(out.commented, true);
  assert.deepEqual(out.labels, ['area: connector']);
  assert.equal(calls.filter((c) => c.url.includes('/labels') && c.method === 'POST').length, 1);
  assert.equal(calls.filter((c) => c.url.includes('/comments') && c.method === 'POST').length, 1);
});

test('dry run touches nothing', async () => {
  const { impl, calls } = fakeFetch((url) => (url.includes('/files') ? [{ filename: 'README.md' }] : []));
  const out = await run({ token: 't', repo: 'o/r', pr: 9, dryRun: true, fetchImpl: impl });
  assert.equal(out.dryRun, true);
  assert.ok(!calls.some((c) => c.method !== 'GET'));
});

test('the workflow treats pull request code as untrusted', () => {
  const yml = fs.readFileSync(path.join(root, '.github/workflows/pr-triage.yml'), 'utf8');
  assert.ok(yml.includes('pull_request_target'), 'needs pull_request_target to label a fork pull request');
  assert.ok(!/github\.event\.pull_request\.head|refs\/pull/.test(yml), 'must never check out the pull request head');
  assert.match(yml, /scripts\/pr-triage\.mjs/);
});