# Case study: NetEase Cloud Music (music.163.com)

Goal: prove the connect-anything pipeline on an app with a genuinely hostile API
shape, not a demo-friendly one. NetEase is a good test because its web player
signs every request with a two-layer AES envelope plus an RSA-wrapped secret, so
the naive "replay what the browser sent" connector cannot work at all.

Evidence below is from this machine on 2026-11-18. Capture: `captures/netease.har`
(26 MB, 402 entries, 56 of them to `music.163.com`).

## 1. Capture (real, not synthetic)

A Playwright context with `recordHar` was driven through four views: home page,
search results, playlist `3778678` (热歌榜), song `65538` (好久不见). Resulting
traffic shapes:

| shape | example | notes |
|---|---|---|
| encrypted weapi POST | `/weapi/song/lyric?csrf_token=` | body `params=<AES>&encSecKey=<RSA>`, form-encoded |
| encrypted weapi POST, JSON as `text/plain` | `/weapi/cloudsearch/get/web` | response mime is `text/plain` |
| plaintext GET | `/api/toplist/detail`, `/api/cloudsearch/pc` | classic JSON API, needs `Referer` |
| plaintext path-embedded id | `/api/v1/resource/comments/R_SO_4_65538` | id lives inside a path segment |

Every weapi request carried `Referer: https://music.163.com/`, `Origin`, a
browser UA, and cookies (`NMTID`, `JSESSIONID-WYYY`, `_ntes_nuid`, ...). Responses
for weapi are **plain JSON** - only the request is encrypted.

## 2. What the generator worked out on its own

`cxa har captures/netease.har --name netease --host music.163.com`

- clustered 56 requests into endpoint templates,
- recognised the encrypted envelope and labelled each tool `[weapi]` instead of
  inventing a parameter schema it cannot see,
- pulled the common `Referer` into `staticHeaders`,
- found `cookie` + `x-anticheatttoken` as auth headers and mapped them to
  `CXA_NETEASE_COOKIE` / `CXA_NETEASE_X_ANTICHEATTOKEN` (cookie marked optional),
- kept JSON-as-`text/plain` responses and encrypted requests, which the 0.1.0
  filter dropped (that filter hid `cloudsearch/get/web` entirely).

It also produced noise every real capture has: `clientcfg/config/list`, `cdns`,
`privacy/info/get/v2`, login QR polling, feedback beacons.

## 3. What needed extending (now in `src/`)

| gap | fix |
|---|---|
| plaintext params never appear in traffic | `src/weapi.js`: AES-128-CBC twice (fixed nonce + random 16-char secret) and RSA `encSecKey`, zero dependencies |
| connector could only send JSON bodies | `codec: "weapi"` and `bodyEncoding: "form"` in `buildRequest` |
| NetEase rejects calls without `Referer` | `staticHeaders` on connector/tool, merged from capture |
| `csrf_token=` was inferred as required because it appeared every time | required only when the observed value is non-empty |
| captured params are unrecoverable | `--augment spec.json`: authored schemas win, endpoints found elsewhere can be added, noise dropped |
| business errors hide behind HTTP 200 | `callTool` marks `ok:false` when JSON `code !== 200` and exposes `code` |

The authored spec is `specs/netease.json`; the installed connector is
`~/.connect-anything/connectors/netease.json`:

```
cxa har captures/netease.har --name netease --host music.163.com --augment specs/netease.json
```

## 4. Result: 10 tools, verified live through MCP

`node scripts/netease-smoke.mjs` spawns the real stdio server, runs `initialize`,
`tools/list`, then calls every tool.

| tool | transport | verified result |
|---|---|---|
| `netease__search_songs` | `GET /api/cloudsearch/pc` | 200, song list for "告五人" |
| `netease__song_detail` | weapi `/weapi/v3/song/detail` | 200, 好久不见 / 陈奕迅 |
| `netease__song_lyric` | weapi `/weapi/song/lyric` | 200, `lrc.lyric` with timed lines |
| `netease__playlist_detail` | weapi `/weapi/v6/playlist/detail` | 200, 热歌榜 + tracks |
| `netease__toplist` | `GET /api/toplist/detail` | 200, all official charts |
| `netease__album_detail` | weapi `/weapi/v1/album/{album_id}` | 200, album + songs |
| `netease__artist_detail` | weapi `/weapi/v1/artist/{artist_id}` | 200, artist profile |
| `netease__song_comments` | `GET /api/v1/resource/comments/R_SO_4_{id}` | 200, hot comments |
| `netease__song_url` | weapi `/weapi/song/enhance/player/url/v1` | 200 but `url:null, code:-110` (needs login) |
| `netease__search_songs_web` | weapi `/weapi/cloudsearch/get/web` | 200 but `code:50000005` (web-player endpoint blocks anonymous replay) |

The last two are deliberately kept and reported as failures rather than hidden:
they are real endpoints the web player uses, and they show exactly where a
session cookie is required.

## 5. Honest limits

- **Login-gated data:** play URLs, personalised recommendations and account
  endpoints need `CXA_NETEASE_COOKIE` (`MUSIC_U=...`) from a logged-in browser.
  None was available here, so those stay unverified.
- **Anti-abuse:** the web player's own search endpoint answers `50000005` to
  scripted anonymous calls; the plaintext `/api/cloudsearch/pc` still works.
  Expect more of this over time - that is the self-healing roadmap item.
- **Undiscovered surface:** only endpoints that fired during a 4-view clickthrough
  are represented. Playlists/personal FM/cloud disk/newsong also exist.
- **Parameter names** for weapi tools were authored from the captured paths and
then confirmed by live responses; a fully automatic path would need JS static
  analysis (REA) of the player bundle, which is not wired up for this yet.

## 6. Responsible use

Read-only endpoints of an account you own, for interoperability. No DRM bypass,
no scraping at scale, no credential sharing; cookies stay in env vars.
