# Contributing

Thanks for looking. This project is small on purpose: zero runtime dependencies, one job per
module, and every claim in the docs traceable to a test or a recorded probe.

## What this project will not do

These are product decisions, not missing features. A PR implementing them will be closed:

- extracting keys from process memory, dumping encrypted stores, or defeating an app safeguard;
- replaying or reverse-engineering an app's internal IPC protocol;
- bypassing anti-automation or bot defences.

When a layer is blocked, the answer is blocked plus evidence. See
skills/connect-anything/reference/policy.md.

## Dev setup

    node --version   # 20 or newer; nothing else is required
    npm test         # full suite, no install step (zero dependencies)
    npm run check    # validate the bundled Agent Skill
    npm run verify   # both of the above, what CI runs
    node src/cli.js --help

## Where help is wanted

Every item below is scoped and has acceptance criteria in its issue. Comment on the issue before you
start so two people do not build the same thing.

| label | what it means | open now |
|---|---|---|
| [good first issue](https://github.com/Zhang-Dongfang/connect-anything/labels/good%20first%20issue) | under an hour, no core code | #6, #7, #8, #9 |
| [area: probe](https://github.com/Zhang-Dongfang/connect-anything/labels/area%3A%20probe) | host fact collection, one platform per file | #3, #4, #6 |
| [area: act](https://github.com/Zhang-Dongfang/connect-anything/labels/area%3A%20act) | semantic actions over the accessibility tree | #7 |
| [area: connector](https://github.com/Zhang-Dongfang/connect-anything/labels/area%3A%20connector) | capture, HAR, codecs | #5 |
| [needs: fixture](https://github.com/Zhang-Dongfang/connect-anything/labels/needs%3A%20fixture) | a capture from a real machine - the most valuable thing to donate | #6 |
| [platform: macos](https://github.com/Zhang-Dongfang/connect-anything/labels/platform%3A%20macos) / [platform: linux](https://github.com/Zhang-Dongfang/connect-anything/labels/platform%3A%20linux) | needs a machine the maintainer does not have | #3, #4 |
| [help wanted](https://github.com/Zhang-Dongfang/connect-anything/labels/help%20wanted) | real work, currently unowned | #3, #4, #5 |

`ROADMAP.md` explains the order and what is deliberately not planned.

## How we respond

- Every issue gets a human response within 72 hours. If nobody answers, ping `@Zhang-Dongfang` in
  the issue - that is a bug in our process, not a reason to give up.
- Small pull requests are reviewed against the acceptance criteria in the issue, not against taste.
  If you disagree with a criterion, say so in the issue: it is cheaper to agree on the shape before
  the patch than after.
- A pull request that cannot be merged gets a reason and, where possible, a smaller issue you can
  finish instead.
- Questions that are not bugs belong in
  [Discussions](https://github.com/Zhang-Dongfang/connect-anything/discussions), so the issue list
  stays a to-do list.

## Where does a change go?

| you want to | touch | keep untouched |
|---|---|---|
| support a new platform in the probe | a new scripts/probe-<platform> plus the SCRIPT table in src/probe.js | everything that decides a verdict |
| teach it a request codec (signature, HMAC, vendor crypto) | a module next to src/weapi.js plus one branch in buildRequest | routing, MCP surface |
| add an integration layer | the LAYERS table and classify() | MCP, CLI |
| support a new app | specs/<app>.json or a HAR capture | core code |
| change the Agent Skill | skills/connect-anything/ | src/, unless the workflow itself changed |

The hard rule: host-specific fact collection stays separate from the judgement logic, so the
same fixtures can assert the same behaviour on Windows, macOS and Linux.

## Tests

- Every behaviour change needs a test. Fixtures under test/fixtures/ are captures from real
  machines - sanitise usernames and account ids before committing.
- test/repo.test.js gates the repository itself: community files, publishable metadata, the CI
  matrix, and a scanner that fails on personal paths or account ids anywhere in the tree.
- A green run ends with pass = tests and fail 0. CI repeats it on Ubuntu and Windows for Node 20, 22 and 24.

## Adding a connector

1. Capture the task once in browser or Electron DevTools (Network, Save all as HAR).
2. Run: node src/cli.js har capture.har --name myapp --host api.example.com
3. Audit the generated tools: ids should become path parameters, and credentials must appear only
   as env var names such as CXA_MYAPP_AUTHORIZATION.
4. If the body is encrypted, write an augment spec (specs/<app>.json) instead of guessing; see
   skills/connect-anything/reference/connector-spec.md.
5. Never commit a capture containing a real account traffic. *.har is gitignored except for test/fixtures/.

## Commits and pull requests

- Imperative subject, one concern per commit, body explains the why and the evidence
  (for example: validated on <app> <version>; tests 49/49).
- Update CHANGELOG.md under Unreleased for anything a user would notice.
- Keep SKILL.md under 500 lines: detail belongs in reference/.
- By contributing you agree that your work is licensed under this repository MIT license.

## Reporting a broken connector

Apps change. Open an issue with the app name and version, the failing tool, the response you got,
and the probe output - then re-capture and regenerate. Do not paste tokens or personal data.