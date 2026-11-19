# connect-anything (cxa)

> Find the cheapest reliable way into an app, then turn that layer into MCP tools. Probe once, stop at the first layer that works, and keep computer use as the documented last resort.

**REA** ([morluto/rea](https://github.com/morluto/rea)) answers *"how does this app work?"*.
**connect-anything** answers *"now let my agent operate it"*: it turns what was learned into callable, tested MCP tools, and routes every request to the most reliable layer available, with computer use as the last resort.

```
official API  >  local data store (plain SQLite)  >  reversed private API  >  DevTools  >  accessibility tree  >  OS scripting  >  computer use
```

## Relationship to REA

connect-anything is a **companion**, not a fork. It calls REA (`rea-agents`, MIT) as a pinned, black-box CLI for analysis, and owns everything after analysis: connector specs, tool generation, credentials, routing, and health checks. REA upgrades only touch `src/rea.js`.

## Prior art (and where this differs)

This corner of the ecosystem is crowded, and pretending otherwise would be dishonest:

| project | what it does | how this differs |
|---|---|---|
| [alufers/mitmproxy2swagger](https://github.com/alufers/mitmproxy2swagger) | mitmproxy captures or HAR to OpenAPI 3.0 | this emits callable MCP tools; OpenAPI is a spec for other generators |
| [hydope/har2mcp](https://github.com/hydope/har2mcp) | HAR to a standalone MCP server, secrets in env vars | same conversion step; here it comes after a probe that decides whether to convert at all, and there is a local-store layer and a router on top |
| [morluto/rea](https://github.com/morluto/rea) | agent-driven reverse engineering, down to native binaries | REA analyses; this project owns what happens after the analysis |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | browser automation over accessibility snapshots | not replaced: `devTools` and `accessibility` are layers this router sends work to |
| [WeChat MCP/CLI projects](https://github.com/zwl467135974/wechat-cli) | decrypt the local store or drive the UI with `wxauto` | cited as evidence in `docs/weixin.md`, not vendored; this project reports `blocked` instead of extracting keys |

Only projects that were actually inspected are listed. Absence here is not a claim of absence in the world.
## Quick start

```bash
# 1. Use the app in a browser / Electron devtools and export a HAR
# 2. Reverse it into a connector
npx connect-anything har capture.har --name myapp
# 3. Provide credentials via env (never written to disk)
export CXA_MYAPP_AUTHORIZATION="Bearer ..."
# 4. Register the MCP server in your agent
```

```json
{ "mcpServers": { "connect-anything": { "command": "npx", "args": ["-y", "connect-anything", "serve"] } } }
```

### What a HAR actually is

HAR stands for **HTTP Archive**: the JSON log a browser keeps of every request it made. In Chrome, Edge or
Firefox: DevTools, Network tab, do the task **once**, right-click, *Save all as HAR with content*. That file
is the raw material for `cxa har` - nothing more magical than a recording of traffic.

```
{ "log": { "entries": [ {
    "request":  { "method": "GET", "url": "https://app.example.com/api/v1/projects?limit=20",
                  "headers": [ { "name": "Authorization", "value": "Bearer ..." } ] },
    "response": { "status": 200, "content": { "mimeType": "application/json", "text": "[{\"id\":101}]" } }
} ] } }
```

What it does give you: real URLs, methods, headers, request and response bodies - in other words the endpoint
inventory a connector is built from, with ids that can be turned into path parameters.

What it does not give you: traffic that never went through that browser or Electron shell (native network
stacks, IPC), the plaintext inside an encrypted body (`params=...&encSecKey=...` stays opaque), or what a
business error really means when the transport returned 200.

A HAR contains live cookies and tokens. Treat it like a password: `*.har` is gitignored here, and captures
with real account traffic must be scrubbed before they are shared.

## Which layer does an app actually support? (cxa probe)

Guessing wastes time. Run the probe against a running desktop app before falling back to pixels.

```bash
npx connect-anything probe Weixin
```

It prints one verdict per layer with the evidence it used, and tells the router what to pick.

### The local data layer

A probe that only looks at live UI and network surfaces misses where the data actually is. `cxa probe`
also scans the app's on-disk store, and `--find-store` locates it automatically:

```bash
cxa probe Weixin --find-store "xwechat_files,wxid_,db_storage"
# found store: C:\Users\<you>\xwechat_files\wxid_<redacted>\db_storage (24 db files, 1051131904 bytes)
#   blocked  local-store   total=24 plaintext=0 encrypted=24 bytes=1051131904
```

A plain SQLite store is a first-class layer: `available`, ranked just under an official API, and it
needs no UI automation at all. An encrypted store is reported `blocked` with the reason, not guessed at.

`cxa store` is the last mile: it reads that store - read-only, with Node own SQLite driver, no
dependency, no key extraction:

```bash
cxa store "C:\Users\<you>\AppData\Local\NetEase\CloudMusic\NIM"        # databases and their tables
cxa store <dir> --db msg.db --sql "select name from sqlite_master where type='table' limit 5"
cxa store <dir> --tables --json
```

```
friend.db  36864B
  table friend_list
  table friend_timetag
  table runtime_data
internal_appfun_pin.db  32768B
  table pinmessage
```

One dependency-free caveat: the built-in driver (`node:sqlite`) exists from Node 22.5. On older Node
every other `cxa` command still works and `cxa store` prints exactly what it needs.

Anything that is not `SELECT` / `WITH` / `PRAGMA` / `EXPLAIN` is refused before it reaches SQLite, and
the connection is opened read-only as well - two guards, so a typo cannot write to somebody store:

```
msg.db: read-only: only SELECT / WITH / PRAGMA / EXPLAIN statements are allowed here
```

One false positive this fixed: WebView2 and Chromium ship their own SQLite files into an app data
directory (`declarative_performance_observer.db`, `cache.db`, `Cookies`, anything under `EBWebView`).
They are real SQLite; they are not app data. They are now reported as `noise` and excluded from the
counts, so a Tauri app or Discord no longer claims a readable store where there is nothing to read:

```
Only browser/WebView2 runtime databases found (declarative_performance_observer.db, cache.db).
That directory holds no app data.
```

### Driving a native window without pixels

`cxa probe` tells you the accessibility layer is available; `cxa act` is what actually presses
things there - by name, never by coordinate:

```bash
cxa act notepad                                  # list controls, and which actions each exposes
cxa act CalculatorApp --window 计算器 --autoId num7Button --invoke         # dry run: prints the plan
cxa act CalculatorApp --window 计算器 --autoId num7Button --invoke --confirm
cxa act notepad --set-value "hello" --name "文本编辑器" --confirm
cxa act notepad --get-text --name "文本编辑器"     # reading needs no confirmation
```

Real output on this machine (`7 + 5 =` on Calculator: four invokes, then a read back):

```
invoke Button "七" autoId=num7Button via Invoke
  verified: control tree changed (51A09A78511AB58C -> 48082FED60764893)
...
Text "显示为 12" autoId=CalculatorResults = "显示为 12"
```

What it enforces, and why:

| rule | behaviour |
|---|---|
| semantic only | `Invoke` / `Toggle` / `SelectionItem` / `Value` patterns; `--click`, `--x`, `--y`, `--screenshot`, `--key` are refused with an explanation, not silently ignored |
| dry run by default | `--invoke` / `--set-value` print the resolved target and pattern and do nothing without `--confirm` |
| verify after acting | the control tree is re-read; if nothing changed it says `NOT verified` and exits non-zero instead of claiming success |
| self-drawn surfaces say so | a Qt/Flutter window with no patterns returns "computer-use is the only path" |
| no new layer | this is the `accessibility` layer (rank 4) actually driving; official API, local store, private API and DevTools still come first |

Known limits: Windows only. UWP/hosted apps need `--window <title>` (or must be in the foreground),
because a suspended app exposes an empty control tree. The same thing is also an MCP tool,
`cxa_act`, which is a dry run unless the caller passes `confirm: true`.
### How far WeChat key recovery actually got

Read-only investigation on `Weixin 4.1.15.13` (Windows), no messages touched, no admin rights:

| step | result |
|---|---|
| disk | `key_info.dat` is 180 bytes of high-entropy data; no key on disk |
| memory | `ReadProcessMemory` works (1041 MB in 2.2 s, no admin); the classic WCDB `x'<key><salt>'` pattern is **absent** |
| API hook | Frida 17.24 hooks `bcrypt.dll!BCryptDeriveKeyPBKDF2`; **zero calls** in 30 s of live use |

This reproduces upstream issue wx-cli#89: **WeChat 4.1.10+ no longer caches the raw key in process memory**.
Going further means hooking SQLCipher internals or bypassing app protections, which this project does not do.

### Measured on a real machine

`Weixin 4.1.15.13` (Qt, self-drawn UI):

| layer | status | evidence |
|---|---|---|
| official-api | unknown | no vendor API registered |
| private-api | **blocked** | 5 loopback IPC listeners only |
| devTools | unavailable | Chromium mini-program runtime, no remote debugging port |
| accessibility | **blocked** | `namedControls=4`; only `Qt51514QWindowIcon` / `MMUIRenderSubWindowHW` |
| local-store | **blocked** | 24 SQLCipher databases, 1.05 GB, key not on disk and not in memory |
| scripting | available | `weixin://` (deep link only) |

Verdict: Computer Use (pixels) is the only real way to drive the WeChat desktop client. Full case study in `docs/weixin.md`.

`regedit` (classic Win32) for contrast: `accessibility = available`, detected through MSAA control
classes (`SysTreeView32`, `SysListView32`, `Edit`) even though modern UIA exposes almost nothing.

The probe is also an MCP tool (`cxa_probe_app`), so an agent can ask before choosing a strategy.

### Case study: NetEase Cloud Music (encrypted API)

The web player signs every request (params=AES, encSecKey=RSA), so replaying a
capture verbatim cannot work. One clickthrough produced 56 API requests; the
generator turned them into a connector and flagged which bodies were encrypted.
With the weapi codec plus an authored spec, 8 of 10 tools return live data through
MCP - the remaining two report their real business error codes (-110, 50000005)
instead of pretending to work. Full receipts: docs/netease.md.

```bash
cxa har captures/netease.har --name netease --host music.163.com --augment specs/netease.json
```

## MCP tools

| tool | purpose |
|---|---|
| `cxa_route` | pick the best layer for an app; tells the agent when computer use is unnecessary |
| `cxa_generate_from_har` | reverse a HAR capture into a connector; tools appear immediately (`tools/list_changed`) |
| `cxa_rea_analyze_app` | delegate static analysis of an Electron/JS app to REA and extract candidate endpoints |
| `cxa_probe_app` | detect which layers a running desktop app supports, with evidence |
| `cxa_list_connectors` | installed connectors, layers, missing credentials |
| `<app>__<tool>` | one generated tool per observed endpoint |

## Use it as a Skill (process, not just tools)

MCP hands an agent *tools*. A Skill hands it the *procedure*: probe first, act on the best layer, capture once, generate, verify, and stop when a layer is `blocked`. Both ship from this repo.

```bash
cxa skill                  # install into an existing host skills dir (~/.claude/skills, else ~/.codex/skills)
cxa skill --target <dir>   # install somewhere else
cxa skill --check          # validate the bundled skill (frontmatter, links, size)
```

`SKILL.md` is a ~100-line index; the three references load only when the task needs them:

| file | loaded when |
|---|---|
| `SKILL.md` | always: the five steps, the layer status table, the guardrails |
| `reference/layers.md` | deciding what a probe verdict actually means |
| `reference/connector-spec.md` | authoring or repairing a connector / augment spec |
| `reference/policy.md` | a layer came back `blocked` and someone wants to push past it |

Division of labour: the Skill decides **whether and how** to automate and refuses to defeat a `blocked` layer; the MCP server (or the `cxa` CLI when no MCP host is available) performs the calls. Installing the Skill does not create connectors for you - it stops the agent from reaching for screenshots first.

## Connector spec

A connector is a plain JSON file in `~/.connect-anything/connectors/` (shareable, reviewable, diffable):

```json
{ "name": "demo", "baseUrl": "https://app.example.com", "layer": "private-api",
  "auth": [{ "header": "authorization", "env": "CXA_DEMO_AUTHORIZATION" }],
  "tools": [{ "name": "post_projects_tasks", "method": "POST", "path": "/api/v1/projects/{project_id}/tasks",
              "pathParams": ["project_id"], "body": { "title": { "type": "string", "required": true } } }] }
```

A tool may also declare `codec` (`"weapi"` encrypts the request body with
NetEase-style AES+RSA instead of sending JSON), `staticHeaders` (headers the API
requires, e.g. `referer`), `bodyDefaults` (applied before caller arguments),
`resultPath` (lift one JSON field into `data`), and `optional: true` on auth
entries that only unlock extra data.

## Roadmap

Checked items are shipped and covered by tests. Open items are ordered in [ROADMAP.md](ROADMAP.md),
where each one links to an issue with acceptance criteria.

- [x] HAR -> connector, zero-dependency stdio MCP server, layered router, REA bridge
- [x] Encrypted request envelopes (NetEase weapi: AES+RSA) + authored `--augment` specs
- [x] Packaged as an Agent Skill (`SKILL.md` + progressive-disclosure `reference/`, `cxa skill` install / `--check`)
- [x] Windows probe + semantic `cxa act` (UIA), run against Weixin, Calculator and Notepad
- [x] Read-only local store reader (`cxa store`)
- [ ] macOS / Linux facts collectors (AX + AT-SPI) - issues #3 and #4
- [ ] Local recording proxy -> HAR, for apps with no DevTools - issue #5
- [ ] Live capture via CDP with session reuse; WebSocket / GraphQL / gRPC-web bodies
- [ ] Scripting layer providers (COM / AppleScript / D-Bus), self-healing connectors, connector registry

Pick something up: [good first issues](https://github.com/Zhang-Dongfang/connect-anything/labels/good%20first%20issue) or the [help-wanted list](https://github.com/Zhang-Dongfang/connect-anything/labels/help%20wanted).

## Responsible use

For interoperability with software and accounts you own or are authorized to automate. Calling private APIs may violate a service's terms. You are responsible for compliance. Credentials stay in your environment.
## Project status

0.1.0, pre-1.0: the connector format and the CLI can still change between minor versions.
What is verified today is listed instead of promised: the test suite (unit tests plus repository
hygiene gates), the Agent Skill validator, real probe runs on Weixin 4.1.15.13 and regedit, and
live NetEase Cloud Music tools. CI runs the suite on Ubuntu and Windows for Node 20, 22 and 24.

Requirements: Node 20 or newer. No runtime dependencies, no build step.

## Documentation

- `docs/architecture.md` - layering model, module responsibilities, extension points, policy boundary
- `docs/weixin.md` - a full negative result, and why reporting it is the useful outcome
- `docs/netease.md` - an encrypted API turned into working tools, including the parts that stayed broken
- `skills/connect-anything/SKILL.md` - the workflow handed to an agent

## Contributing

Issues and pull requests are welcome, and small ones are the norm here. New to the project? Start
with the [good first issues](https://github.com/Zhang-Dongfang/connect-anything/labels/good%20first%20issue)
or the [help-wanted list](https://github.com/Zhang-Dongfang/connect-anything/labels/help%20wanted);
[ROADMAP.md](ROADMAP.md) says what comes next, and [CONTRIBUTING.md](CONTRIBUTING.md) has the dev
setup, where a change belongs and the test rules. "How do I..." questions go to
[Discussions](https://github.com/Zhang-Dongfang/connect-anything/discussions); `CODE_OF_CONDUCT.md`
sets the expectations; security problems go through `SECURITY.md` - privately, please.

## License

MIT - see [LICENSE](LICENSE). Not affiliated with REA, Tencent, NetEase or any other vendor whose
software appears in the case studies; their terms still apply to your use of their services.