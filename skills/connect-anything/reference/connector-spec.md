# Connector spec

A connector is a plain JSON file in the connectors directory (default
`~/.connect-anything/connectors/<app>.json`). It is reviewable, diffable and shareable: no secrets, no code.

## Shape

```json
{
  "name": "myapp",
  "baseUrl": "https://api.example.com",
  "layer": "private-api",
  "codec": "json",
  "staticHeaders": { "referer": "https://example.com/" },
  "auth": [{ "header": "authorization", "env": "CXA_MYAPP_AUTHORIZATION" }],
  "tools": [
    {
      "name": "get_projects_tasks",
      "method": "GET",
      "path": "/api/v1/projects/{project_id}/tasks",
      "pathParams": ["project_id"],
      "query": { "status": { "type": "string", "required": false, "example": "open" } },
      "resultPath": "data.items",
      "description": "List tasks in a project"
    }
  ]
}
```

### Fields that matter

| field | effect |
|---|---|
| `auth[].env` | environment variable **name** holding the credential. Values are never stored. |
| `auth[].optional` | credential sent when present, skipped when absent (cookies that only unlock extra data). |
| `codec` | request encoding: `json` (default when a body exists), `form`, or `weapi`. Can be set per tool. |
| `staticHeaders` | headers the API requires on every call (Referer, Origin, User-Agent). |
| `resultPath` | dotted path trimmed out of the JSON response into `data`, so an agent does not parse whole payloads. |
| `bodyDefaults` | constants merged under the caller's body (e.g. `{ "csrf_token": "" }`). |
| `bodyEncoding` | `form` sends the body URL-encoded instead of JSON. |

## Generated vs authored

`cxa har` produces the mechanical part: which endpoints exist, which path segments are ids, which
params were always present (→ `required`). It **cannot** recover encrypted payloads: a request shaped
like `params=…&encSecKey=…` ships with no parameter schema.

The authored part is a separate file, merged with `--augment`:

```bash
cxa har capture.har --name myapp --augment specs/myapp.json
```

```json
{
  "codec": "weapi",
  "staticHeaders": { "referer": "https://music.163.com/" },
  "drop": ["/weapi/middle/clientcfg/config/list", "/api/telemetry"],
  "tools": [
    { "name": "song_lyric", "method": "POST", "path": "/weapi/song/lyric",
      "codec": "weapi", "resultPath": "lrc",
      "body": { "id": { "type": "string", "required": true } },
      "bodyDefaults": { "lv": -1, "kv": -1, "tv": -1 } }
  ]
}
```

`drop` matches either `"METHOD /path"` or a bare path, case-insensitively. Use it aggressively:
30 clean tools beat 80 including telemetry, login handshakes and config pokes.

## Codecs

| codec | what it does |
|---|---|
| `json` | `content-type: application/json`, body as given. |
| `form` | `application/x-www-form-urlencoded`. |
| `weapi` | NetEase's envelope: AES-128-CBC twice with random 16-char secrets, then RSA-encrypt both secrets. Every param travels inside the blob; the URL carries only `csrf_token`. |

Add a codec by writing a module next to `weapi.js` and one branch in `buildRequest`. Nothing else
needs to change — routing, MCP and the CLI stay untouched.

## Response handling

A tool is a **failure** when the HTTP status is non-2xx **or** when the JSON has a business `code` that
is not `200`. Many private APIs answer `200 OK` with `{"code":50000005}`; treating that as success is
the most common way a generated connector lies to you.