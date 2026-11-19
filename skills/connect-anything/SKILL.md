---
name: connect-anything
description: Use when an agent must operate a real app or website (read data, trigger actions) and screenshot-driven Computer Use would be slow or fragile. Probes which integration layer the app actually supports (official API, local database, reversed private API, DevTools, accessibility tree, URL scheme), then generates callable MCP tools or calls the API directly. Also use when a previously generated connector starts failing, or when asked to automate a desktop/mobile/web app without official API.
---

# connect-anything (cxa)

Turn any app into MCP tools instead of clicking pixels. Probe first, act on the best layer, stop at the first one that is available.

Below, cxa means 
px -y connect-anything, or the installed cxa binary.

## 1. Probe before you automate

```bash
cxa probe <ProcessName> --find-store "<path-hint>,<path-hint>"
```

`<ProcessName>` is the executable name without `.exe` (e.g. `chrome`, `Weixin`, `Code`).
Use `--find-store` with substrings of the app's data path when you may need the local-database
layer (e.g. `--find-store "xwechat_files,wxid_,db_storage"`).

Read the **verdict**, not the raw facts. Every layer is one of:

| status | meaning | what you do |
|---|---|---|
| `available` | exists and is safe to use | use it |
| `unavailable` | the app does not offer it | skip |
| `blocked` | exists but must not be used (encrypted store, internal IPC, self-drawn UI) | **do not try to defeat it**; report the reason and take the next layer |
| `unknown` | not probed, or needs vendor docs | check docs or ask |

Never attempt to defeat a `blocked` layer (key extraction, protocol reverse engineering of internal IPC, anti-bot bypass). Report it with its evidence instead.

## 2. Act on the recommendation

| recommended layer | do this | stop? |
|---|---|---|
| `official-api` | use the vendor's API / CLI / official MCP | yes |
| `local-store` (available) | read the plain SQLite store read-only; no UI needed | yes |
| `private-api` | capture traffic, generate a connector (step 3) | after generating |
| `devTools` | attach over CDP; drive the page's own JS and network | after attaching |
| `accessibility` | drive named controls (UIA / macOS AX), not coordinates | yes |
| `scripting` only | you only get deep links (`scheme://…`); usually not enough for real work | decide with user |
| `computer-use` | last resort: screenshots + input; requires the user's explicit go-ahead | yes |

If the verdict is `computer-use` because everything else is `blocked`, say so plainly: the app is
not safely automatable, and this is a finding, not a failure to keep grinding on.

## 3. Capture, then generate

Have the app perform the task **once** while recording, then convert the capture:

```bash
# browser / Electron: DevTools → Network → right-click → Save all as HAR
cxa har capture.har --name myapp --host api.example.com
```

Before trusting the output, audit it:

- **Read the generated tool list.** If a path is still `/api/v1/projects/101/tasks`, the id was not
  recognised as an id — pass `--host` and check that path parameters were inferred.
- **Credentials are never written.** The command prints env names like `CXA_MYAPP_AUTHORIZATION`;
  ask the user to set them, never paste secrets into a spec file or a commit.
- **Encrypted bodies** (`params=…&encSecKey=…`) cannot be recovered from traffic. Those tools come
  out schema-less on purpose; author an augment spec instead of guessing (see `reference/connector-spec.md`).
- **Drop noise** (telemetry, config, login handshakes) with `drop[]` in the augment spec so the agent
  does not get 40 useless tools.

## 4. Call it

Either register the MCP server and use the generated tool names `<app>__<tool>`:

```json
{ "mcpServers": { "connect-anything": { "command": "npx", "args": ["-y", "connect-anything", "serve"] } } }
```

or use the CLI directly when no MCP host is available:

```bash
cxa list    # installed connectors, layers, missing credentials
```

Verify with **one read-only tool first** and inspect the real response shape before reporting success.
A generated tool that returns HTTP 200 with a business `code != 200` is a failure, not a success.

## 5. When it stops working

Apps change. A failing connector is evidence, not an error to retry:

1. Re-run `probe` — the layer may have moved (e.g. DevTools port closed after an update).
2. Re-capture traffic for the same task and regenerate; keep the hand-written `specs/<app>.json`
   augment (it is the durable part).
3. If the endpoint now requires a signature you cannot derive, stop and report: an honest
   `blocked` beats a flaky automation.

## Guardrails

- Only automate software and accounts the user owns or is authorised to automate.
- Do not implement key extraction from process memory, internal-IPC protocol replay, or anti-bot bypass.
- Do not commit captures containing real account traffic; scrub before any public commit.
- Prefer read-only tools; flag anything that mutates (POST/PUT/DELETE) before running it.

## Reference

- `reference/layers.md` — what each layer means, how it is detected, why some are blocked.
- `reference/connector-spec.md` — connector JSON, codecs, augment specs, `resultPath`.
- `reference/policy.md` — the boundary: what this skill refuses to do and why.