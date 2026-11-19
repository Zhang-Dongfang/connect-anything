# connect-anything (cxa)

> Turn any app into MCP tools. Reverse its private API once, then call it directly instead of clicking through screenshots.

**REA** ([morluto/rea](https://github.com/morluto/rea)) answers *"how does this app work?"*.
**connect-anything** answers *"now let my agent operate it"*: it turns what was learned into callable, tested MCP tools, and routes every request to the most reliable layer available, with computer use as the last resort.

```
official API / CLI / MCP  >  OS scripting (COM, AppleScript, D-Bus)  >  reversed private API  >  accessibility tree  >  computer use
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

### Measured on a real machine

`Weixin 4.1.15.13` (Qt, self-drawn UI):

| layer | status | evidence |
|---|---|---|
| official-api | unknown | no vendor API registered |
| private-api | **blocked** | 5 loopback IPC listeners only |
| devTools | unavailable | Chromium mini-program runtime, no remote debugging port |
| accessibility | **blocked** | `namedControls=4`; only `Qt51514QWindowIcon` / `MMUIRenderSubWindowHW` |
| scripting | available | `weixin://` (deep link only) |

Verdict: Computer Use (pixels) is the only real way to drive the WeChat desktop client. Full case study in `docs/weixin.md`.

`regedit` (classic Win32) for contrast: `accessibility = available`, detected through MSAA control
classes (`SysTreeView32`, `SysListView32`, `Edit`) even though modern UIA exposes almost nothing.

The probe is also an MCP tool (`cxa_probe_app`), so an agent can ask before choosing a strategy.

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

## Roadmap

- [x] HAR -> connector, zero-dependency stdio MCP server, layered router, REA bridge
- [ ] Live capture via CDP (browser + Electron `--remote-debugging-port`), session reuse
- [ ] WebSocket / GraphQL / gRPC-web endpoints
- [ ] Scripting layer providers: Windows COM/UIA, macOS AppleScript/AX, Linux D-Bus/AT-SPI
- [ ] macOS / Linux probes (AX + AT-SPI) mirroring scripts/probe-win.ps1
- [ ] Self-healing: re-capture and regenerate when a connector starts failing
- [ ] Write-safety: mark mutating tools, require confirmation
- [ ] Community connector registry

## Responsible use

For interoperability with software and accounts you own or are authorized to automate. Calling private APIs may violate a service's terms. You are responsible for compliance. Credentials stay in your environment.

MIT License.