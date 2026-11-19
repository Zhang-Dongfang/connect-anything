# connect-anything 架构说明

> 一句话：把任意软件接入 MCP。先探测它能怎么被自动化，再拿工具，最后才退到 Computer Use。

## 1. 定位与边界

| | REA（上游，MIT） | connect-anything（本项目） |
|---|---|---|
| 回答的问题 | 这个软件是怎么实现的？ | 怎么让 Agent **真的去用它**？ |
| 产出 | 伪代码、符号、字符串、证据 | 可调用的 MCP 工具 + 路由决策 |
| 副作用 | 只读分析 | 会发请求、会改数据 |
| 关系 | 被本项目当黑盒 CLI 调用 | 不 fork REA |

**非目标（明确不做）**：通用 RPC 逆向器、从进程内存抠密钥、绕过反自动化风控、反检测。这些是另一个产品，不做进来。

## 2. 设计原则

1. **先判断，再动手**：`probe` 先给出「这个 app 支持哪几层」，避免拿像素硬搮。
2. **能力最强层优先，像素层兜底**：每层都有数值 rank，路由按 rank 选。
3. **结论必须带证据**：每条判定附 `evidence[]`，可复现、可反驳。
4. **凭据不落盘**：连接器只存环境变量**名字**，不存值。
5. **`blocked` 是一等状态**：不是「不知道」，而是「能做但判断不该做」，并写清原因。
6. **核心零依赖**：手写 stdio JSON-RPC，装一个包就能跑。

## 3. 分层接入模型

rank 不是重要性，而是**自动化强度**（越小越强、越稳、越不可能封号）。

| rank | layer | 是什么 | 典型判定依据 |
|---|---|---|---|
| 1 | `official-api` | 官方 API / CLI / 官方 MCP | 已安装官方连接器 |
| 2.5 | `local-store` | 本地数据库 | 文件头是 `SQLite format 3` → 明文可读 |
| 3 | `private-api` | 抓包逆向出的 HTTP/WS 接口 | HAR 中有 JSON 端点；或有走 IPC 的回环监听（→ blocked） |
| 3.5 | `devTools` | Chrome DevTools Protocol | `--remote-debugging-port` 且 `/json/version` 可达 |
| 4 | `accessibility` | 无障碍控件树 UIA / MSAA | UIA 命名控件 ≥ 6，或 MSAA 暴露 `Sys*` 控件类 |
| 6 | `scripting` | URL 协议 / COM / AppleScript | 注册表里能找到拉起它的协议处理器（粗粒度） |
| 9 | `computer-use` | 屏幕 + 键鼠 | 永远可用，永远最后选 |

四种层状态：

```
available    探测到且能安全使用
unavailable  这个 app 没这个能力（未运行 / 不是 Chromium / 无监听）
blocked      存在但不能做：保密存储、内部 IPC、自绘 UI。（带 note 说明）
unknown      没探测过，或需要官方文档才能确认
```

## 4. 总体架构

```
                 ┌─────────────────────────────┐
                 │  Agent (Claude Code / Cursor │
                 │  / Conexus / 任何 MCP 客户端)  │
                 └───────────┬─────────────────┘
                             │ MCP (JSON-RPC over stdio)
                 ┌───────────▼─────────────────┐
                 │        src/mcp.js            │  ← 零依赖服务，tools/list + tools/call
                 │  内建 5 个工具 + N 个生成工具      │
                 └───┬────────┬────────┬───────┘
                     │        │        │
      ┌──────────────▼┐  ┌────▼─────┐  ┌▼──────────────┐
      │  router.js    │  │ probe.js │  │ connector.js   │
      │  选层 + 降级     │  │ 判定 + 证据 │  │ 执行工具（HTTP） │
      └──────────────┘  └────┬─────┘  └┬──────────────┘
                             │            │
        ┌─────────┬──────────┐        ┌───▼────────┐
        │         │          │        │ weapi.js   │
   ┌────▼───┐ ┌───▼────┐ ┌───▼────┐   │ 编解码插件   │
   │store.js│ │discover│ │probe-win│   └────────────┘
   │库扫描  │ │找数据目录│ │.ps1     │
   └────────┘ └────────┘ │UIA/MSAA │        ▲
                          └─────────┘        │
                                    ┌─────────┴──────────┐
                                    │   connector.json    │
                                    │（连接器规格，可审阅） │
                                    └─────────▲──────────┘
                                              │
                          ┌─────────────────┴────────┐
                          │ har.js    ← 抓包→规格      │
                          │ rea.js    ← 上游 REA 分析   │
                          │ specs/*.json ← 人工补充      │
                          └──────────────────────────┘
```

