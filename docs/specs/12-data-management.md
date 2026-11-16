# 12 · 数据管理（导出 / 导入 / 删除全部对话）

> 规格对象：`client.js` 设置对话框新增「数据管理」分组
> 参照实现：原版 demo `deepseek-ai/chat-demo@5d5dd75`（`src/services/chat/history/*`、`src/services/chat/backup.ts`、`src/components/settings/SettingsDialog.tsx`）
> 约定：demo 用 `src/...:行号`；`client.js` 只标函数/组件名，行号写 `≈`。
> 本文只写规格，不实施。

---

## 0. 结论摘要

1. demo 的导出产物是 **`deepseek_data-YYYY-MM-DD.zip`**（ZIP **不压缩**、STORE 方式），里面是「`manifest.json` → 每会话 `chat_sessions/{id}.json` → `chat_session_index.json` → 图片 `chat_sessions/{id}_files/...`」，**不含 API Key、不含账号信息、不含非图片附件本体**。
2. 导入是**覆盖**，不是合并：先只读 ZIP 头做格式校验（**单条流式，不落盘**），通过后进入 `replaceHistory` 事务，全部成功才替换，失败保留原数据。
3. 校验分层非常清楚：**文件级**（不是 ZIP / 首条不是 manifest / JSON 坏 / 版本不对）→ **结构级**（字段严格校验、分支树、附件引用）→ **一致性**（index 与会话集合一一对应）。每条错误都有独立中文文案。
4. **我们的替代方案不用 ZIP**：无构建、无第三方库，且 localStorage 里只有 `conversations` + `settings`、附件只有 `fileId` 元数据（原件在服务端）。改为**单个 JSON**，`format` + `version` 字段做版本门禁，校验顺序照搬 demo，覆盖语义照搬 demo。
5. 删除全部对话：设置行 label `删除所有对话` + 危险按钮 `删除`；确认弹窗标题/描述逐字见 §4；实现是"用空历史做一次替换"，**保留 API Key 与其它设置**。

---

## 1. demo：导出（事实）

### 1.1 入口与 UI

| 事实 | 出处 |
| --- | --- |
| 在设置弹窗「数据管理」分组，是 `ExportHistory` 这个 `SettingCell` | `src/components/settings/SettingsDialog.tsx:104-111, 515-558` |
| 标题 `t('exportAllLabel')` = `导出所有历史对话` | `SettingsDialog.tsx:542`；`src/i18n/zh.ts:118` |
| 描述 `t('historyExportDescription')` = `包含所有历史对话及本地图片原件；其他附件仅保留文件信息，不包含 API Key。` | `SettingsDialog.tsx:543`；`src/i18n/zh.ts:119-120` |
| 按钮 `t('exportAllDownload')` = `下载` | `SettingsDialog.tsx:554`；`src/i18n/zh.ts:121` |
| 无对话时禁用：`disabled={disabled \|\| busy \|\| empty}`，`empty = sessions.length === 0` | `SettingsDialog.tsx:518, 550` |
| 下载方式：`URL.createObjectURL(blob)` → 造 `<a download=name>` → `click()` → 10s 后 `revokeObjectURL` | `SettingsDialog.tsx:526-532` |
| 失败：`errorStatus('historyExportFailed', error)`，`BackupError` 用其 `key` 的文案当 `{message}`，其它错误用 `error.message` | `SettingsDialog.tsx:399-406, 534`；`src/i18n/zh.ts:117` |

### 1.2 文件名

```ts
// src/services/chat/backup.ts:17
const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`
```

`formatDate`（`src/utils/format.ts:8-17`）输出 `YYYY-MM-DD`（本地时区）→ 例：`deepseek_data-2026-11-16.zip`。

### 1.3 产物结构（ZIP 条目顺序固定）

```ts
// src/services/chat/history/paths.ts:1-10
/** ZIP 条目名。条目顺序固定：manifest → user（可能缺失）→ 全部会话 JSON → index → 全部图片。 */
export const MANIFEST_PATH = 'manifest.json'
export const USER_PATH = 'user.json'
export const INDEX_PATH = 'chat_session_index.json'
export const sessionPath = (sessionId) => `chat_sessions/${sessionId}.json`
export const sessionFilesDir = (sessionId) => `chat_sessions/${sessionId}_files/`
export const imagePath = (sessionId, fileId, fileName) =>
  `${sessionFilesDir(sessionId)}${safeName(fileId)}_${safeName(fileName)}`.normalize('NFC')
