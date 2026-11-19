// Labels a pull request from the paths it touches and posts one welcome comment.
//
// Invoked by .github/workflows/pr-triage.yml on pull_request_target. The pull request code is
// never checked out: every path here comes from the REST API, so a fork cannot run anything.
//
// Zero dependencies, like the rest of the project. Run `node scripts/pr-triage.mjs` locally with
// DRY_RUN=1 to print what it would do.

const MARKER = '<!-- cxa-pr-triage -->';

// Each pull request gets at most one label per area it touches; docs and tests can co-exist with code.
const RULES = [
  ['area: probe', (p) => p === 'src/probe.js' || /^scripts\/probe-[\w-]+\.(ps1|sh|swift)$/.test(p) || p.startsWith('test/fixtures/probe/')],
  ['area: act', (p) => p === 'src/act.js' || p === 'scripts/uia-act.ps1' || p === 'test/act.test.js'],
  ['area: connector', (p) => ['src/har.js', 'src/connector.js', 'src/weapi.js', 'src/discover.js', 'src/rea.js'].includes(p) || p.startsWith('specs/') || /\.har$/i.test(p)],
  ['area: store', (p) => ['src/store.js', 'src/sqlite.js', 'test/store.test.js'].includes(p)],
  ['area: cli', (p) => ['src/cli.js', 'src/mcp.js', 'src/router.js'].includes(p) || /^scripts\/[\w-]+\.mjs$/.test(p)],
  ['area: skill', (p) => p.startsWith('skills/')],
  ['area: docs', (p) => /\.md$/i.test(p) || p.startsWith('docs/')],
  ['area: tests', (p) => p.startsWith('test/')],
  ['area: ci', (p) => p.startsWith('.github/')]
];

const NEW_LABEL_COLORS = {
  'area: store': '006b75',
  'area: cli': '1d76db',
  'area: skill': 'bfd4f2',
  'area: tests': 'c2e0c6',
  'area: ci': 'ededed',
  'first-time contributor': '7057ff'
};

const FIRST_TIME = ['FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER'];

export function labelsFor(paths, association) {
  const out = new Set();
  for (const p of paths) {
    for (const [label, match] of RULES) if (match(p)) out.add(label);
  }
  if (FIRST_TIME.includes(association)) out.add('first-time contributor');
  return [...out].sort();
}

export function triageComment({ paths, labels }) {
  const firstTime = labels.includes('first-time contributor');
  const areas = labels.filter((l) => l.startsWith('area: ')).map((l) => l.slice(6));
  const lines = [MARKER, ''];
  if (firstTime) {
    lines.push('Welcome - this is your first patch here. A few things that usually come up:', '');
  } else {
    lines.push('Thanks for the patch. No issue was needed for it; this comment is automatic.', '');
  }
  lines.push(
    '- **Nothing here is graded.** The labels above come from the files you touched (' + (areas.length ? areas.join(', ') : 'none yet') + '); they are for triage, not for you.',
    '- **CI** runs the suite on Ubuntu and Windows for Node 20, 22 and 24. Green CI plus one review is normally all it takes.',
    '- **A human replies within 72 hours.** If nobody does, ping `@Zhang-Dongfang` in this thread - that is a bug on our side.',
    '- **No CLA, no sign-off.** MIT in, MIT out.',
    '- **What merges without discussion:** docs, typo fixes, tests, fixtures, new platform probe files, new `specs/<app>.json`. What needs one design sentence first: changes to `classify()` or the layer order, and anything that adds a dependency or a public command.',
    '',
    'If the direction is wrong, closing the pull request is a fine outcome - it still counts as a useful report.',
    '',
    'Details: [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md) - \"You do not need an issue first\".'
  );
  return lines.join('\n');
}

function client({ token, repo, fetchImpl }) {
  const base = 'https://api.github.com/repos/' + repo;
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cxa-pr-triage',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
  const call = async (path, init = {}) => {
    const res = await fetchImpl(base + path, { ...init, headers });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
  };
  return { call };
}

export async function run({ token, repo, pr, association = '', dryRun = false, fetchImpl = fetch }) {
  const { call } = client({ token, repo, fetchImpl });
  const files = [];
  for (let page = 1; page <= 3; page++) {
    const r = await call('/pulls/' + pr + '/files?per_page=100&page=' + page);
    if (!r.ok) throw new Error('listing files failed: ' + r.status);
    files.push(...r.body.map((f) => f.filename));
    if (r.body.length < 100) break;
  }

  const labels = labelsFor(files, association);
  const existing = await call('/issues/' + pr + '/comments?per_page=100');
  if (!existing.ok) throw new Error('listing comments failed: ' + existing.status);
  const alreadyCommented = existing.body.some((c) => String(c.body || '').includes(MARKER));

  const result = { pr, files: files.length, labels, commented: !alreadyCommented, dryRun };
  if (dryRun) return result;

  for (const name of labels) {
    if (!NEW_LABEL_COLORS[name]) continue;
    await call('/labels', { method: 'POST', body: JSON.stringify({ name, color: NEW_LABEL_COLORS[name], description: '' }) });
  }
  if (labels.length) {
    const applied = await call('/issues/' + pr + '/labels', { method: 'POST', body: JSON.stringify({ labels }) });
    result.labelsApplied = applied.ok;
  }
  if (alreadyCommented) {
    result.commented = false;
  } else {
    const posted = await call('/issues/' + pr + '/comments', {
      method: 'POST',
      body: JSON.stringify({ body: triageComment({ paths: files, labels }) })
    });
    result.commented = posted.ok;
    result.commentStatus = posted.status;
  }
  return result;
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/pr-triage.mjs');
if (invokedDirectly) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.REPO;
  const pr = Number(process.env.PR_NUMBER);
  const association = process.env.AUTHOR_ASSOCIATION || '';
  const dryRun = process.env.DRY_RUN === '1';
  if (!token || !repo || !pr) {
    console.error('need GITHUB_TOKEN, REPO and PR_NUMBER');
    process.exit(1);
  }
  const out = await run({ token, repo, pr, association, dryRun });
  console.log(JSON.stringify(out, null, 2));
}