## 5. 模块职责

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `src/mcp.js` | MCP 服务（stdio JSON-RPC），把内建工具 + 生成的工具统合后暴露 | `createServer`, `serveStdio` |
| `src/router.js` | 层表与选层；接受 probe 结果做决策，返回 use / fallbacks / blockedReasons | `LAYERS`, `rankOf`, `route` |
| `src/probe.js` | 把宿主事实加工成各层判定；判定逻辑全在这里，可单测 | `classify`, `probeApp`, `STATUS` |
| `src/har.js` | HAR 聚类成端点模板，推断参数与必填，过滤噪声；支持 augment 合并 | `harToConnector`, `applyAugment`, `templatePath` |
| `src/connector.js` | 加载规格；参数 → 请求；调用 + 业务码判失败 + resultPath 裁剪 | `buildRequest`, `callTool`, `toolInputSchema` |
| `src/weapi.js` | 编码插件示例：AES-CBC + RSA 信封（网易云 weapi） | `weapiForm`, `weapiEncrypt`, `rsaEncryptHex` |
| `src/store.js` | 本地库扫描：判明文 SQLite / SQLCipher | `scanStore`, `classifyDbFile` |
| `src/sqlite.js` | 只读读库：语句白名单 + 只读连接（Node 内置 node:sqlite，无依赖） | `isReadOnlySql`, `openReadOnly`, `tableNames`, `runQuery` |
| `src/act.js` | 无障碍层真驱动：按名字/AutomationId 做 invoke / set / get，动作后重读验证 | `runAct`, `pickTarget`, `patternFor`, `rejectPixelArgs` |
| `src/discover.js` | 按路径关键词自动定位数据目录 | `findStore`, `scoreDir` |
| `src/rea.js` | 上游 REA 适配器（固定版本，黑盒 CLI + `--json`） | `reaAnalyzeApp`, `extractEndpoints` |
| `src/cli.js` | `cxa serve / har / probe / store / act / list` | — |
| `scripts/probe-win.ps1` | Windows 事实采集：进程、监听、协议、UIA、MSAA、调试端口 | — |
| `tools/cxa-acc.cs` | 通过 oleacc（MSAA）读老式 Win32 控件类 | — |
| `scripts/pr-triage.mjs` | PR 自动分诊：按改动路径贴 area 标签 + 发一条首次接待（pull_request_target，从不 checkout PR 代码） | `labelsFor`, `triageComment`, `run` |

**关键边界**：`probe-win.ps1` 只采集**事实**，`probe.js` 才做**判断**。所以判定规则能在 Linux CI 上用抓下来的 JSON 跑单测（`test/fixtures/*-probe.json`）。

## 6. 三条主数据流

### A. 探测流（先问“能不能”）

```
cxa probe Weixin --find-store "xwechat_files,wxid_,db_storage"
   │
   ├─ discover.findStore()        → 数据目录候选
   ├─ store.scanStore(dir)        → {total, plaintext, encrypted, largest}
   ├─ probe-win.ps1               → facts{instances, listeners, schemes, windows, cdpPorts}
   ├─ probe.classify(facts)       → verdict{layers[], recommended, blocked[]}
   └─ router.route(app, ..., ver)  → {use, fallbacks, blockedReasons}
```

### B. 生成流（拿工具）

