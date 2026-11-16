# 13 · 官方历史对话 ZIP 映射（双向兼容）

> 目标：**官方导出 → 我们可导入；我们导出 → 官方可导入。**
> 参照实现：原版 demo `deepseek-ai/chat-demo@5d5dd75` 的 `src/services/chat/history/*`（这是官方格式的权威实现，逐行读过）。
> 代码件：`docs/specs/14-zip-codec.js`（浏览器可用的 ZIP 读写）、`scripts/e2e/fixtures/make-official-backup.cjs`（造合法官方 ZIP）、`scripts/e2e/fixtures/validate-official-backup.cjs`（按官方 schema 校验任意 ZIP）。
> 约定：`src/...:行号` 是 demo 出处；`client.js` 只标函数/组件名（该文件由 lead 独占修改，行号会漂移）。

---

## 0. 一页纸结论

| 维度 | 官方格式 | 我们的做法 |
| --- | --- | --- |
| 容器 | ZIP，条目 **STORE（method 0）**、mtime 固定 `1980-01-01`、无 ZIP64、无加密、**无 data descriptor** | 用 `zipWrite()` 写同一形状；读取端**额外接受 DEFLATE + data descriptor**（真实官方导出可能带） |
| 条目顺序 | `manifest.json` → 每个 `chat_sessions/{id}.json` → `chat_session_index.json` → 图片 | 严格照抄；**index 必须排在全部会话之后**，否则官方导入器会 `backupIncomplete`（§6） |
| 版本 | `manifest.export_format_version === 3` | 导出写 3；导入 `>3` → 版本过新，`≠3` → 版本无效 |
| 消息 | 树（`id` 数字、`parent_id`），内容全在 `fragments[]`（13 种） | 导出时把我们的消息树重编号为 `1..n`（父优先 DFS）；导入时按 `parent_id` 还原树 |
| 附件 | `FILE` 片段只有元数据；图片原件另存为 `chat_sessions/{id}_files/{file_id}_{文件名}` | 我们**没有本地原件**：导出 `export_path: null`；导入时 `fileId: ''`（不再进请求，只展示文件名） |
| 状态 | 7 个枚举 | 见 §5.1 的映射（`done/stopped/error` + `stopReason` ↔ 7 枚举） |
| 图片缺失 | 官方允许（只显示文件名） | 同官方，另外给出"附件需重新上传"提示 |

**最容易丢的信息**（导出后官方侧会变少）：`citations`（官方无字段）、`READ_LINK` 的 `signature`（我们没存）、`TOOL_FIND`/`PARTIAL_FILE_READ`（我们没有对应块）、`fetch` 的 title/site/status（我们只存 url）。详见 §5.6。

---

## 1. 归档的字节级要求

### 1.1 条目顺序与命名

```ts
// src/services/chat/history/paths.ts:1-10
export const MANIFEST_PATH = 'manifest.json'
export const USER_PATH = 'user.json'
export const INDEX_PATH = 'chat_session_index.json'
export const sessionPath = (sessionId: string) => `chat_sessions/${sessionId}.json`
export const sessionFilesDir = (sessionId: string) => `chat_sessions/${sessionId}_files/`   // ★ 结尾带 /
export const imagePath = (sessionId, fileId, fileName) =>
  `${sessionFilesDir(sessionId)}${safeName(fileId)}_${safeName(fileName)}`.normalize('NFC')
```

