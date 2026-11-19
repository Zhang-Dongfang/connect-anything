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

## Second pass: the local data layer (the layer the first pass missed)

A fair criticism of the first pass: it only looked at live UI and network surfaces. The real data lives
on disk. `cxa probe` now scans it too.

### What is actually on disk

`cxa probe Weixin --find-store "xwechat_files,wxid_,db_storage"` auto-locates the account store:

```
found store: C:\Users\<you>\xwechat_files\wxid_<redacted>\db_storage (24 db files, 1051131904 bytes)
local-store  blocked   total=24 plaintext=0 encrypted=24 bytes=1051131904
```

| file | size | state |
|---|---|---|
| biz_message_0.db | 396,455,936 | encrypted |
| message_0.db | 249,118,720 | encrypted |
| message_1.db | 126,275,584 | encrypted |
| message_fts.db | 109,879,296 | encrypted |
| contact.db | 25,657,344 | encrypted |

Every one of the 24 stores has a random-looking 16-byte header where `SQLite format 3\0` should be.
That is the SQLCipher signature. WeChat 4.x uses SQLCipher 4: AES-256-CBC, PBKDF2-HMAC-SHA512 with
256,000 iterations, per-database salt.

### How far the key recovery actually got

Tested on this machine (`Weixin 4.1.15.13`), read-only, no messages touched:

1. **Disk hunt — nothing.** `key_info.dat` in `%APPDATA%\Tencent\xwechat\login\<wxid>\` is 180 bytes of
   high-entropy data with no SQLite header. No key material is stored in plaintext.
2. **Memory scan — works as a technique, finds no key here.** With `ReadProcessMemory` via
   `OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ)`, **no administrator rights needed**, the
   scanner read 1041 MB of the main process in 2.2 s. The classic WCDB pattern the public tools look for
   (`x\'<64 hex key><32 hex salt>\'`) is **not present**. A wider search for every 32-40 character hex
   string found many candidates, but the ones that matched a database salt were message *payload*
   fragments (the bytes next to them read `pic_type`, `exposure_info`, `bizu`), not keys.
3. **API hook — the decisive negative.** Frida 17.24 attaches to the process with no admin rights and can
   hook `bcrypt.dll!BCryptDeriveKeyPBKDF2`, which is exactly what SQLCipher calls to derive each database
   key. The hook installed successfully at `0x7fff97d725d0`. Over 30 s of live use it recorded **zero
   calls**: by the time WeChat is running, the keys are already derived and cached elsewhere, and nothing
   re-derives them while idle.

This independently reproduces a known upstream finding: the leading public tool `wx-cli` has an open
issue (#89) reporting that **WeChat 4.1.10+ no longer caches the raw encryption key in process memory**.
This machine runs 4.1.15.13, i.e. past that change.

### Conclusion

Getting WeChat chat history out would need a deeper route: hooking SQLCipher internal key-setup inside
WeChat's statically linked code, or reading keys from a decorator/snapshot. Those are deliberately out of
scope here: they mean bypassing the protections the user's own client relies on, which the project does
not do. The honest verdict for WeChat is therefore:

- `local-store` **blocked** — encrypted, key not recoverable by read-only means
- `private-api` **blocked** — loopback IPC only, speaking it breaks the terms
- `accessibility` **blocked** — self-drawn Qt UI
- `devTools` **unavailable** — mini-program runtime exists but the port is closed
- `scripting` **available** — `weixin://` deep links only
- verdict: **Computer Use**, or **WeChat for Business (WeCom)**, which publishes official MCP and CLI interfaces

A capability that stops and says "blocked, here is the evidence, and here is the real alternative" is
worth more than one that guesses. That is the whole point of the probe.