```
浏览器/客户端使用中导出 HAR
   │
   ├─ har.harToConnector(har,{name,host})
   │     ├─ 过滤：静态资源、第三方域、无 JSON
   │     ├─ templatePath()：/projects/101/tasks → /projects/{project_id}/tasks
   │     ├─ 必填推断：样本里出现率 100% → required
   │     └─ 凭据：只写 env 名 CXA_<APP>_<HEADER>
   ├─ applyAugment(spec)   ← 人工补充：codec、staticHeaders、drop、resultPath
   └─ ~/.connect-anything/connectors/<app>.json
         → MCP tools/list 出现 <app>__<tool>
```

加密请求体（如 `params=...&encSecKey=...`）**明文不可从流量恢复**，所以这些工具初始不带参数 schema，必须由 augment 规格补齐——不靠猜。

### C. 调用流（真正执行）

```
tools/call <app>__<tool>{...}
   │
   ├─ 找不到工具 → 报错（带已安装工具名）
   ├─ missingAuth() → 必需凭据缺失就直接报要设哪个 env
   ├─ buildRequest()
   │     ├─ 填路径参数、query
   │     ├─ staticHeaders + auth（env 注入）
   │     └─ codec 分支：json / form / weapi
   ├─ fetch()
   ├─ 判定：HTTP 非 2xx 或业务 code ≠ 200 → ok=false
   ├─ resultPath 裁剪（如 code → 只返回 data.songs）
   ├─ 401/403/404/5xx → health[app]=false → 路由降级
   └─ 返回 {ok,status,code?,data?,body}
```

## 7. 关键数据结构

### 连接器规格（可审阅、可 diff、可共享）

```json
{
  "name": "netease",
  "baseUrl": "https://music.163.com",
  "layer": "private-api",
  "codec": "weapi",
  "staticHeaders": { "referer": "https://music.163.com/" },
  "auth": [{ "header": "cookie", "env": "CXA_NETEASE_COOKIE", "optional": true }],
  "tools": [{
    "name": "song_lyric", "method": "POST", "path": "/weapi/song/lyric",
    "codec": "weapi", "resultPath": "lrc",
    "body": { "id": { "type": "string", "required": true } },
    "bodyDefaults": { "lv": -1, "kv": -1, "tv": -1 }
  }]
}
```

### 探测判定

```json
{ "app": "Weixin", "running": true, "recommended": "scripting",
  "blocked": ["local-store", "private-api", "accessibility"],
  "layers": [{ "id": "accessibility", "rank": 4, "status": "blocked",
               "evidence": ["2 top-level window(s)", "namedControls=4"],
               "note": "Self-drawn UI: ..." }],
  "stores": [{ "dir": "...", "total": 24, "plaintext": 0, "encrypted": 24 }] }
```

## 8. 扩展点

| 想加什么 | 改哪里 | 不需要改 |
|---|---|---|
| 新编码（签名/HMAC/商密） | `src/weapi.js` 旁边再加一个 codec 模块 + `buildRequest` 一个分支 | 路由、MCP |
| 新平台探测 | 新增 `scripts/probe-<platform>.ps1|sh`，在 `probe.js` 的 `SCRIPT` 表注册 | 判定逻辑 |
| 新接入层 | `LAYERS` 加一行 + `classify` 加一段 | MCP、CLI |
| 官方 API/MCP | 写成 `layer: official-api` 的连接器或直接引用外部 MCP | 其他全部 |
| 新 app | `cxa har` 或 `specs/<app>.json` | 核心代码 |

## 9. 安全与合规边界

1. **凭据**：只存 env 名；`optional: true` 的凭据缺了就不发，不报错。
2. **读 vs 写**：当前版本的生成工具可能是写操作（POST/PUT/DELETE）。**已知缺口**：还没做删除类工具的二次确认（见待办）。
3. **`blocked` 语义**：加密本地库、内部 IPC、自绘 UI 一律标 blocked，并附原因。项目不提供取密钥/绕风控的实现。
4. **抓包**：只分析用户自己产生的流量；`captures/*.har` 已在 `.gitignore` 之外单独存放，公开仓库不提交真实账号流量（提交前必须清洗）。
5. **责任**：仅用于你拥有或已获授权自动化的软件与账号。

