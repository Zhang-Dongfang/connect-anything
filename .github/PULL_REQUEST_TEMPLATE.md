## What and why

No issue needed. If there is one, link it; if there is not, this paragraph is the issue.

## Type

- [ ] docs, typo, comments
- [ ] test or fixture only
- [ ] new platform probe / connector spec / codec
- [ ] behaviour change in `src/` (say what a user would notice)

## Evidence

- [ ] `npm run verify` is green (paste the tail: `tests N / pass N / fail 0`)
- [ ] new behaviour has a test, and fixtures are sanitised (no usernames, account ids, tokens)
- [ ] `CHANGELOG.md` updated if a user would notice
- [ ] nothing here extracts keys, replays internal IPC, or bypasses anti-automation controls

## Notes for reviewers