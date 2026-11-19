# Case study: the WeChat desktop client (Weixin)

Goal: could connect-anything turn WeChat into MCP tools so an agent would not need Computer Use?

Method: run `npx connect-anything probe Weixin` against a real, running install (Weixin 4.1.15.13, Windows).
The probe only reads host state; it sends no messages and touches no account data.

## Result: no. Computer Use is required.

| layer | status | evidence |
|---|---|---|
| official-api | unknown | no vendor API registered for the desktop client |
| private-api | **blocked** | `127.0.0.1:14013/14016/14019/14022/14023` loopback IPC owned by the main process |
| devTools | unavailable | Chromium `RadiumWMPF` mini-program runtime is present, but started without `--remote-debugging-port` |
| accessibility | **blocked** | `descendants=4`, `namedControls=4`; only `Qt51514QWindowIcon` and `MMUIRenderSubWindowHW` |
| scripting | available | `weixin://` URL protocol (opens/deep-links only) |
| computer-use | available | pixels |

### Why the accessibility layer is blocked

The main window class is `Qt51514QWindowIcon` and its content pane is `MMUIRenderSubWindowHW`: the
entire UI is drawn by hand onto one surface. A whole-desktop UIA scan returns 1754 elements, but
WeChat contributes only 4 of them, with no names and no control types. There is no button to press by name.

Contrast with `regedit` on the same machine: UIA exposes almost nothing there either, but MSAA
(`oleacc`) reveals `SysTreeView32`, `SysListView32` and `Edit`, so the probe reports
`accessibility = available`. The probe detects both worlds.

### Why the private-API layer is blocked

The loopback listeners belong to WeChat internal IPC, not to a documented HTTP API. Speaking that
protocol would break the service terms, requires bypassing anti-automation defences, and is a ban risk.
This project does not do it. WeChat for Business (WeCom) is the supported surface: it publishes
official MCP and CLI interfaces for documents, calendars and messages, which is what the
`official-api` layer is for.

## Reading the mini-program case

WeChat mini programs run on `WeChatAppEx.exe` (RadiumWMPF), which *is* Chromium. Those are a different
story: restarting a mini-program runtime with a remote debugging port would put them at the `devTools`
layer. Not attempted here.

## What this case proves about the project

An honest probe beats a hopeful one. Without it an agent would burn a long Computer Use run against nine
candidate layers; with it, the answer is decided in about four seconds and the reason is written down
with evidence.