## 10. 现状

- 测试：**87/87**（core 6 / probe 13 / store 8 / sqlite 5 / act 10 / discover 3 / netease 9 / skill 16 / repo 6 / triage 11）
- 已实机验证：
  - **网易云音乐**：weapi AES/RSA 信封跑通，`/api/cloudsearch/pc` 匿名可用；weapi 搜索匿名返 50000005（已写入文档，不当作可用）
  - **微信 4.1.15.13**：五层全封禁，含磁盘/内存/Frida 三步取密钥实测，结论「Computer Use 或企业微信官方接口」
  - **regedit**：UIA 几乎为空但 MSAA 有 `SysTreeView32` → 无障碍层可用（防假阴性）
  - **桌面本地库**：网易云桌面 `NIM` 目录 13 个明文 SQLite，`cxa store <dir> --db msg.db --sql "..."` 真读到 `msglog` / `thread_msg_log`；Discord 与 clash-verge（Tauri）目录只剩 WebView2 runtime 库，现判为 noise，不再误报“可读库”
- 仓库门禁：test/repo.test.js 检查社区文件、可发布元数据、CI 矩阵，并扫描全树的个人路径 / 账号 id / 真 token
- 已知缺口：删除类工具确认、macOS/Linux 探测、WebSocket、自愈重生成、真实账号回归、GitHub 地址与 owner

## 11. 代码地图

```
src/           核心（零依赖）
test/          单测 + 真实机器抓下来的 fixture
scripts/       宿主能力（PowerShell 事实采集、Frida 实验、波动测试）
specs/         人工撰写的 augment 规格（按 app 一档）
docs/          案例：weixin.md、netease.md、architecture.md
skills/        Agent Skill 包（SKILL.md + reference/，面向宿主的流程层）
tools/         C# 互操辅助（MSAA）
.github/       CI（Ubuntu + Windows × Node 20/22/24）、PR 自动分诊、issue/PR 模板、dependabot
```

设计上的一条铁律：**宿主相关的“事实采集”与跨平台的“判定逻辑”严格分离**。
前者依平台重写，后者靠 fixture 在不同平台跑同一个断言。

## 12. Skill 封装（流程层）

MCP 给的是**工具**，Skill 给的是**流程**。两者共用同一份判定逻辑，不重复实现：

```
host agent --(loads)--> skills/connect-anything/SKILL.md
                            | 5 步：probe -> 按推荐层行动 -> 抓一次 -> 生成 -> 验证
                            | 渐进加载：只有需要时才读 reference/*.md
                            +--(calls)--> MCP server (cxa serve) 或 cxa CLI
```

- **渐进披露**：`SKILL.md` 只做索引（约 100 行 / 5 KB），`reference/layers.md`、`connector-spec.md`、
  `policy.md` 按需加载。Skill 体量小才不会挤占宿主 agent 的上下文。
- **单一事实源**：`test/skill.test.js` 断言 SKILL.md 里出现的每个 `cxa <cmd>` 都真在
  `KNOWN_COMMANDS` 里、提到的每个层名都真在 `src/router.js` 里；文档写了代码没有的东西就红。
- **可拒绝的校验**：`validateSkill()` 对 8 类坏输入说不（无 frontmatter / 名与目录不符 /
  大写或下划线 / description 缺失或超长 / 正文超长 / 引用文件缺失）；`cxa skill --check` 是
  开发者入口，`installSkill()` 拒绝覆盖已存在目录（除非 `--force`）。
- **职责边界**：Skill 负责「该不该自动化、用哪一层、什么时候停」，遇到 `blocked` 要求如实
  报告而不是继续硬啃。真正发请求的永远是 MCP 工具或 CLI：装了 Skill 不会凭空多出 endpoint。