| # | 条目 | 必需 | 说明 |
| --- | --- | --- | --- |
| 1 | `manifest.json` | **必须第一条** | 官方读取端只检查第一个条目是不是它（`src/services/chat/history/importArchive.ts:62-66`） |
| 2 | `chat_sessions/{sessionId}.json` ×N | 至少 0 | `sessionId` 不能含 `/`、`\`，不能是 `.`/`..`（`src/services/chat/history/schema.ts:224-227`） |
| 3 | `chat_session_index.json` | **必须有** | 必须排在所有会话 JSON **之后**；官方收尾校验 index 的 id 集合与已导入会话完全一致（`importArchive.ts:145-157`） |
| 4 | `chat_sessions/{sessionId}_files/{fileId}_{文件名}` | 可选 | 只为 `FILE.files[].export_path` 指向的图片写；`export_path` 必须在本会话目录下（`toLocal.ts:306-313`） |
| — | `user.json` | 可选，我们**不写** | 官方导出端不写（`exportArchive.ts:11`）；导入端允许出现且跳过（`importArchive.ts:114-116`） |

`{fileId}_{文件名}` 两段都过 `safeName`：`/`、`\` → `_`，空/`.`/`..` → `unnamed`，整体 NFC（`paths.ts:17-23`）。

### 1.2 ZIP 容器约束（官方读取端实际会检查的）

| 约束 | 官方出处 | 我们 |
| --- | --- | --- |
| 本地头签名 `PK\x03\x04`（`0x04034b50`），EOCD 签名 `PK\x05\x06`（`0x06054b50`） | `zipReader.ts:19-23, 96-104` | 同 |
| **STORE（method 0）**，可选 deflate（method 8） | `zipWriter.ts:83`（写）、`zipReader.ts:139-152`（读） | 写 STORE；读两者 |
| 不支持 ZIP64：条目数 `0xffff`、大小/偏移 `0xffffffff` 均为哨兵 → 报错 | `zipWriter.ts:4-12, 42-64`；`zipReader.ts:106-119, 140-152` | 同 |
| 不支持分卷（disk/diskStart 必须 0）、不支持加密 | `zipReader.ts:109-119, 140-152` | 同 |
| flags 只允许 `0x080e` 三位：bit 1/2（deflate 级别提示）、bit 3（data descriptor）、bit 11（UTF-8 文件名） | `zipReader.ts:139-152` | 写 `0x0800`（UTF-8，无 descriptor）；读支持 bit 3 |
| 非 ASCII 文件名必须带 **UTF-8 flag（bit 11）**，否则官方直接判非法 | `zipReader.ts:61-75` | `zipWrite` 恒定带 `0x0800` |
| 文件名禁止 `\`、`\0`、盘符、绝对路径、空段/`.`/`..` | `zipReader.ts:61-75` | 写入前校验，读取时同样校验 |
| extra field 必须合法且不含 ZIP64 extra（id `0x0001`） | `zipReader.ts:46-59` | 写 extra 长度 0 |
| 本地头与中央目录：flags/method/文件名/CRC/大小必须一致；带 descriptor 时本地 CRC/大小必须为 0，descriptor 与其一致 | `zipReader.ts:180-229` | 写一致值；读兼容 descriptor |
| 中央目录：`offset + size === EOCD 起点`，条目 cursor 恰好走完 size | `zipReader.ts:106-119, 174-177` | 同 |
| 不需要压缩时间：官方写死 `mtime = new Date(1980, 0, 1)` → DOS date `0x0021`、time `0x0000` | `zipWriter.ts:84` | `zipWrite` 写死同样值，保证"同输入同字节" |
| CRC-32 必须与数据一致；解压后长度必须等于声明长度 | `zipReader.ts:289-291` | 写真实 CRC；读校验 |
| 条目上限：`entries < 0xffff`、单条目 `< 0xffffffff` | `zipWriter.ts:42-64` | 超过抛 `ZIP_TOO_LARGE` |

> **双向风险点**：官方**导出端**是 STORE，但官方**导入端**接受 deflate。所以我们写 STORE 最稳；读时必须支持 deflate + data descriptor（真实 fflate 流式写出会带 bit 3）。`zipRead` 两者都实现了。

### 1.3 `manifest.json`

```json
{"export_format_version":3}
```

- 必须是对象（数组直接非法，`schema.ts:230-238` 的 `record()`）。
- `> 3` → `backupNewerVersion`；`≠ 3`（含缺失、非数字）→ `backupInvalidVersion`（`schema.ts:229-238`）。
- 多余字段忽略。

### 1.4 `chat_sessions/{id}.json` / `chat_session_index.json`

字段见 §2；index 是 `SessionIndexEntry[]`（`format.ts:17-25`）。官方读取 index 时会**强制** `pinned: false`（`schema.ts:240-250`），但仍要求字段存在且类型正确。

### 1.5 时间格式

```ts
// src/services/chat/history/format.ts:9-10
/** 2026-11-11T02:33:23.270Z */
export type Iso8601Utc = string
```

- 必须 `YYYY-MM-DDTHH:MM:SS[.fraction]Z`（大写 Z、UTC）；校验正则与"补齐/截断到毫秒后往返一致"见 `schema.ts:37-51`。
- 小数秒位数不限（`Date` 只到毫秒，校验时补齐 3 位再比对，原文保留）。
- 我们导出：`new Date(ms).toISOString()`（正好 3 位毫秒，必然合法）。

### 1.6 图片条目的放置

- 目录：`chat_sessions/{该会话的 id}_files/`，**每个会话目录各写一份**（同一张图出现在两个会话里就写两份，`exportArchive.ts:32-45`）。
- 文件名：`{fileId}_{原文件名}`，两段都 `safeName` + NFC。
- 只有"本地有原件且 `is_image`"的附件才有条目；其它附件只有 `FILE` 元数据（`format.ts:172`）。
- 导入端：不在 `export_path` 引用中的图片条目**跳过**；引用了但缺失 → 只保留文件名（`importArchive.ts:130-137`）。
- MIME 由字节头嗅探（JPEG/PNG/GIF/WEBP/BMP/TIFF/AVIF，`importArchive.ts:17-42`），嗅不出来写空字符串，`is_image` 仍信归档值。

---

## 2. `SessionFile` / `ChatMessage` 全字段

### 2.1 SessionFile（`format.ts:27-38`）

| 字段 | 类型 | 约束 / 语义 | 我们导出 |
| --- | --- | --- | --- |
| `id` | `string` | 非空、不含 `/` `\`、不是 `.`/`..`；必须与文件名一致 | `conversation.id`（先做 path-safe 化） |
| `title` | `string \| null` | 空标题写 `null`（官方：`session.title \|\| null`，`toArchive.ts:261`） | `title || null` |
| `pinned` | `boolean` | 读取端强制 false，写 `false` | `false` |
| `current_message_id` | `number` | 用户**当前停留**的消息；线性化消息树的唯一依据（§3） | 可见路径最后一条的编号；空会话 `0` |
| `inserted_at` | ISO | 会话创建时间 | `createdAt` |
| `updated_at` | ISO | 会话更新时间 | `updatedAt` |
| `messages` | `ChatMessage[]` | 全部节点（含所有分支） | 全部节点（含所有分支） |

### 2.2 ChatMessage（`format.ts:51-65`）

| 字段 | 类型 | 约束 | 我们导出 |
| --- | --- | --- | --- |
| `id` | `number` | 非负安全整数；**会话内自增**，父优先重编号后 `parent_id < id` | §3 的算法产出 |
| `parent_id` | `number \| null` | `null` = 该会话第一条（必须是 `USER`） | 我们的 `parentId` 映射 |
| `role` | `'USER' \| 'ASSISTANT'` | 父子角色必须交替 | 我们的 `role` |
| `status` | 7 枚举 | 见 §5.1 | 由 `status + stopReason` 推导 |
| `thinking_enabled` | `boolean` | 该轮请求是否开启深度思考；USER 消息取"首个回答"的开关（`toArchive.ts:233-239`） | 由块推导（有 thinking 块 → true） |
| `search_enabled` | `boolean` | 该轮是否声明联网搜索 | 由块推导（有 tool/sources/fetch → true） |
| `accumulated_token_usage` | `number` | 沿分支累计的上下文 token；USER 写 0 | 没有用量就写 0 |
| `inserted_at` | ISO | 消息时间 | `createdAt` |
| `fragments` | `Fragment[]` | 按发生顺序，见 §4 | §5.2 映射 |

### 2.3 `SessionIndexEntry`（`format.ts:17-25`）

| 字段 | 类型 | 约束 | 我们导出 |
| --- | --- | --- | --- |
| `id` | `string` | 与会话 JSON 的 id 一致，且集合相等 | 同会话 id |
| `title` | `string \| null` | 同会话 title | 同 |
| `pinned` | `boolean` | 官方恒 false | `false` |
| `message_count` | `number` | 消息数（官方不交叉校验，但写对） | `messages.length` |
| `inserted_at` / `updated_at` | ISO | 同会话 | 同 |

---

## 3. `current_message_id` 语义与 `numberMessages` 算法

### 3.1 语义

- `current_message_id` 指向"用户当前停留的那条消息"；导入端从它出发**向上**沿 `parent_id` 走到根，这条链就是可见路径，其余节点保留为分支（`toLocal.ts:242-279` 注释：`current_message_id 到根的路径为当前分支；其余节点默认选中 id 最大的子消息`）。
- 导出端取 `getVisibleMessages(session).at(-1)` 的编号；空会话写 `0`（`toArchive.ts:258-264`，格式注释见 `format.ts:32`）。
- 导入端对空会话提前返回（`messages.length === 0` 时不查 `current_message_id`，`toLocal.ts:267-269`）；非空会话里 `current_message_id` **必须存在**，否则 `backupInvalidBranches`（`toLocal.ts:270`）。

### 3.2 算法（逐字，`toArchive.ts:209-227`）

```ts
/** 消息按父节点优先重新编号为 1…n，保证 parent_id 小于 id。 */
const numberMessages = (messages: Message[]) => {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const ids = new Map<string, number>()
  const ordered: Message[] = []
  const visit = (message: Message, depth: number) => {
    if (ids.has(message.id)) return
    if (message.parentId) {
      const parent = byId.get(message.parentId)
      // 父节点缺失或成环时数据已损坏。
      visit(parent && depth < messages.length ? parent : fail('backupInvalidBranches'), depth + 1)
    }
    ids.set(message.id, ordered.push(message))     // 先递归父，再落自己 ⇒ 父的编号一定更小
  }
  messages.forEach((message) => visit(message, 0))
  return { ordered, ids }
}
```

要点：

1. **父优先深度优先**：先递归编号父节点，再编号自己 → `parent_id < id` 恒成立，且编号连续 `1..n`。
2. **入参是全部分支节点**（`session.messages`，不是可见路径），所以分支也会被编号；`current_message_id` 单独标记当前路径。
3. `ids` 同时是"旧 id → 新编号"的映射表，后面所有 `parent_id` 都用它换算（`toArchive.ts:242-244`）。
4. **父缺失**（`byId.get(parentId)` 为 `undefined`）或**成环**（递归深度 ≥ 节点数）：`fail('backupInvalidBranches')` → 抛出 `BackupError('backupInvalidBranches')`，导出失败时 UI 显示文案 `文件中的消息分支已损坏，无法导入`（`zh.ts:85`，见 §6.2）。
5. 调用前先 `normalizeSession`（`branches.ts:4-15`）把没有 `parentId` 的旧线性会话补成单链。

### 3.3 走查示例

可见路径 `U1 → A2`，另有一条兄弟回答 `A3`（同父 `U1`），原始数组顺序 `[U1, A2, A3]`：

```
visit(U1,0) → 无父 → ids{U1:1}, ordered=[U1]
visit(A2,0) → 父 U1 → visit(U1) 已编号 → ids{A2:2}, ordered=[U1,A2]
visit(A3,0) → 父 U1 → ids{A3:3}, ordered=[U1,A2,A3]
→ current_message_id = 2（当前停在 A2）
```

导入端还原：`A2.selectedChildId=undefined`（路径终点），`U1.selectedChildId=A2`（覆盖默认的"最大 id 子节点"），`root` = `U1`。

---

## 4. 13 种 fragments 的字段形状

每种片段都**只能**出现在 `messages[].fragments[]` 里。校验语义（官方读取端）：
- 容器/元数据/消息树校验失败 → **整包失败**；
- **单个片段不认识 → 丢弃**（`schema.ts:188-198` 的 `fragment` 包装），不影响其它消息。

### 4.1 文本类（3 种）

**`REQUEST`**（用户提问）

| 字段 | 类型 | 必需 |
| --- | --- | --- |
| `type` | `'REQUEST'` | ✔ |
| `content` | `string` | ✔ |

```json
{ "type": "REQUEST", "content": "帮我查一下 SSE 是什么" }
```

**`RESPONSE`**（模型正文；官方导出会剥掉 `[citation:N]` 标记，引用改由正文外的来源表示，`toArchive.ts:119-144`）

```json
{ "type": "RESPONSE", "content": "SSE 用一个长期保持的 HTTP 响应把 text/event-stream 帧推给浏览器。" }
```

**`TEMPLATE_RESPONSE`**（服务端模板提示：过载/内容过滤/超长/报错提示；**不能当正常回答进上下文**）

```json
{ "type": "TEMPLATE_RESPONSE", "content": "回答已中断。" }
```

### 4.2 思考与提示类（4 种）

**`THINK`**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `content` | `string` | ✔ | 思考正文 |
| `elapsed_secs` | `number \| null` | ✔（可 null） | 思考耗时秒数 |

```json
{ "type": "THINK", "content": "先解释机制，再给一条链接。", "elapsed_secs": 1.5 }
```

**`TIP`** / **`CONTENT_RISK`**（提示条；`style` 只能是 `INFO` / `WARNING` / `CAUTION`）

```json
{ "type": "TIP", "content": "该回答由深度思考模型生成。", "style": "INFO" }
{ "type": "CONTENT_RISK", "content": "部分内容可能涉及敏感话题。", "style": "CAUTION" }
```

**`PARTIAL_FILE_READ`**（长文档只读到一部分；`ratio` 为截断后占原文百分比，`0–100`）

```json
{ "type": "PARTIAL_FILE_READ", "ratio": 42 }
```

### 4.3 工具类（3 种）

**`TOOL_SEARCH`**

| 字段 | 类型 | 必需 |
| --- | --- | --- |
| `queries` | `string[]` | ✔ |
| `results` | `SearchResult[]` | ✔ |
| `status` | `'WIP' \| 'FINISHED' \| 'FAILED'` | 可选（`FINISHED` 允许空结果） |
| `stage_id` / `group_id` | `number` | 可选 |

`SearchResult`：`url:string`、`title:string`、`snippet:string`、`published_at:ISO|null`、`site_name:string|null`、`site_icon?:string|null`。

```json
{
  "type": "TOOL_SEARCH",
  "queries": ["server sent events token streaming"],
  "status": "FINISHED",
  "results": [
    {
      "url": "https://example.com/sse",
      "title": "Server-sent events explained",
      "snippet": "SSE keeps one HTTP response open and pushes text frames.",
      "published_at": "2026-05-01T00:00:00.000Z",
      "site_name": "example.com",
      "site_icon": null
    }
  ]
}
```

**`TOOL_OPEN`**（打开网页）

| 字段 | 类型 | 必需 |
| --- | --- | --- |
| `status` | `'WIP' \| 'FINISHED' \| 'FAILED'` | ✔ |
| `url` | `string \| null` | ✔ |
| `title` | `string \| null` | ✔ |
| `snippet` | `string \| null` | 可选 |
| `site_name` | `string \| null` | 可选 |
| `published_at` | `ISO \| null` | ✔ |
| `stage_id` / `group_id` | `number` | 可选 |

```json
{
  "type": "TOOL_OPEN",
  "status": "FINISHED",
  "url": "https://example.com/sse",
  "title": "Server-sent events explained",
  "snippet": "SSE keeps one HTTP response open.",
  "site_name": "example.com",
  "published_at": "2026-05-01T00:00:00.000Z"
}
```

**`TOOL_FIND`**（页面内查找）

| 字段 | 类型 | 必需 |
| --- | --- | --- |
| `status` | `'WIP' \| 'FINISHED' \| 'NO_RESULT' \| 'FAILED'` | ✔ |
| `pattern` | `string` | 可选 |
| `stage_id` / `group_id` | `number` | 可选 |

```json
{ "type": "TOOL_FIND", "status": "NO_RESULT", "pattern": "text/event-stream" }
```

### 4.4 阅读链接（1 种）

**`READ_LINK`**（`url`/`title` 仅用于展示；`signature` 由服务端解密恢复正文，**导出后重新导入可继续作为上下文**）

| 字段 | 类型 | 必需 |
| --- | --- | --- |
| `results` | `ReadLinkResult[]` | ✔ |
| `results[].signature` | `string` | ✔ |
| `results[].url` | `string` | 可选 |
| `results[].title` | `string \| null` | 可选 |

```json
{
  "type": "READ_LINK",
  "results": [
    {
      "url": "https://example.com/sse",
      "title": "Server-sent events explained",
      "signature": "sig-example-not-a-real-signature"
    }
  ]
}
```

### 4.5 附件（1 种）

**`FILE`**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `files` | `FileEntry[]` | ✔ | |
| `files[].id` | `string` | ✔ | 本地标识，**不带 `file-` 前缀**的 UUID |
| `files[].file_name` | `string` | ✔ | 上传时的文件名 |
| `files[].file_size` | `number` | ✔ | 字节数 |
| `files[].token_usage` | `number \| null` | ✔ | |
| `files[].inserted_at` | ISO | ✔ | |
| `files[].export_path` | `string \| null` | ✔ | ZIP 条目名；**非图片或没有原件时必须是 `null`** |
| `files[].is_image` | `boolean` | ✔ | 身份由它决定，不看 MIME |
| `files[].width` / `height` | `number \| null` | ✔ | 官方始终写 `null` |

```json
{
  "type": "FILE",
  "files": [
    {
      "id": "3d9b8a7c-1e2f-4a5b-8c6d-0e1f2a3b4c5d",
      "file_name": "pic.png",
      "file_size": 70,
      "token_usage": null,
      "inserted_at": "2026-11-16T02:30:01.000Z",
      "export_path": "chat_sessions/9f2c1a4e-6b8d-4f3a-9c21-7d5e0a1b2c3d_files/3d9b8a7c-1e2f-4a5b-8c6d-0e1f2a3b4c5d_pic.png",
      "is_image": true,
      "width": null,
      "height": null
    }
  ]
}
```

> **FILE 只放在 USER 消息上**：官方导入端只读 user 侧 FILE（`toLocal.ts:46-52` 的 `toUser`），assistant 侧 FILE 会被双方静默丢弃。官方导出也是这么摆的（`toArchive.ts:26-45` 的 `userFragments`：先 FILE 再 REQUEST）。

### 4.6 图搜（1 种）

**`TOOL_IMAGE_SEARCH`**

| 字段 | 类型 | 必需 |
| --- | --- | --- |
| `status` | `'WIP' \| 'FINISHED' \| 'FAILED'` | ✔ |
| `results` | `ImageSearchResult[]` | ✔ |
| `image_indexes` | `number[]` | 可选 |
| `stage_id` / `group_id` | `number` | 可选 |

`ImageSearchResult`：`title:string`、`source_page_url:string`、`snippet:string`、`site_name:string|null`、`published_at:ISO|null`。

```json
{
  "type": "TOOL_IMAGE_SEARCH",
  "status": "FINISHED",
  "image_indexes": [0],
  "results": [
    {
      "title": "示例图",
      "source_page_url": "https://example.com/image-page",
      "snippet": "一张示意图",
      "site_name": "example.com",
      "published_at": null
    }
  ]
}
```

### 4.7 一览

| # | type | 一句话 | 我们导出 | 我们导入 |
| --- | --- | --- | --- | --- |
| 1 | `REQUEST` | 用户提问 | ✅ | → `text` |
| 2 | `RESPONSE` | 模型正文 | ✅ | → `text` 块 |
| 3 | `TEMPLATE_RESPONSE` | 服务端模板 | ✅（拒绝/报错） | → `text` 块 `isTemplate:true` |
| 4 | `THINK` | 思考 | ✅ | → `thinking` 块 |
| 5 | `TIP` | 提示条 | —（无来源） | → `text` 块 `isTemplate:true` |
| 6 | `CONTENT_RISK` | 风险提示条 | — | → `text` 块 `isTemplate:true` |
| 7 | `PARTIAL_FILE_READ` | 文档只读了一部分 | — | 丢弃（计数告警） |
| 8 | `TOOL_SEARCH` | 联网搜索 | ✅ | → `tool` + `sources` |
| 9 | `TOOL_OPEN` | 打开页面 | ✅（由 `fetch` 反推） | → `fetch` 项 |
| 10 | `TOOL_FIND` | 页内查找 | — | 丢弃（计数告警） |
| 11 | `READ_LINK` | 阅读链接+签名 | ❌ 无签名（§5.6） | → `fetch` 项，保留签名 |
| 12 | `FILE` | 附件元数据 | ✅ | → `attachments` |
| 13 | `TOOL_IMAGE_SEARCH` | 图搜 | — | → `sources` 块（`kind:'image'`） |

---

## 5. 双向映射表

### 5.1 消息、状态

官方 7 状态 ↔ 我们的 `status` + `stopReason`：

| 官方 `status` | 含义 | 导入 → 我们 | 导出 ← 我们 |
| --- | --- | --- | --- |
| `FINISHED` | 正常结束 | `status:'done'`，`stopReason:'end_turn'` | `status==='done'` 且 `stopReason!=='max_tokens'` 且非 refusal |
| `INCOMPLETE` | 被停止 / 撞输出上限 | `status:'stopped'` | `status==='stopped'`，或 `done && stopReason==='max_tokens'` |
| `CONTENT_FILTER` | 安全拒绝 | `status:'done'` + `stopReason:'refusal'` | `stopReason==='refusal'` |
| `FAILED` | 请求/流出错 | `status:'error'` | `status==='error'` |
| `CONTEXT_LENGTH_EXCEEDED` | 上下文超长 | `status:'error'` | —（我们不产生） |
| `TIMEOUT` | 超时 | `status:'error'` | —（我们不产生） |
| `WIP` | 未完成（导出时未结束） | `status:'stopped'`（等价官方 `settleInterrupted`） | —（导出前先收尾成 stopped） |

官方实现是这张表的两向版本：导出 `replyStatus`（`toArchive.ts:184-198`），导入 `replyStatus` 常量表（`toLocal.ts:208-217`）。**认同一句**：`CONTENT_FILTER` 导入时额外丢掉 thinking 与普通 text，只保留模板提示与工具步骤（`toLocal.ts:232-238`）。

角色：`USER` ↔ `role:'user'`，`ASSISTANT` ↔ `role:'assistant'`；父子必须交替，根必须 USER（`toLocal.ts:252-258`）。

### 5.2 fragment ↔ 我们的 blocks

我们的块（`client.js` `sanitizeBlocks` / `applyStreamEvent`）：`text{text,citations[]}`、`thinking{text,startedAt,endedAt}`、`tool{kind,queries,url}`、`sources{items[{title,url,snippet,site,icon,date}]}`、`fetch{urls[]}`。

**导入（官方 → 我们）**

| fragment | 转成 | 备注 |
| --- | --- | --- |
| `REQUEST` ×N | `user.text` = 各 `content` 依次拼接 | 官方导入用 `fragments.map(REQUEST).join('')`（`toLocal.ts:46-52`） |
| `FILE` | `user.attachments[]`：`{id: files[].id, name: file_name, size: file_size, isImage: is_image, fileId: ''}` | `fileId:''` ⇒ 不进入请求（现有 `attachmentBlocks` 跳过无 fileId 的项） |
| `RESPONSE` | `{type:'text', text: content, citations: []}` | 官方正文已剥掉 `[citation:N]`，引用信息在 `sources`/`TOOL_SEARCH` 里 |
| `TEMPLATE_RESPONSE` | `{type:'text', text: content, isTemplate: true}` | **必须保留标记**，否则会进上下文；`sanitizeBlocks` 要放行该字段 |
| `THINK` | `{type:'thinking', text: content, startedAt, endedAt}` | `startedAt = message.inserted_at`，`endedAt = startedAt + round((elapsed_secs ?? 0) * 1000)`；`elapsed_secs` 为 null 时两者相等（显示 0 秒） |
| `TIP` / `CONTENT_RISK` | `{type:'text', text: content, isTemplate: true, tipStyle: style}` | 没有专门 UI；当模板文本展示最安全（绝不进上下文） |
| `TOOL_SEARCH` | `{type:'tool', kind:'search', queries, url:''}` + `{type:'sources', items: results.map(r => ({title:r.title, url:r.url, snippet:r.snippet, site:r.site_name ?? '', icon:r.site_icon ?? '', date:r.published_at ?? ''}))}` | 官方把搜索与结果分成两种片段；我们拆成"步骤 + 来源"两块，渲染顺序一致 |
| `TOOL_OPEN` | `{type:'fetch', items:[{url, title, site, date, status}], urls:[url]}` | 见 §5.6：建议给 `fetch` 加 `items`，`urls` 保留给现有渲染器 |
| `TOOL_FIND` | 丢弃（计数） | 我们没有页内查找 UI |
| `READ_LINK` | `{type:'fetch', items:[{url, title, signature}], urls:[url]}` | **保留 `signature`**，这是重新成为上下文的关键；当前模型没字段 → §5.6 要求新增 |
| `PARTIAL_FILE_READ` | 丢弃（计数） | 无 UI |
| `TOOL_IMAGE_SEARCH` | `{type:'sources', kind:'image', items:[{title, url: source_page_url, snippet, site, icon:'', date: published_at ?? ''}]}` | 用 `source_page_url` 当 url |

**导出（我们 → 官方）**

| 我们的块（按顺序） | 转成 | 注意 |
| --- | --- | --- |
| `thinking` | `THINK {content: text, elapsed_secs: (endedAt-startedAt)/1000 或 null}` | `endedAt<=startedAt` → `null`；官方的 `elapsed_secs` 只用于展示 |
| `text`（无 `isTemplate`） | `RESPONSE {content: text}` | 相邻 `RESPONSE` 合并成一个（官方也是，`toArchive.ts:134-144`）；文本里如果还有字面 `[citation:N]`，该轮有联网时按官方规则剥掉 |
| `text`（`isTemplate`） | `TEMPLATE_RESPONSE {content: text}` | |
| `tool{kind:'search',queries}` + 紧随的 `sources` | `TOOL_SEARCH {queries, results, status:'FINISHED'}` | `results` 由 `sources.items` 映射：`url/title/snippet/published_at:date || null/site_name:site || null/site_icon:icon || null` |
| 孤立的 `sources`（前面没有 search 工具） | `TOOL_SEARCH {queries: [], results, status:'FINISHED'}` | |
| `fetch` | `TOOL_OPEN {status:'FINISHED', url, title:null, snippet:null, site_name:null, published_at:null}`（每 url 一条） | 无 title/站点信息 |
| `tool{kind:'read_link'}` | `READ_LINK`（仅在存了 `signature` 时） | 没签名就退化成 `TOOL_OPEN` |
| — | `TIP` / `CONTENT_RISK` / `PARTIAL_FILE_READ` / `TOOL_FIND` / `TOOL_IMAGE_SEARCH` 不产出 | 官方接受缺失 |

### 5.3 附件 / 图片

| 方向 | 规则 |
| --- | --- |
| 导入 | `FILE` → `attachments`；`export_path` 指向的图片**不落盘**（我们没有二进制存储），只保留元数据；`fileId:''` 表示"不再上传" |
| 导出 | 每个 attachment → 一个 `FileEntry`：`id` 用本地 id、`file_name` 用 `name`、`file_size` 用 `size`、`token_usage:null`、`inserted_at` 用消息时间、`export_path:null`（**我们没有原件**）、`is_image: isImage`、`width/height:null` |
| 官方侧效果 | 导入我们的 ZIP：附件只显示文件名、不进请求（官方 `types.ts:12-16` 注释明确这是允许的） |
| 我们侧效果 | 导入官方 ZIP：同理，附件 chip 显示文件名；发送时自动跳过（无 `fileId`） |

> 若以后要"图片也双向可见"，把官方图片条目读成 `data:` URL 存进 attachment（建议 `< 256KB` 才存），导出时写进 `_files/`。本期不做，规范里先留位。

### 5.4 thinking / search 开关

- 官方：每条消息带 `thinking_enabled` / `search_enabled`；USER 消息取"首个回答"的配置（`toArchive.ts:233-239`）。
- 我们：没有逐条开关（只有全局设置）。
- 导出：**推导**——`thinking_enabled = blocks 里有 thinking`，`search_enabled = blocks 里有 tool/sources/fetch`。USER 消息用它第一个子回答的推导值。
- 导入：**忽略**（官方值只影响归档元数据，不影响我们的请求）；如将来要做"按轮复现开关"，就在消息上加 `thinkingEnabled/searchEnabled` 字段。

### 5.5 标题 / pinned / 时间

| 项 | 官方 | 我们 |
| --- | --- | --- |
| 空标题 | `null` | 导入 `title ?? ''`（空串在侧栏显示"新对话"）；导出 `title \|\| null` |
| `pinned` | 读时强制 `false` | 写 `false`，导入忽略 |
| 时间 | UTC RFC 3339 `Z`，小数秒不定长 | 导出 `new Date(ms).toISOString()`；导入 `Date.parse(iso)`（非法 → `backupIncomplete`） |

### 5.6 我们需要新增的模型字段（否则双向有损）

| 字段 | 挂在哪 | 为什么必须 |
| --- | --- | --- |
| `isTemplate?: true` | `text` 块 | 区分 `RESPONSE` / `TEMPLATE_RESPONSE`；否则模板文本会进上下文 |
| `tipStyle?: 'INFO'\|'WARNING'\|'CAUTION'` | `text` 块（可选） | 保留 `TIP` / `CONTENT_RISK` 的语义 |
| `items?: [{url,title?,site?,date?,status?,signature?}]` | `fetch` 块 | `TOOL_OPEN` 的 title/站点/日期与 `READ_LINK` 的 **signature** 都只能放这里；`urls` 继续保留做兼容 |
| `kind?: 'search'\|'image'` | `sources` 块 | 区分 `TOOL_SEARCH` 与 `TOOL_IMAGE_SEARCH` |
| `createdAt: number` | 每条消息 | 导出 `inserted_at`；当前消息树模型若没存，导出时只能用 `Date.now()`（会破坏时间线） |

**明确的有损项**（写进 README/UI 提示）：`citations`、`TOOL_FIND`、`PARTIAL_FILE_READ`、图片字节、附件服务端 `fileId`、逐条 thinking/search 开关、`accumulated_token_usage`。

---

## 6. 导入流程、校验顺序与错误文案

### 6.1 顺序（官方实现，我们必须照抄）

```
① 文件头 4 字节 = PK\x03\x04                          → 否则 backupUnrecognized
② ZIP 能解析（EOCD/中央目录/本地头/CRC/大小）           → ArchiveError → backupIncomplete
③ 第一个条目必须是 manifest.json                        → 否则 backupUnrecognized
④ manifest 能 JSON.parse                              → 否则 backupInvalidJson
⑤ version === 3；>3 过新；其它无效                      → backupNewerVersion / backupInvalidVersion
⑥ 逐条目导入：manifest → user.json(跳过) → 会话 JSON → index → 图片
     · 会话 JSON 的 id 必须等于路径里的 id、不能重复       → backupIncomplete
     · 字段/tree 校验：schema                          → backupIncomplete
     · 父缺失/成环/角色不交替/根非 USER/current 不存在   → backupInvalidBranches
     · 图片 export_path 不在本会话目录 / 一条路径两个 id → backupInvalidFiles
     · 未知条目 / 索引前后顺序不对                       → backupIncomplete