```

| 条目 | 内容 | 出处 |
| --- | --- | --- |
| `manifest.json` | `{"export_format_version": 3}`，**必须是第一个条目** | `src/services/chat/history/format.ts:12-15`；`exportArchive.ts:17-18` |
| `user.json` | 账号信息（已脱敏）。**导出端不写**，导入端"可能缺失" | `exportArchive.ts:11`；`paths.ts:4` |
| `chat_sessions/{id}.json` | 单个会话（字段见 §1.4） | `format.ts:27-38` |
| `chat_session_index.json` | 会话摘要数组，**在所有会话之后、图片之前** | `format.ts:17-25`；`exportArchive.ts:46-48` |
| `chat_sessions/{id}_files/{file_id}_{文件名}` | 图片原件；**每个会话目录各写一份**，非图片不写 | `exportArchive.ts:32-45`；`format.ts:165-173` |

导出装配（`exportArchive.ts:10-49`）：

```ts
/** 没有账号信息，不写 user.json。只写出本地有原件的图片，每个会话目录各写一份；其他附件只有元数据。 */
const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
const entries = [{ name: MANIFEST_PATH, blob: json(manifest) }]
for await (const session of sessions) { … entries.push(sessionJson); images → imageEntries; index.push(...) }
entries.push({ name: INDEX_PATH, blob: json(index) })
return writeArchive(entries.concat(imageEntries))
```

ZIP 写法（`src/services/chat/history/zipWriter.ts`）：

- 只用 **STORE（不压缩）**：`new ZipPassThrough(name)`（`zipWriter.ts:83`），mtime 固定 `new Date(1980, 0, 1)`（`zipWriter.ts:84`）；
- 不支持 ZIP64：条目数 ≥ 0xffff 或单条目 ≥ 0xffffffff 抛 `ArchiveLimitError`（`zipWriter.ts:4-12, 42-64`）；
- 条目名校验与读取端一致（NFC、禁止 `\`、`..`、盘符），保证"成品必须能再次导入"（`zipWriter.ts:18-39`）。

### 1.4 会话 JSON 与消息字段（完整）

```ts
// src/services/chat/history/format.ts:27-65
/** chat_sessions/{session_id}.json */
export type SessionFile = {
  id: string
  title: string | null            // 空标题导出为 null
  pinned: boolean                 // 恒 false
  current_message_id: number       // 用户当前停留的消息，线性化消息树的唯一依据
  inserted_at: Iso8601Utc
  updated_at: Iso8601Utc
  messages: ChatMessage[]          // 消息树，分支靠 parent_id
}
export type ChatMessage = {
  id: number                       // 会话内自增，父节点优先编号，保证 parent_id < id
  parent_id: number | null         // null 表示该会话的第一条
  role: 'USER' | 'ASSISTANT'
  status: 'WIP' | 'FINISHED' | 'CONTENT_FILTER' | 'FAILED' | 'INCOMPLETE' | 'CONTEXT_LENGTH_EXCEEDED' | 'TIMEOUT'
  thinking_enabled: boolean
  search_enabled: boolean
  accumulated_token_usage: number
  inserted_at: Iso8601Utc
  fragments: Fragment[]            // 按发生顺序排列
}
```

- 编号：`numberMessages`（`toArchive.ts:209-227`）按父节点优先深度优先重排为 `1…n`，父缺失或成环 → `fail('backupInvalidBranches')`。
- 状态映射：`replyStatus`（`toArchive.ts:184-198`）——`refusal→CONTENT_FILTER`；`done && max_tokens→INCOMPLETE`；`stopped→INCOMPLETE`；`error→FAILED`；其余 `WIP`。用户消息固定 `FINISHED`（`toArchive.ts:249`）。
- `fragments` 的 13 种类型见 `format.ts:67-208`：`REQUEST` / `RESPONSE` / `TEMPLATE_RESPONSE` / `THINK` / `TIP` / `CONTENT_RISK` / `PARTIAL_FILE_READ` / `TOOL_SEARCH` / `TOOL_OPEN` / `TOOL_FIND` / `READ_LINK` / `FILE` / `TOOL_IMAGE_SEARCH`。
- 附件：`FileEntry`（`format.ts:157-170`）`{id, file_name, file_size, token_usage, inserted_at, export_path, is_image, width, height}`；**非图片附件只有元数据，本体不在产物里**（`format.ts:172-173`）。
- 时间：全部 UTC RFC 3339、`Z` 结尾、小数秒精度不固定（`format.ts:1-10`；校验正则 `schema.ts:37-51`）。

### 1.5 导出**包含**什么 / **不包含**什么

| 包含 | 不包含 |
| --- | --- |
| 全部会话（含分支树、`current_message_id`） | **API Key**（描述文案明说：`不包含 API Key`，`zh.ts:119-120`） |
| 每个回答的所有内容片段（思考、正文、服务端模板提示、工具步骤） | 账号信息（导出端不写 `user.json`，`exportArchive.ts:11`） |
| `thinking_enabled` / `search_enabled` / token 用量 / 时间戳 | 非图片附件本体（只有 `FileEntry` 元数据） |
| 本地有原件的图片（按会话目录各一份） | 本地没有原件的图片（`export_path: null`） |
| `READ_LINK` 的服务端签名（可在重新导入后恢复上下文） | 草稿（demo 把草稿存别处，`deleteAllSessionsModalDescription` 提到"未发送的草稿"会被删） |

### 1.6 导出的并发/一致性

- 导入、导出、全部删除**串行**：`enqueueBackup`（`backup.ts:8-15`），避免"导出过程中数据被清空"。
- 会话列表在导出开始时**取快照**；未打开的会话逐条读库，不填满详情缓存；读的过程中被重命名 → 归档标题仍用开始时列表里的标题（`backup.ts:20-35`，`{...session, ...summary}`）。
- 会话在导出中途消失 → 抛错（`backup.ts:29-31`）。

---

## 2. demo：导入（事实）

### 2.1 入口、二次确认、上传控件

| 事实 | 出处 |
| --- | --- |
| `ImportHistory` 行：标题 `t('historyImport')` = `导入历史对话` | `SettingsDialog.tsx:481`；`zh.ts:108` |
| 描述 `t('historyImportDescription')` = `导入历史对话会覆盖全部本地对话和附件，支持 DeepSeek 导出的 ZIP 文件。` | `SettingsDialog.tsx:482`；`zh.ts:112` |
| 按钮 `t('upload')` = `上传`，点它触发隐藏 `<input type="file">` | `SettingsDialog.tsx:486-495`；`zh.ts:128` |
| `accept=".zip,application/zip,application/x-zip-compressed"` | `SettingsDialog.tsx:499` |
| 选完文件**不立刻校验**，只 `select(file)` → 弹二次确认 | `SettingsDialog.tsx:501-507, 129` |
| 二次确认弹窗：标题 `确认导入历史对话？`，正文 `上传的历史对话会覆盖当前所有对话记录，是否确认导入？`，按钮 `取消` / `确认导入` | `SettingsDialog.tsx:318-343`；`zh.ts:109-111` |
| 点确认后先 `setFile(null)` 再 `busy`，**全部异常统一**显示 `t('historyImportFailed')` | `SettingsDialog.tsx:446-463`；`zh.ts:115-116` |

### 2.2 第一段校验：只读 ZIP 头（不落盘）

```ts
// src/services/chat/backup.ts:42-51
/** 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 *  通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。 */
export const importHistory = (file: File): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    return replaceHistory(() => importArchive(file))
  })
