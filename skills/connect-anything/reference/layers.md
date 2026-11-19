# Integration layers

Rank is **automation strength**: smaller = stronger, steadier, less likely to break or get an account
flagged. Routing always takes the smallest available rank. A generated connector always wins over a
probed layer, because someone already confirmed it works.

| rank | layer | what it is | how it is detected |
|---|---|---|---|
| 1 | `official-api` | vendor API / CLI / official MCP | a connector with `layer: official-api` is installed |
| 2.5 | `local-store` | the app's own database | DB files whose header is `SQLite format 3` |
| 3 | `private-api` | HTTP/WS endpoints the app calls | HAR contains JSON endpoints; or only loopback listeners (→ `blocked`) |
| 3.5 | `devTools` | Chrome DevTools Protocol | `--remote-debugging-port` and `/json/version` answers |
| 4 | `accessibility` | OS control tree (UIA / MSAA / AX) | ≥6 named UIA controls, or MSAA control classes like `SysTreeView32` |
| 6 | `scripting` | URL scheme / COM / AppleScript / D-Bus | registry or bundle declares a handler that launches the exe |
| 9 | `computer-use` | screenshot + input | always available, always last |

## Status semantics

- **`available`** — detected, and safe to use. Use it.
- **`unavailable`** — the app does not expose this. Skip it; do not "try harder".
- **`blocked`** — it exists, but using it means defeating a protection or violating terms. This is a
  deliberate refusal with a reason attached. Report the reason; take the next layer.
- **`unknown`** — not probed, or only the vendor can confirm. Check docs or ask the user.

## Why layers come out blocked

| layer | why blocked | example |
|---|---|---|
| `local-store` | databases are SQLCipher-encrypted and the key is not on disk | WeChat `db_storage`: 24 DBs, 1.05 GB, all encrypted; key absent from disk, memory and PBKDF2 calls |
| `private-api` | the only listeners are loopback IPC for the app's own protocol | WeChat listens on `127.0.0.1:14013/14016/…` |
| `accessibility` | the UI is self-drawn on one surface, so there is no control to name | WeChat: `Qt51514QWindowIcon` + `MMUIRenderSubWindowHW`, `namedControls=4` |

## Two traps worth remembering

1. **A small UIA tree does not mean self-drawn.** Legacy Win32 apps expose almost nothing to UIA but
   everything to MSAA. `regedit` shows `SysTreeView32` / `SysListView32` / `Edit`, so it is drivable.
   Always check both before declaring `blocked`.
2. **"Chromium-based" is not "has DevTools".** Mini-program runtimes and Electron apps are Chromium, but
   without `--remote-debugging-port` the layer stays `unavailable` until the app is restarted with it.