⑦ 收尾：index 必须存在，且 index 的 id 集合 === 已导入会话集合（无重复） → backupIncomplete
```

出处：`src/services/chat/backup.ts:42-51`（两段式：先 `checkArchiveFormat`，再 `replaceHistory(() => importArchive(file))`）、`importArchive.ts:53-73`（①-⑤）、`importArchive.ts:75-159`（⑥-⑦）、`schema.ts`（各字段）。

**空包**：只有 `manifest.json` 的 ZIP → ⑥ 走完没有会话，⑦ `!index` → `backupIncomplete`（不是"无法识别"）。

**官方读取端的两个"顺序陷阱"**（我们导出必须避开）：
1. `index` 一旦读到，后面再出现会话 JSON 就直接 `backupIncomplete`（分支条件 `sessionId !== null && !index`，`importArchive.ts:117`）→ **index 必须是最后一个 JSON**。
2. `user.json` 只允许出现在"还没读会话、还没读 index"时（`importArchive.ts:114`）→ 我们要么不写，要么放 manifest 之后。

### 6.2 七条错误文案（逐字，`src/i18n/zh.ts:80-86`）

| key | 中文（逐字） | 触发条件 |
| --- | --- | --- |
| `backupInvalidJson` | `文件不是有效的 JSON` | manifest 或会话 JSON 解析失败 |
| `backupUnrecognized` | `无法识别该文件，请选择 DeepSeek 导出的历史对话 ZIP 文件` | 不是 ZIP / 首条不是 manifest / 一条条目都没有 |
| `backupNewerVersion` | `文件版本过新，请升级后再导入` | `export_format_version > 3` |
| `backupInvalidVersion` | `文件版本无效，无法导入` | `export_format_version !== 3`（含缺失、非数字） |
| `backupIncomplete` | `文件内容不完整，无法导入` | ZIP 结构坏、字段不合法、未知条目、index 缺失或与会话不一致、会话 id 与路径不符/重复 |
| `backupInvalidBranches` | `文件中的消息分支已损坏，无法导入` | 父 id 缺失/不小于 id、成环、角色不交替、根不是 USER、`current_message_id` 不存在 |
| `backupInvalidFiles` | `文件中的附件数据已损坏，无法导入` | `export_path` 不在本会话目录、同一路径对应不同 file id |

**UI 呈现建议**：demo 把所有失败都收成一条大文案 `historyImportFailed`（`zh.ts:115-116`：`文件导入失败，可能是文件格式错误或使用了旧版的对话导出 ZIP 文件，请前往 DeepSeek 重新导出历史对话文件后再次导入。`，见 `SettingsDialog.tsx:457-458`）。
我们**建议**：主提示用上表的具体原因（用户能自救），无法归类的异常才落到 `historyImportFailed`。这是对官方文案的有意改进，需要 lead 拍板；若要 100% 对齐，就只显示 `historyImportFailed`，把具体原因塞进 `console.warn`。

### 6.3 导入成功文案

| key | 中文（逐字） | 出处 |
| --- | --- | --- |
| `historyImportedOne` | `已导入 1 个对话` | `zh.ts:113` |
| `historyImported` | `已导入 {count} 个对话` | `zh.ts:114` |

---

## 7. 降级策略（我们的实现要比官方更宽容一点）

| 场景 | 官方行为 | 我们怎么做 |
| --- | --- | --- |
| 图片条目缺失 / `export_path: null` | 只保留文件名，不进请求 | 同官方；附件 chip 标灰 + 悬停提示"原始文件不在备份中，需重新上传" |
| 整包没有任何会话（`messages` 全空） | 空会话允许（`current_message_id: 0`） | 导入为一个空对话，标题用 `title ?? '新对话'` |
| 未知 fragment 类型 | 单片段丢弃，整包继续（`schema.ts:188-198`） | 同官方 + 计数，导入完成后 `console.warn`；**但我们的 schema 校验器对自家导出仍报错**（防止我们写出脏数据） |
| `TOOL_FIND` / `PARTIAL_FILE_READ` / `TIP` / `CONTENT_RISK` | 正常展示 | TIP/CONTENT_RISK 转模板文本；另外两种丢弃并计数 |
| 缺 `signature` 的 `READ_LINK` | 展示 URL/标题，不进上下文 | 转 `fetch` 项且不标 signature（不参与上下文，安全） |
| `FILE.id` 重复但 `export_path` 不同 | 官方按"同一路径不能对应不同 id"判 `backupInvalidFiles`；反向不校验 | 同官方（严格） |
| 会话 id 含 `/` `\` | `backupIncomplete` | 我们**导出前**就把它 path-safe 化（`/ \` → `_`，`.`/`..` → `unnamed`），别等官方拒 |
| 条目超过 `0xffff` / 文件超过 4GB | 官方导出直接 `ArchiveLimitError` | 我们导出前检查，超限提示"对话太多，请分批导出" |
| deflate / data descriptor | 官方导入接受 | `zipRead` 必须接受（§1.2） |
| 浏览器不支持 `DecompressionStream` | —（官方用 fflate） | `zipRead` 抛 `ZIP_UNSUPPORTED_DEFLATE` → UI 文案"当前浏览器不支持解压该备份，请更换浏览器或导入未压缩的备份" |

---

## 8. 导出算法（我们 → 官方 ZIP）

```js
// 1) 会话 → SessionFile
for (const conversation of sortConversations(conversations)) {
  const path = visiblePath(conversation);                 // 当前可见链（root → selectedChildId…）
  const { ordered, ids } = numberMessages(conversation.messages);  // §3.2 父优先 DFS
  const sessionFile = {
    id: pathSafe(conversation.id),
    title: conversation.title || null,
    pinned: false,
    current_message_id: path.length ? ids.get(path[path.length - 1].id) : 0,
    inserted_at: iso(conversation.createdAt),
    updated_at: iso(conversation.updatedAt),
    messages: ordered.map((node) => toOfficialMessage(node, ids)),
  };
}
// 2) 索引
const index = sessions.map(({ id, title, messages, inserted_at, updated_at }) => ({
  id, title, pinned: false, message_count: messages.length, inserted_at, updated_at,
}));
// 3) 条目顺序：manifest → 全部会话 → index（→ 图片，本期无）
const entries = [
  { name: 'manifest.json', bytes: jsonBytes({ export_format_version: 3 }) },
  ...sessions.map((s) => ({ name: `chat_sessions/${s.id}.json`, bytes: jsonBytes(s) })),
  { name: 'chat_session_index.json', bytes: jsonBytes(index) },
];
const blob = zipWrite(entries);          // STORE + CRC + mtime 1980-01-01
```

- `toOfficialMessage(node, ids)` = 角色/status/fragments/时间/flags 按 §5 映射，`parent_id = node.parentId ? ids.get(node.parentId) : null`。
- **导出前收尾**：把 `status:'streaming' | 'pending'` 的节点按 `stopped` 写（官方 `settleInterrupted` 同义，`store.ts:272-289`）。
- **拒绝/报错补充模板**：`CONTENT_FILTER` / `FAILED` 至少写一条 `TEMPLATE_RESPONSE`（我们本地化的提示或错误原文），否则官方侧这轮没有任何可见内容（官方导出也是这么补的，`toArchive.ts:168-180`）。
- 文件名：沿用 demo 的 `deepseek_data-YYYY-MM-DD.zip`（`backup.ts:17`）或 `dsh-chat-data-YYYY-MM-DD-HHmm.zip`（推荐带时分，避免同日覆盖）；由 lead 定。

---

## 9. 落地清单

| 件 | 位置 | 说明 |
| --- | --- | --- |
| ZIP 读写 | `docs/specs/14-zip-codec.js` | `zipWrite` / `zipWriteBytes` / `zipRead` / `crc32` / `zipSelfTest` / `ZipError`（`code` 见 `ZIP_CODES`）；粘贴进 `client.js` utils 段 |
| 官方格式造包 | `scripts/e2e/fixtures/make-official-backup.cjs` | 默认写 3 个 fixture；它先跑 `zipSelfTest()` 再写，写完自己用 `zipRead` 读回来 |
| 官方格式校验 | `scripts/e2e/fixtures/validate-official-backup.cjs` | 独立解析 ZIP（zlib + 自写 CRC，不与 codec 共用），按官方 schema 校验；`exit 0/1` |
| 导出/导入实现 | `client.js` | 新增 `buildOfficialArchive()` / `importOfficialArchive(arrayBuffer)` / `numberMessages()` / `visiblePath()` / `toOfficialMessage()` / `toLocalNode()`；替换旧的自研 JSON 备份 |
| 校验器共用 | `client.js` | 导入端做与 validator 同样的结构校验（消息 id 类型、parent、角色、current、index 集合），失败抛 `BackupError{code}` 映射 §6.2 文案 |
| 文案 | `client.js` 的 `en`/`zh` 词表 | 7 条 `backup*` + `historyImportedOne/historyImported` + `historyImportFailed`，中文逐字见 §6.2 |

**fixture 用法**

```bash
node scripts/e2e/fixtures/make-official-backup.cjs
#   → scripts/e2e/fixtures/fixtures/official-backup.zip          STORE，4 条目，含 1 张 PNG
#   → scripts/e2e/fixtures/fixtures/official-backup-fragments.zip 13 种片段全 + 1 个分支
#   → scripts/e2e/fixtures/fixtures/official-backup-deflate.zip   deflate + data descriptor（测读取端）