```

`checkArchiveFormat`（`importArchive.ts:53-73`）的**严格顺序**：

| # | 检查 | 失败文案 |
| --- | --- | --- |
| 1 | 前 4 字节必须是 `PK\x03\x04`（`zipReader.ts:19-23` `isZipFile`） | `backupUnrecognized` = `无法识别该文件，请选择 DeepSeek 导出的历史对话 ZIP 文件`（`zh.ts:81`） |
| 2 | **第一个条目**路径必须是 `manifest.json`（`importArchive.ts:62-66`） | 同上 `backupUnrecognized` |
| 3 | 该条目能读成 JSON（`importArchive.ts:44-51`） | `backupInvalidJson` = `文件不是有效的 JSON`（`zh.ts:80`） |
| 4 | `checkManifest`：`export_format_version` **> 3** → 版本过新；**≠ 3** → 版本无效（`schema.ts:229-238`） | `backupNewerVersion` = `文件版本过新，请升级后再导入`（`zh.ts:82`）／`backupInvalidVersion` = `文件版本无效，无法导入`（`zh.ts:83`） |
| 5 | ZIP 结构本身不合法（`ArchiveError`） | `backupIncomplete` = `文件内容不完整，无法导入`（`zh.ts:84`，转换见 `importArchive.ts:69-71`） |
| 6 | 一条条目都没有 | `backupUnrecognized`（`importArchive.ts:72`） |

ZIP 读取端拒绝的东西（都在 `zipReader.ts`，一律 → `ArchiveError` → `backupIncomplete`）：ZIP64 字段、分卷、加密（`zipReader.ts:46-59, 106-119`）、非 UTF-8 文件名且含非 ASCII（`zipReader.ts:61-75`）、路径穿越/盘符/`..`（`zipReader.ts:66-74`）、目录与同名文件冲突（`zipReader.ts:155-160`）、仅支持 `store`/`deflate`（`zipReader.ts:139-152`）、CRC/大小不符（`zipReader.ts:289-291`）。

### 2.3 第二段：`replaceHistory` 事务内的流式导入

```ts
// src/services/chat/store.ts:388-441（要点）
export const replaceHistory = async (write) => {
  if (get().importingHistory) throw new Error('History replacement is already in progress')
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) controller.abort()   // 停止生成
    await Promise.all(deletionTasks)
    historyEpoch += 1; initTask = undefined; sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()                    // 清暂存
    try {
      await write()                            // 写入暂存（= importArchive）
      summaries = await db.commitStaging()     // 原子替换
    } catch (error) {
      await db.clearStaging().catch(...)       // 失败清暂存
      throw error                              // 原数据保持不变
    }
    … clearAllDrafts(); set({ ready:true, sessions: sortSessions(summaries), sessionCache:{}, activeId: null })
    return summaries.length
  } finally { set({ importingHistory: false }); … }
}
```

`importArchive`（`importArchive.ts:75-159`）逐条目判定（顺序即代码顺序）：

| 位置 | 规则 | 失败 |
| --- | --- | --- |
| 首条 | 必须 `manifest.json` + 版本检查 | `backupUnrecognized` |
| `user.json` | 只在"还没读会话、还没读 index"时允许，**跳过不导入** | 其它位置出现 → `backupIncomplete` |
| `chat_sessions/{id}.json` | `readSessionFile` 严格校验；`local.session.id` 必须等于路径里的 id；同一 id 不能出现两次 | 结构 → `backupIncomplete`；路径/重复 → `backupIncomplete` |
| 同上 → `toLocalSession` | 分支树：父 id 更小、角色交替、根必须是 USER、`current_message_id` 必须存在 | `backupInvalidBranches` = `文件中的消息分支已损坏，无法导入`（`zh.ts:85`；`toLocal.ts:246-279`） |
| 同上 → 图片引用 | `export_path` 必须在本会话目录下，同一条目不能对应不同 file id | `backupInvalidFiles` = `文件中的附件数据已损坏，无法导入`（`zh.ts:86`；`toLocal.ts:291-316`） |
| `chat_session_index.json` | 只允许一次，读后按 `readSessionIndex` 校验 | `backupIncomplete` |
| 图片条目 | 被引用的保存（同名只存一次），**没被引用的直接跳过**；引用了但缺失的只保留文件名 | CRC/结构 → `backupIncomplete` |
| 其它任意条目 | — | `backupIncomplete`（`importArchive.ts:138-140`） |
| 收尾 | `index` 必须存在，且 `index` 的 id 集合与已导入会话集合**完全一致**（无重复） | `backupIncomplete`（`importArchive.ts:145-157`） |

> 注意"宽松/严格"的分层：**单个内容片段不认识 → 丢弃，不影响整包**（`schema.ts:188-198`）；**容器/元数据/消息树不认识 → 整包失败**。

### 2.4 覆盖语义与结果反馈

- 覆盖 = **整体替换**：旧会话、旧附件原件、草稿全部清空（`clearAllDrafts()`，`store.ts:419`），`activeId` 归 `null` → 回到欢迎页（`store.ts:420-428`）。
- 失败 = **回滚**：`replaceHistory` 的 catch 清暂存后 rethrow，旧记录继续可用；`finally` 里恢复详情加载（`store.ts:430-440`）。
- 成功数：`historyImportedOne` = `已导入 1 个对话` / `historyImported` = `已导入 {count} 个对话`（`zh.ts:113-114`；`SettingsDialog.tsx:456`）。
- 失败提示**只有一条**（具体原因被吞掉）：`historyImportFailed` = `文件导入失败，可能是文件格式错误或使用了旧版的对话导出 ZIP 文件，请前往 DeepSeek 重新导出历史对话文件后再次导入。`（`zh.ts:115-116`）。
- 期间锁定交互：`importingHistory` 参与 `historyBusy`，导入/导出/删除按钮全禁用（`SettingsDialog.tsx:66-67, 107-108, 117`）。

---

## 3. demo：删除全部对话（事实）

| 事实 | 出处 |
| --- | --- |
| 设置行标题 `t('deleteAllSessions')` = `删除所有对话`，右侧危险按钮 `t('delete')` = `删除` | `SettingsDialog.tsx:109-123`；`zh.ts:122, 18` |
| 确认弹窗**标题** `t('deleteAllSessionsModalTitle')` = `删除后，所有对话都将被清空且无法找回` | `SettingsDialog.tsx:144`；`zh.ts:123` |
| 确认弹窗**正文** `t('deleteAllSessionsModalDescription')` = `本地保存的附件及未发送的草稿也将被删除。` | `SettingsDialog.tsx:167`；`zh.ts:124` |
| 取消按钮 `t('cancel')` = `取消`，`autoFocus`；确认按钮忙时变 `t('historyDeleting')` = `删除中...`，否则 `删除所有对话` | `SettingsDialog.tsx:149-163`；`zh.ts:125` |
| 成功 toast `t('historyDeleted')` = `删除成功`；失败 toast `t('historyDeleteFailed')` = `删除失败，请重试` | `SettingsDialog.tsx:186-188`；`zh.ts:126-127` |
| 删除中再次点击被 `deleting` ref 挡住；删除中不允许关闭设置弹窗 | `SettingsDialog.tsx:177-193, 75-79` |
| 实现 = 用空历史走同一次替换事务：`clearHistory = replaceHistory(async () => {})` | `backup.ts:53-57` |
| **保留 API Key 和其它设置** | `backup.ts:53` 注释：`以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。` |

---

## 4. 我们的替代方案：自家 JSON 备份

### 4.1 为什么不用 demo 的 ZIP 格式

| 原因 | 说明 |
| --- | --- |
| 没有构建、没有依赖 | demo 的 ZIP 读写是自写 300 行（`zipReader.ts` 316 行 + `zipWriter.ts` 117 行）+ `fflate`；无构建单文件塞不下也不该塞 |
| 数据模型不同 | 我们是 localStorage 的 `conversations` 数组 + `settings`，没有 IndexedDB 附件原件；附件只有 `{id,name,size,isImage,fileId}`（`fileId` 是服务端 id，换账号/过期即失效） |
| 体积 | JSON 足够；gzip 可由 `CompressionStream` 后期再加，不是本期 |
| 兼容性承诺 | 明确不支持 demo 的 `deepseek_data-*.zip`，导入 ZIP 时走"无法识别"文案 |

### 4.2 文件格式 v1

- 文件名：`dsh-chat-backup-YYYY-MM-DD-HHmm.json`（本地时区、带时分，避免同一天多次导出互相覆盖）
- MIME：`application/json`，缩进 2 空格（可读、便于用户自查；体积可接受）

```json
{
  "format": "dsh.deepseekChat.backup",
  "version": 1,
  "exportedAt": "2026-11-16T02:33:23.270Z",
  "app": "dsh-deepseek-chat",
  "counts": { "conversations": 3, "messages": 41 },
  "settings": {
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-flash",
    "thinking": "high",
    "webSearch": true,
    "voice": "stella"
  },
  "conversations": [
    {
      "id": "m3k9x1a2b",
      "title": "SSE 是怎么推 token 的",
      "createdAt": 1763250000000,
      "updatedAt": 1763250300000,
      "messages": [
        {
          "id": "m3k9x1c4d",
          "role": "user",
          "text": "用三句话解释 SSE",
          "attachments": [
            { "id": "a1", "name": "note.md", "size": 812, "isImage": false, "fileId": "file-api-xxxx" }
          ]
        },
        {
          "id": "m3k9x1e5f",
          "role": "assistant",
          "versions": [
            {
              "blocks": [
                { "type": "thinking", "text": "…", "startedAt": 1763250001000, "endedAt": 1763250004000 },
                {
                  "type": "text",
                  "text": "SSE 是一种……",
                  "citations": [{ "url": "https://example.com/a", "title": "A" }]
                },
                { "type": "tool", "kind": "search", "queries": ["sse"], "url": "" },
                { "type": "sources", "items": [{ "title": "A", "url": "https://example.com/a", "snippet": "", "site": "example.com", "icon": "", "date": "" }] }
              ],
              "status": "done",
              "stopReason": "end_turn",
              "error": ""
            }
          ],
          "versionIndex": 0,
          "blocks": [],
          "status": "done",
          "stopReason": "end_turn",
          "error": ""
        }
      ]
    }
  ]
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `format` | 常量 `"dsh.deepseekChat.backup"`，**不匹配即拒绝**；用来区分"别人的 JSON" |
| `version` | 正整数，本期 `1`。`> 1` → 版本过新；缺失/`<1`/非整数 → 版本无效 |
| `exportedAt` | ISO 8601 UTC；仅展示用，导入不依赖 |
| `app` / `counts` | 提示性字段，导入时**忽略**（`counts` 只用于自检与提示） |
| `settings` | **白名单 5 个字段**（baseUrl/model/thinking/webSearch/voice）。**绝不包含 `apiKey`** |
| `conversations[]` | 复用 `loadConversations` 的落盘结构，字段完全一致（这样导入后能直接喂给现有渲染） |
| `messages[]` | 用户消息 `{id, role:'user', text, attachments}`；助手消息 `{id, role:'assistant', versions[], versionIndex, blocks, status, stopReason, error}` |
| `blocks[]` | 现有 5 种：`thinking` / `text`（可选 `citations`）/ `tool` / `sources` / `fetch` |

> **不导出**：`apiKey`、上传中的附件、`settings` 之外的状态（`railOpen` 等 UI 状态）、语音/录音临时数据。**不导出**附件二进制（我们本来就没有）：`fileId` 属于旧账号时，导入后首次进请求会 400 —— 本期接受，导入提示里说明"历史附件可能需要重新上传"。

### 4.3 校验顺序与错误文案（照搬 demo 的分层）

| # | 检查 | 文案 key | 中文（demo 逐字；标注 † 的必须改词） |
| --- | --- | --- | --- |
| 1 | 文件读不出文本 / `JSON.parse` 抛错 | `backupInvalidJson` | `文件不是有效的 JSON`（`zh.ts:80`） |
| 2 | 顶层不是对象、`format` ≠ `"dsh.deepseekChat.backup"` | `backupUnrecognized` | † `无法识别该文件，请选择本插件导出的对话备份 JSON 文件`（demo：`无法识别该文件，请选择 DeepSeek 导出的历史对话 ZIP 文件`，`zh.ts:81`） |
| 3 | `version` 缺失 / 非正整数 / `< 1` | `backupInvalidVersion` | `文件版本无效，无法导入`（`zh.ts:83`） |
| 4 | `version > BACKUP_VERSION` | `backupNewerVersion` | `文件版本过新，请升级后再导入`（`zh.ts:82`） |
| 5 | `conversations` 不是数组、会话缺 `id`/`messages` 不是数组、时间戳非法 | `backupIncomplete` | `文件内容不完整，无法导入`（`zh.ts:84`） |
| 6 | 助手消息 `versions` 结构坏（不是数组、空数组、`versionIndex` 越界且无 `blocks`） | `backupInvalidBranches` | `文件中的消息分支已损坏，无法导入`（`zh.ts:85`） |
| 7 | `attachments` / `sources.items` 结构坏（缺 `url`、`fileId` 非字符串） | `backupInvalidFiles` | `文件中的附件数据已损坏，无法导入`（`zh.ts:86`） |
| 8 | 超过体积/条数上限（建议：文件 > 8 MB 或会话 > 500 或消息 > 20000） | `backupTooLarge`（新增） | `备份文件过大，请拆分后再导入` |

校验**全部通过后**才动数据；解析一律不 throw 到 UI，返回 `{ok:false, errorKey}`。顺序不能换：先"是不是我们的文件"再"版本"再"内容"，否则用户会看到"内容不完整"这种误导文案。

### 4.4 覆盖语义

1. 选文件 → 立即读文本、跑 §4.3 校验（**只读，不改状态**）；
2. 校验通过 → 弹 `ConfirmDialog`（复用现有组件）：标题/正文见 §4.6；
3. 确认后：`abortRef.current?.abort()` 停掉流式回复 → `setConversations(imported)`、`setActiveId(imported[0]?.id ?? null)`、`setDrawerId(null)`、`setEditing(null)`；
4. 可选：若备份里带 `settings`，询问后覆盖 baseUrl/model/thinking/webSearch/voice（**不动 apiKey**）；
5. **立刻** `writeJson(CONVERSATIONS_KEY, …)` 并检查返回值，成功 → 关闭设置 + 成功状态行；失败 → 回滚 `conversations` 到导入前快照 + 显示"本地存储空间不足"；
6. 失败（校验或写盘）→ **现有对话一条不动**。

> 与 demo 的差别：demo 是"暂存 + 原子提交"（IndexedDB 事务），我们是"内存快照 + localStorage 单次写"。等价做法是**保留导入前数组的引用**，写失败时 `setConversations(previous)` 回滚。

### 4.5 删除全部对话（沿用 demo 文案）

- 设置行：label `删除所有对话`，hint `删除后无法找回。`（可选），按钮 `删除`（危险色）；
- 确认弹窗（复用 `ConfirmDialog`）：
  - 标题 = `删除后，所有对话都将被清空且无法找回`（`zh.ts:123` 逐字）
  - 正文 = `本地保存的对话及未发送的草稿也将被删除。`（† 把 demo 的 `附件` 换成 `对话`，因为我们不存附件原件；如果你坚持逐字用 `本地保存的附件及未发送的草稿也将被删除。` 也能接受，但语义略有出入）
  - 按钮：`取消` / `删除所有对话`
- 执行：停流 → `setConversations([])` → `setActiveId(null)` → `writeJson(CONVERSATIONS_KEY, [])`（`clearAll` 现状已做，补停流与写失败提示）→ 关闭设置 → 状态行 `删除成功` / 失败 `删除失败，请重试`（`zh.ts:126-127` 逐字）；
- **不得**清 `SETTINGS_KEY`（demo 明确保留 API Key，`backup.ts:53`）。

### 4.6 「数据管理」分组布局

放在现有 `SettingsDialog` 的 `settingsConnection`（连接）、`settingsSpeech`（语音）之后，新增分组标题 `数据管理`（demo `settingDialogAsideDataOptionLabel` 逐字，`zh.ts:96`）。原来放在弹窗 footer 的「删除全部对话」按钮**移进这个分组**，避免两个入口。

```
设置 ───────────────────────────────────────  [×]
只有本面板会读取这些设置，且保存在当前浏览器中。

连接
  API Key  [••••••••]  [验证]
  API 地址 [https://api.deepseek.com]
  模型     [deepseek-flash]

语音
  音色     [海星 · 女声]

数据管理                                  ← 新增 section title
  ┌ 导出所有对话                            [导出] ┐
  │ 包含全部对话与设置（不含 API Key），保存为 JSON 文件。
  │ 已导出 3 个对话                    ← 状态行（成功绿 / 失败红 / 空）
  └────────────────────────────────────────────┘
  ┌ 导入对话备份                     [选择文件] ┐
  │ 导入会覆盖当前浏览器中的全部对话，导入前会再次确认。
  │ 文件内容不完整，无法导入            ← 校验失败时显示具体原因
  └────────────────────────────────────────────┘
  ┌ 删除所有对话                         [删除] ┐   ← 危险色按钮
  │ 删除后无法找回。
  └────────────────────────────────────────────┘

                                 [取消]  [保存]
```

交互细则：

| 元素 | 规则 |
| --- | --- |
| 导出按钮 | 无对话时 `disabled`（demo 同款逻辑 `SettingsDialog.tsx:550`）；导出中 `disabled` 且文案不变（导出是同步 JSON 序列化，很快，可不做 loading） |
| 导出成功 | 状态行 `已导出 {count} 个对话`；同时触发下载 |
| 导入按钮 | 点击 → 隐藏 `<input type="file" accept=".json,application/json">` |
| 导入流程 | 选文件 → **先校验**，失败直接显示原因（不弹确认）→ 通过才弹 `ConfirmDialog` → 确认后执行 |
| 导入确认弹窗 | 标题 `确认导入对话备份？`，正文 `导入将覆盖当前浏览器中的全部对话记录，是否继续？`，按钮 `取消` / `确认导入`（结构照 `SettingsDialog.tsx:318-343`） |
| 导入成功 | 状态行 `已导入 {count} 个对话`，关闭弹窗回到列表 |
| 导入失败 | 状态行显示 §4.3 的具体原因；现有对话不受影响 |
| 删除按钮 | 危险色；确认弹窗见 §4.5；删除中禁用并显示 `删除中...` |
| 状态行生命周期 | 下次点任一按钮时清空；成功文案 4s 后自动淡出 |

### 4.7 落在 client.js 的哪里

| 新增/修改 | 位置（按现有文件结构） |
| --- | --- |
| `BACKUP_FORMAT` / `BACKUP_VERSION` 常量 | 文件顶部常量区（`CONVERSATIONS_KEY` 附近） |
| `function backupFileName(now)` | utils 段（与 `formatWhen`/`titleFrom` 同段），照 `backup.ts:17` 的写法但改成 `.json` + 时分 |
| `function buildBackup(conversations, settings)` | utils 段；**settings 用手写白名单对象**，不要 `Object.assign({}, settings)`（会把 apiKey 带出去） |
| `function downloadJson(name, value)` | utils 段；`Blob` + `URL.createObjectURL` + `<a download>` + `click()` + `setTimeout(revoke, 10000)`（照 demo `SettingsDialog.tsx:526-532`） |
| `function parseBackup(text)` → `{ok, errorKey, conversations, settings}` | utils 段；实现 §4.3 的 8 步校验，**不 throw** |
| `function sanitizeConversation(raw)` | **从现有 `loadConversations` 里抽出来**，`loadConversations` 与导入共用（导入的数据必须先过同一套 sanitize，否则 UI 会崩） |
| `ChatPanel.exportBackup()` | ChatPanel；`buildBackup` + `downloadJson` + 设置状态行 |
| `ChatPanel.importBackup(file)` | ChatPanel；`file.text()` → `parseBackup` → 确认 → 停流 → 快照 → `setConversations` → `writeJson` 校验 → 成功/回滚 |
| `ChatPanel.clearAll()` | 已存在；补「停流 + `writeJson` 返回值检查 + 失败提示」 |
| `SettingsDialog` props | 增加 `onExport` / `onImportFile` / `onDeleteAll` / `backupStatus`（现状只有 `onClearAll`）；分组渲染放 `settingsSpeech` 之后 |
| `ConfirmDialog` | 直接复用（已支持 `title` / `body` / `confirmLabel` / `onConfirm` / `onCancel`） |
| 隐藏 `<input type="file">` | `SettingsDialog` 内 `useRef`，与现有附件上传的 input 同写法 |

**消息模型：不需要新增字段。** 导出/导入原样复用 `{id, role, text, attachments}` 与 `{id, role, blocks, versions, versionIndex, status, stopReason, error}`；唯一可选增强是在助手消息上加 `prefix`（见 10 号规格 §4.2），与本备份格式无关，旧备份缺省按 `true` 处理即可。

### 4.8 中英文案（新增 key）

| key | zh | en |
| --- | --- | --- |
| `settingsData` | `数据管理`（demo `zh.ts:96` 逐字） | `Data`（demo `en.ts:101`） |
| `exportLabel` | `导出所有对话` | `Export all chats` |
| `exportHint` | `包含全部对话与设置（不含 API Key），保存为 JSON 文件。` | `Includes every chat and your settings (no API key), saved as a JSON file.` |
| `exportButton` | `导出` | `Export` |
| `exportDone` | `已导出 {count} 个对话` | `Exported {count} chats` |
| `exportEmpty` | `还没有可导出的对话` | `Nothing to export yet` |
| `exportFailed` | `导出失败：{message}`（demo `zh.ts:117` 逐字） | `Export failed: {message}` |
| `importLabel` | `导入对话备份` | `Import a backup` |
| `importHint` | `导入会覆盖当前浏览器中的全部对话，导入前会再次确认。` | `Importing replaces every chat in this browser. You will be asked to confirm.` |
| `importButton` | `选择文件` | `Choose file` |
| `importConfirmTitle` | `确认导入对话备份？` | `Import this backup?` |
| `importConfirmBody` | `导入将覆盖当前浏览器中的全部对话记录，是否继续？` | `Importing replaces all chats stored in this browser. Continue?` |
| `importConfirm` | `确认导入`（demo `zh.ts:109` 逐字） | `Import`（demo `en.ts:114`） |
| `importDoneOne` | `已导入 1 个对话`（demo `zh.ts:113` 逐字） | `Imported 1 chat` |
| `importDone` | `已导入 {count} 个对话`（demo `zh.ts:114` 逐字） | `Imported {count} chats` |
| `importFailed` | `导入失败，请检查文件后重试` | `Import failed. Check the file and try again.` |
| `backupInvalidJson` | `文件不是有效的 JSON`（demo `zh.ts:80` 逐字） | `The file is not valid JSON.` |
| `backupUnrecognized` | `无法识别该文件，请选择本插件导出的对话备份 JSON 文件` | `File not recognized. Choose a JSON backup exported by this plugin.` |
| `backupNewerVersion` | `文件版本过新，请升级后再导入`（demo `zh.ts:82` 逐字） | `This backup is newer than this version. Update and retry.` |
| `backupInvalidVersion` | `文件版本无效，无法导入`（demo `zh.ts:83` 逐字） | `The backup version is invalid.` |
| `backupIncomplete` | `文件内容不完整，无法导入`（demo `zh.ts:84` 逐字） | `The backup is incomplete.` |
| `backupInvalidBranches` | `文件中的消息分支已损坏，无法导入`（demo `zh.ts:85` 逐字） | `The message branches in this backup are corrupted.` |
| `backupInvalidFiles` | `文件中的附件数据已损坏，无法导入`（demo `zh.ts:86` 逐字） | `The attachment data in this backup is corrupted.` |
| `backupTooLarge`（新增概念） | `备份文件过大，请拆分后再导入` | `This backup is too large to import.` |
| `storageFull` | `本地存储空间不足，导入失败` | `Local storage is full. Import cancelled.` |
| `deleteAllLabel` | `删除所有对话`（demo `zh.ts:122` 逐字） | `Delete all chats` |
| `deleteAllTitle` | `删除后，所有对话都将被清空且无法找回`（demo `zh.ts:123` 逐字） | `Once deleted, all chats are cleared and cannot be recovered.` |
| `deleteAllBody` | `本地保存的对话及未发送的草稿也将被删除。` | `Locally saved chats and unsent drafts are deleted too.` |
| `deleteAllDone` | `删除成功`（demo `zh.ts:126` 逐字） | `Deleted` |
| `deleteAllFailed` | `删除失败，请重试`（demo `zh.ts:127` 逐字） | `Could not delete. Try again.` |
| `deleting` | `删除中...`（demo `zh.ts:125` 逐字，三个半角点） | `Deleting...` |

> 现有 `clearAll` / `clearConfirm` 两个 key 会被 `deleteAllLabel` / `deleteAllTitle` + `deleteAllBody` 取代（现在只有一个确认串，没有独立正文）。

---

## 5. 验收清单

**导出**
1. 无对话时「导出」禁用；有对话时可点。
2. 点击后浏览器下载 `dsh-chat-backup-2026-11-16-1530.json`。
3. 打开文件：`format`/`version`/`settings`/`conversations` 齐全；**全文搜索 `apiKey`、`sk-` 无命中**。
4. 文件里的对话与界面一致（标题、条数、版本、blocks 类型）。
5. 修改一个字段（如 `version: 99`）→ 导入时提示"文件版本过新"。

**导入**
6. 选非 JSON（如 .txt）→ `文件不是有效的 JSON`。
7. 选合法 JSON 但不是我们的（如 `{}`）→ `无法识别该文件…`。
8. `version` 缺失 / `"1"` 字符串 → `文件版本无效，无法导入`。
9. 删掉某会话的 `messages` → `文件内容不完整，无法导入`。
10. 把 `attachments` 改成字符串 → `文件中的附件数据已损坏，无法导入`。
11. 合法备份 → 弹确认（标题/正文逐字）→ 确认后对话列表变为备份内容、当前会话回到第一条、设置弹窗关闭。
12. 导入过程中取消确认 → 现有数据**零变化**。
13. 导入大文件（>8MB）→ `备份文件过大，请拆分后再导入`，无长时间卡顿。
14. 导入后刷新页面 → 数据仍在（已写 localStorage）。

**删除全部**
15. 点「删除」→ 弹出标题 `删除后，所有对话都将被清空且无法找回`、正文按 §4.5；取消不删。
16. 确认后列表清空、回到欢迎页、刷新后仍为空。
17. **API Key、baseUrl、模型、音色保持不变**（重新打开设置核对）。
18. 生成中点删除 → 流被中断，无报错、无残留消息。

---

## 6. 最容易错的地方

1. **把 `apiKey` 带进备份**：`buildBackup` 里千万不能 `Object.assign({}, settings)`（`settings` 里就有 `apiKey`）。必须手写白名单 5 个字段。导出前后都用 `JSON.stringify` 文本搜一遍 `apiKey`/`sk-`。
2. **导入不 sanitize 直接 `setConversations`**：备份可能被手改过，`blocks` 里出现未知类型会让渲染函数抛错白屏。必须复用 `loadConversations` 的 sanitize（抽成 `sanitizeConversation`）。
3. **localStorage 配额**：5MB 左右，`writeJson` 失败是**静默返回 false**（`client.js` `writeJson`），不检查就会"看起来导入成功、刷新全丢"。必须检查返回值并回滚内存状态。
4. **校验顺序颠倒**：先判"内容完整"再判"是不是我们的文件"，用户会收到误导文案。顺序固定为：JSON → format → version → 结构 → 一致/大小。
5. **覆盖前不停流**：正在流式写 `conversations` 的 `runReply` 会在导入后继续 `patchMessage`，把已导入的数据再改掉（`patchMessage` 找不到 id 会 `map` 出空操作，但 `setConversations` 快照可能覆盖）。必须先 `abortRef.current.abort()`。
6. **导入后不立即写盘**：现有 300ms 去抖会把顺序搞乱（尤其紧接着又删除）；导入/删除是低频操作，应**立即**写。
7. **空会话被过滤的错觉**：持久化时会 `filter(item => item.messages.length > 0)`（`ChatPanel` 的保存 effect），若 `activeId` 指向一个空会话，刷新后该会话消失而 `activeId` 悬空 → 导入后选 `activeId` 要跳过空会话。
8. **删除全部顺手清了 settings**：demo 明确保留 API Key（`backup.ts:53`）；`clearAll` 只能清 `CONVERSATIONS_KEY`。
9. **时间戳不带校验**：`Date.parse` 失败会得到 `NaN` → 排序函数 `b.updatedAt - a.updatedAt` 全 `NaN`，列表顺序随机。导入时非法时间戳要回退 `Date.now()` 或直接判 `backupIncomplete`。
10. **附件 `fileId` 跨账号失效**：备份里的 `fileId` 属于旧账号/已过期时，下次发消息会 400。必须在导入提示里写明"历史附件可能需要重新上传"，并（后续）接上 `file_id` 失效自动重传。
11. **文件名不带时分**：同一天导出两次 → 浏览器自动改成 `(1)`，用户分不清哪个新。用 `HHmm`。
12. **危险按钮没二次确认**：删除全部不可恢复，必须走 `ConfirmDialog`，且确认按钮用危险色、默认焦点在「取消」（demo 对取消键 `autoFocus`，`SettingsDialog.tsx:151`）。
