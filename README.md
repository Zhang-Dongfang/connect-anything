# connect-anything (cxa)

> Turn any app into MCP tools. Reverse its private API once, then call it directly instead of clicking through screenshots.

**REA** ([morluto/rea](https://github.com/morluto/rea)) answers *"how does this app work?"*.
**connect-anything** answers *"now let my agent operate it"*: it turns what was learned into callable, tested MCP tools, and routes every request to the most reliable layer available, with computer use as the last resort.

```
official API  >  local data store (plain SQLite)  >  reversed private API  >  DevTools  >  accessibility tree  >  OS scripting  >  computer use
```

## Relationship to REA

connect-anything is a **companion**, not a fork. It calls REA (`rea-agents`, MIT) as a pinned, black-box CLI for analysis, and owns everything after analysis: connector specs, tool generation, credentials, routing, and health checks. REA upgrades only touch `src/rea.js`.

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
# found store: C:\Users\...\wxid_...\db_storage (24 db files, 1051131904 bytes)
#   blocked  local-store   total=24 plaintext=0 encrypted=24 bytes=1051131904
```

A plain SQLite store is a first-class layer: `available`, ranked just under an official API, and it
needs no UI automation at all. An encrypted store is reported `blocked` with the reason, not guessed at.

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

- [x] HAR -> connector, zero-dependency stdio MCP server, layered router, REA bridge
- [x] Encrypted request envelopes (NetEase weapi: AES+RSA) + authored `--augment` specs
- [ ] Live capture via CDP (browser + Electron `--remote-debugging-port`), session reuse
- [ ] WebSocket / GraphQL / gRPC-web endpoints
- [ ] Scripting layer providers: Windows COM/UIA, macOS AppleScript/AX, Linux D-Bus/AT-SPI
- [ ] Opt-in key-recovery plugin interface (explicit, separate from the core probe)
- [ ] macOS / Linux probes (AX + AT-SPI) mirroring scripts/probe-win.ps1
- [ ] Self-healing: re-capture and regenerate when a connector starts failing
- [ ] Write-safety: mark mutating tools, require confirmation
- [ ] Community connector registry

## Responsible use

For interoperability with software and accounts you own or are authorized to automate. Calling private APIs may violate a service's terms. You are responsible for compliance. Credentials stay in your environment.

MIT License.