node scripts/e2e/fixtures/validate-official-backup.cjs fixtures/official-backup.zip
#   → OK  …· zip entries=4 · sessions=1 · messages=2 · fragments=5 · images=1   （exit 0）
```

已完成的自检：三个 fixture 均 `exit 0`；`official-backup.zip` 另经 Python `zipfile` 交叉验证（`testzip()` = None，全部 `compress_type=0`，`date_time=(1980,1,1,0,0,0)`）。

> e2e 检查建议：① 导入 `official-backup.zip` 应得到 1 个对话、2 条消息、1 个附件、来源 1 条；② 导入 `-fragments.zip` 后切分支应看到两个回答版本；③ 导出后用 `validate-official-backup.cjs` 校验必须 `OK`；④ 导入 `-deflate.zip` 也必须成功（覆盖 decompress 路径）。

---

## 10. 验收清单

1. `node scripts/e2e/fixtures/make-official-backup.cjs` 生成 3 个 zip，自测 `codec self test: ok`。
2. `validate-official-backup.cjs fixtures/official-backup.zip` → `OK`，exit 0。
3. 插件导入 `official-backup.zip`：得到 1 个对话 / 2 条消息 / 1 个附件（文件名可见）/ 1 条来源 / 思考 1.5 秒。
4. 导入 `official-backup-fragments.zip`：13 种片段全部不报错；`‹1/2›` 能切到第二个回答（兄弟分支）。
5. 导入 `official-backup-deflate.zip`：同样成功（deflate + descriptor 路径）。
6. 篡改 fixture 再导入，必须给出对应文案：
   - 改成 txt → `无法识别该文件，请选择 DeepSeek 导出的历史对话 ZIP 文件`
   - `export_format_version` 改 4 → `文件版本过新，请升级后再导入`
   - 改 2 → `文件版本无效，无法导入`
   - manifest 改成 `{` → `文件不是有效的 JSON`
   - 删掉 `chat_session_index.json` → `文件内容不完整，无法导入`
   - 把某条 `parent_id` 改成 99 → `文件中的消息分支已损坏，无法导入`
   - 把 `FILE.export_path` 改成别的会话目录 → `文件中的附件数据已损坏，无法导入`
7. 我们导出 → `validate-official-backup.cjs` → `OK`；导出的 ZIP 再用插件自己导入一次，消息条数/分支/标题一致（往返测试）。

---

## 11. 最容易错的地方

1. **index 顺序**：把它写在会话 JSON 之前 → 官方 `backupIncomplete`。必须是 manifest → 会话 → index。
2. **消息 id 不重编号**：直接用我们的字符串 id 或"数组下标"→ 官方要求非负整数且 `parent_id < id`、父优先连续 `1..n`。必须跑 §3.2 的 DFS。
3. **`current_message_id` 写错**：写"最后一条消息"而不是"可见路径的末端" → 导入后分支展开错、当前答案不对。空会话写 `0`。
4. **角色不交替**：编辑/重生成若造出"两个 USER 相邻"或"根是 ASSISTANT"，官方直接判 `backupInvalidBranches`。
5. **`FILE` 放错位置**：放在 assistant 消息上会被双方丢掉；必须在 USER 消息里，且同一条 USER 的 `fragments` 顺序是 **FILE 在前、REQUEST 在后**（官方 `userFragments` 的顺序）。
6. **`export_path` 写 `null` 但仍放在别的会话目录**：目录必须严格 `chat_sessions/{本会话 id}_files/`，否则 `backupInvalidFiles`。
7. **文件名编码**：中文附件名必须带 UTF-8 flag（`zipWrite` 已固定 `0x0800`）；忘带时官方 `decodePath` 直接判非法（`zipReader.ts:61-75`）。
8. **time 格式**：用 `Date.now()` 数字或 `2026-11-16 10:00` 都会被拒；必须 `toISOString()`。
9. **`TEMPLATE_RESPONSE` 被当成普通正文**：导入后进上下文 → 模型把"回答已中断"当历史回答。必须带 `isTemplate`。
10. **READ_LINK 签名丢失**：我们把 `web_fetch_tool_result` 折成 `fetch{urls}` 时就把 `signature` 扔了；不补 `items[].signature`，导出永远写不出合法的 `READ_LINK`（`signature` 是必填 string）。
11. **ZIP 读取端只判 STORE**：真实官方导出可能带 deflate + data descriptor，只判 STORE 会导致"官方导出的包我们打不开"。
12. **导出前没流式收尾**：`streaming` 状态直接写进 ZIP → `WIP`，官方导入把它当 `INCOMPLETE`（可接受）但消息内容可能不完整；导出前应先把进行中的回答 abort 成 `stopped`。
