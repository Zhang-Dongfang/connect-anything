# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- README leads with the layer decision instead of the conversion, and lists prior art (mitmproxy2swagger, har2mcp, REA, Playwright MCP, WeChat projects) with an explicit note on how this project differs.

The repository is pre-1.0: interfaces can still change between minor versions.

## [0.1.0] - 2026-11-18

The first usable release: reverse an app private API, probe which layers it supports, and expose
both to an agent as MCP tools - with computer use as the documented last resort.

### Added

- HAR to connector conversion with path-parameter inference, credential detection (env names only),
  and authored `--augment` specs for endpoints whose schemas traffic cannot reveal.
- Zero-dependency stdio MCP server (`cxa serve`) exposing `cxa_route`, `cxa_generate_from_har`,
  `cxa_rea_analyze_app`, `cxa_probe_app`, `cxa_list_connectors` and one tool per observed endpoint.
- Layered router with an explicit four-state verdict (`available` / `unavailable` / `blocked` /
  `unknown`) and a documented rank order, so an agent stops at the first layer that works.
- `cxa probe`: evidence-based layer detection on Windows (UIA plus MSAA fallback, listeners, URL
  schemes, CDP ports) with fixtures captured from real apps.
- Local-store layer: `--find-store` discovery, plaintext SQLite vs encrypted store classification,
  encrypted stores reported `blocked` with the reason instead of guessed at.
- NetEase Cloud Music case: weapi AES+RSA request envelope, static headers, `resultPath`, and
  business-code aware results (HTTP 200 with `code != 200` is a failure).
- WeChat desktop case study documenting why every layer is blocked and where to go instead.
- Agent Skill (`cxa skill`, `cxa skill --check`): `SKILL.md` plus three references, progressive
  disclosure, and a validator that rejects eight classes of malformed skill.
- `cxa --version`, `cxa --help`.

### Security

- Credentials are never persisted: connectors store environment variable names only.
- Boundary is enforced in code and in docs: no key extraction, no internal-IPC replay, no
  anti-automation bypass. Blocked layers stay blocked.
- Repository hygiene gate: `test/repo.test.js` fails if a personal path, account id or publishable
  metadata regression reaches the tree.

### Known gaps

- No write-safety confirmation for mutating tools yet.
- Probes beyond Windows; WebSocket, GraphQL and gRPC-web endpoints; self-healing re-generation.
- A real CI matrix and public issue tracker start with the first published commit.

[Unreleased]: https://github.com/OWNER/connect-anything/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/connect-anything/releases/tag/v0.1.0