# Roadmap

What is true today is what the tests and the recorded probes say. Everything below is ordered by
what unblocks the most people, not by what is most fun to build.

- **Now** - in this repository, being worked on.
- **Next** - designed, unowned, has acceptance criteria in an issue. Claimable today.
- **Later** - the shape is agreed, a design decision is still missing.

## Now

- `cxa probe` + `cxa act` on Windows: UIA facts, semantic actions (`--invoke`, `--set-value`,
  `--get-text`), dry-run by default. Verified on Weixin 4.1.15.13, Calculator and Notepad.
- `cxa store`: read-only look at an app's local SQLite, so an agent can answer questions with no
  write path at all.
- HAR -> connector, with `--augment` specs for encrypted envelopes (NetEase weapi: AES+RSA).
- Agent Skill packaging: `SKILL.md` + progressive `reference/`, `cxa skill --install/--check`.

## Next

Each row is an open issue with acceptance criteria. Comment on it before you start, so two people
are not doing the same thing.

| issue | what | labels |
|---|---|---|
| [#3](https://github.com/Zhang-Dongfang/connect-anything/issues/3) | macOS facts collector (`scripts/probe-mac.swift`) so `probe` / `plan` / `act` work on darwin | area: probe, platform: macos, help wanted |
| [#4](https://github.com/Zhang-Dongfang/connect-anything/issues/4) | Linux facts collector via AT-SPI (`scripts/probe-linux.sh`) | area: probe, platform: linux, help wanted |
| [#5](https://github.com/Zhang-Dongfang/connect-anything/issues/5) | `cxa capture`: local recording proxy to HAR, for apps with no DevTools | area: connector, help wanted |
| [#7](https://github.com/Zhang-Dongfang/connect-anything/issues/7) | `--toggle` / `--select` as first-class `cxa act` actions | good first issue, area: act |
| [#8](https://github.com/Zhang-Dongfang/connect-anything/issues/8) | `docs/json.md`: the documented `--json` shapes | good first issue, area: docs |
| [#9](https://github.com/Zhang-Dongfang/connect-anything/issues/9) | `README.zh-CN.md` | good first issue, area: docs |
| [#6](https://github.com/Zhang-Dongfang/connect-anything/issues/6) | a probe fixture from an app you drew yourself | good first issue, needs: fixture |

## Later

- Live capture via CDP (`--remote-debugging-port`) with session reuse across runs.
- WebSocket / GraphQL / gRPC-web request bodies in connectors, not just JSON POSTs.
- Scripting layer providers: Windows COM, macOS AppleScript, Linux D-Bus - coarse but often the
  only automation an app exposes.
- Self-healing connectors: when a generated connector starts failing, re-capture and show the diff.
- A community connector registry. It needs a review and trust model first, so it is not a coding
  task yet.

## Not planned

The product decisions in `CONTRIBUTING.md` ("What this project will not do") and the ADR on why
coordinate clicking is not a tool. Those are decisions, not backlog items: a PR implementing them
is closed with a pointer here.

## How items leave this page

An item is done when it has a test or a recorded run that would fail without it. That is the same
bar as everything already in the README, and it is why "verified" appears far more often than
"planned".