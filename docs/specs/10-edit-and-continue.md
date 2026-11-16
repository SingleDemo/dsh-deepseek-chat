# 10 · 编辑用户消息 & 继续生成

> 规格对象：`client.js`（无构建、单文件、`h()` 写法、localStorage 存 `dsh.deepseekChat.conversations.v1`）
> 参照实现：原版 demo `deepseek-ai/chat-demo@5d5dd75`
> 约定：`demo:src/...` 的行号来自当前工作副本；`client.js` 只标函数/组件名，行号一律写 `≈`（该文件正被并行修改，行号会漂移）。
> 本文只写规格，不实施。**不要改 client.js / 不要 git 提交。**

---

## 0. 三条先看结论

1. **编辑在 demo 里不是"截断"，是"加分支"**：`editMessage` 把新提问挂到**原提问的父节点**下，旧提问、旧回答、后续对话全部保留，只是"当前可见路径"切到新分支，可用版本切换器切回。
   → 我们的 localStorage 模型是线性数组，本期**只能截断**；但必须把这个差异告诉用户（见 §2.5 文案），否则用户会以为"只是重发"。
2. **继续生成 = assistant prefill**：demo 不在客户端"重发"，而是把已生成的内容作为 `role: 'assistant'` 的**最后一条**消息塞进请求，让模型接着写；新块**追加**在同一条消息的 `blocks` 末尾，不新建消息、不新建版本。
3. **决不允许"联网回答续写"**：`canContinueReply` 除了判断 `status/stopReason`，还排除了含服务端工具块、模板文本、`refusal`、`tool_use` 的回复。少写这一条 → 续写必 400。

---

## 1. 编辑消息：demo 的实现事实

### 1.1 入口：在用户消息气泡里，不在输入框

| 事实 | 出处 |
| --- | --- |
| 编辑按钮在用户消息底部操作行：`IconButton` + `tooltip={t('editMessage')}`，`disabled={busy}` | `src/components/messages/UserMessage.tsx:119-128` |
| 点击时先把气泡文本灌进草稿：`setDraft(message.content); setEditing(true)` | `src/components/messages/UserMessage.tsx:124-127` |
| 操作行平时 `opacity:0`，悬停容器才显示；最后一条消息 `.alwaysShow` 常显 | `src/components/messages/UserMessage.module.css`（`.actions` / `:hover .actions` / `.alwaysShow`） |
| 每行还会渲染兄弟版本切换器（`BranchSwitcher`），编辑产生的新提问就是它的一个"版本" | `src/components/messages/UserMessage.tsx:130`；`MessageList.tsx:159` 传 `versions` |
| `MessageList` 只把 `busy={streaming}` 传下去，生成中禁止编辑 | `src/components/messages/MessageList.tsx:151-161` |

### 1.2 编辑态 UI 是**就地替换气泡**，不是回到输入框

- 结构：`editing ? <div className={styles.editor}><textarea/> <Button/> <Button/></div> : <气泡+操作行/>`，见 `src/components/messages/UserMessage.tsx:81-133`
- 高度自适应：`height='auto'` 再取 `Math.min(textarea.scrollHeight, 202)`，上限 **202px**；CSS 另有 `min-height:44px; max-height:202px; border-radius:22px`（`UserMessage.tsx:48-54`，`UserMessage.module.css` 的 `.editor/.textarea`）
- 可发送判定：`const canSend = !busy && (draft.trim() !== '' || message.files.length > 0)`（`UserMessage.tsx:46`）——**只删文字但保留附件也算合法编辑**
- 键盘（`UserMessage.tsx:92-102`）：
  - `event.nativeEvent.isComposing` → 直接 return（中文输入法保护）
  - `Escape` → 退出编辑（不保存）
  - `Enter` 且无 `shiftKey`/`ctrlKey` 且非移动端 → `preventDefault()` 后 `sendEdit()`
- 底部按钮：`t('cancel')` + `t('send')`，`size="s"`，发送按钮 `disabled={!canSend}`（`UserMessage.tsx:104-111`）
- 编辑按钮工具栏文案：`t('editMessage')`；输入框 `aria-label={t('editMessage')}`（`UserMessage.tsx:86`）

### 1.3 提交路径

```ts
// src/components/messages/UserMessage.tsx:56-61
const sendEdit = () => {
  if (canSend && ensureApiKey() && editMessage(sessionId, message.id, draft.trim())) {
    stopReadAloud()
    setEditing(false)
  }
}
```

- `ensureApiKey()`（`src/components/settings/settingsDialogState.ts:19-25`）：没有 Key 时 `openSettings('data')` 打开设置并选中「数据管理」分组，返回 `false` → 编辑态**保持不动**，草稿不丢。
- 只有 `editMessage` 返回 `true`（同步成功）才退出编辑态并停止朗读。
- 会话标题**不更新**：`editMessage` 里没有改 `title`。

### 1.4 "截断后续消息"的真实语义：demo 用分支，不用删除

`editMessage` 全文（`src/services/chat/store.ts:645-675`）：

```ts
/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) return false
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) return false          // 生成中禁止
  const path = getVisibleMessages(session)                              // ★ 可见路径，不是原始 messages
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) return false
  const question: UserMessage = {
    id: createId(),                       // ★ 新 id，不是原地改
    role: 'user',
    content: text,
    files: previous.files,                // ★ 附件整体复用（共享 fileId/serverId）
    createdAt: Date.now(),
  }
  const reply = createReply()             // prefix:true, status:'pending'
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),  // ★ 挂到「原提问的父节点」
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })  // ★ 历史=被编辑消息之前
  return true
}
```

- `appendBranch`（`src/services/chat/branches.ts:77-101`）：把父节点 `selectedChildId` 指向新 `question`，新消息按顺序串 `parentId/selectedChildId`，**旧消息一条不删**。
- 可见路径：`getVisibleMessages`（`branches.ts:18-35`）从 `rootMessageId` 沿 `selectedChildId` 走 → 编辑后界面上立刻只剩"新提问+新回答"，旧对话要切版本才看得到。
- 切回：`selectVersion`（`branches.ts:104-116`）；UI 是 `BranchSwitcher`（`UserMessage.tsx:130` / `AssistantMessage.tsx:143`），文案 `t('messageVersions')` / `t('previousVersion')` / `t('nextVersion')`。
- `createReply()`（`store.ts:257-270`）固定 `prefix: true, status: 'pending', blocks: []`，并快照当前 `thinking/search`。

**结论：demo 的"截断"= 让旧分支不可见（可恢复）；我们线性存储如果照抄"截断"，是**真删且不可恢复**，语义更重，必须区别对待（见 §2）。**

### 1.5 请求怎么重建

1. `streamReply`（`store.ts:962-1094`）先 `prepareFiles`（补附件 `serverId`，`store.ts:816-876`）；
2. 生成/复用 `latestReminder`（编辑路径走 `createLatestReminder`，`store.ts:985-989`）；
3. `toRequestMessages(history, question, prefix, thinking, latestReminder)`（`store.ts:992-998`）；
4. `toRequestMessages`（`src/services/chat/reply.ts:303-343`）：只保留「提问 + 可用回答」成对轮次（`getContextRounds`，`reply.ts:287-297`），每轮前按需插 `{role:'latest_reminder'}`，最后 push 本轮 `question`；有 `prefix` 时再 push assistant（续写用，编辑路径没有 `prefix`）；
5. 历史 assistant 参数由 `toAssistantParam(reply)` 生成，`prefix=false, thinking=false`：**历史思考一律不回传**，文本去 citations，相邻文本拼接（`reply.ts:223-284`）。

---

## 2. 编辑消息：落到 client.js

### 2.1 现状快照（截至本规格写作时）

| 已有 | 位置 |
| --- | --- |
| `editing` 状态 `{conversationId, messageId}` | `client.js` `ChatPanel`（`const [editing, setEditing] = useState(null)`） |
| 用户消息上的编辑按钮 | `client.js` `UserMessage`（`canEdit` / `onEdit`，`t('editMessage')`） |
| 编辑入口：写 `editing`、`setDraft(message.text)`、`setAttachments([])`、聚焦并全选 | `client.js` `ChatPanel` 的 `onEdit`（线程渲染处） |
| 提交：`send()` 的 `if (editing) {...}` 分支，**已经做的是截断** | `client.js` `ChatPanel.send()` |
| 编辑提示条 + 取消 | `client.js` `dsc-editBar` + `t('editingMessage')` / `t('cancelEdit')` |

`send()` 编辑分支当前逻辑（等价转写）：

```js
const target = findConversation(editing.conversationId)
const index = target.messages.findIndex((item) => item.id === editing.messageId)
const original = target.messages[index]
const question = Object.assign({}, original, {
  text,
  attachments: ready.length ? ready.map(attachmentMeta) : (original.attachments || []),
})
const history = target.messages.slice(0, index)          // 截断点
const botMessage = { id: uid(), role: 'assistant', blocks: [], status: 'streaming', error: '' }
updateConversation(target.id, (item) => Object.assign({}, item, {
  title: item.title || titleFrom(text),
  updatedAt: Date.now(),
  messages: history.concat([question, botMessage]),       // ★ 后续消息被丢弃
}))
const request = requestMessages(history, question, t('send') === 'Send')
…
runReply(target.id, botMessage.id, request, settings.webSearch)
```

### 2.2 与 demo 的差距（必须处理的 5 条）

| # | 差距 | 处理 |
| --- | --- | --- |
| E1 | **编辑可用性判定不对**：`send()` 开头是 `if ((!text && !ready.length) \|\| busy \|\| uploading) return`。若用户"只删文字、保留原附件"，`ready.length===0` 会被这个 guard 直接挡掉。 | 编辑分支要提前：进入 `if (editing)` 后单独判定 `canSend = !busy && (text.trim() \|\| (ready.length ? true : original.attachments.length > 0))`；不满足时置 `notice` 并 return。等价 demo `UserMessage.tsx:46`。 |
| E2 | **没有"编辑中"的截断提示**：demo 里后续消息不可见但可切回；我们真删。 | 编辑提示条必须写明会删除后续回答（新增 key，见 §2.5 `editTruncateHint`）。可选：后续回答多于 0 条时，发送前弹一次 `ConfirmDialog`（复用 `client.js` `ConfirmDialog`）。 |
| E3 | **取消不恢复草稿**：`t('cancelEdit')` 里 `setEditing(null); setDraft('')`，用户原本没发送的草稿直接丢失。 | 编辑入口把当前 `draft`/`attachments` 存进 `editing.backup`；取消时还原（无草稿则保持空）。 |
| E4 | **附件语义**：demo 复用被编辑消息的 `files`；我们一旦 `ready.length` 非空就**整组替换**，用户无法"删掉一个原附件"。 | 本期接受"替换语义"，但编辑入口不要再 `setAttachments([])` 直接把原附件藏起来——应把原附件作为只读 chip 展示（或至少在提示条说明"发送后使用当前输入框的附件"）。最小改动：入口 `setAttachments(original.attachments.map(toChip))`，状态直接 `done`（已有 `fileId`），用户可逐个移除。 |
| E5 | **重复提交**：`editing` 只在成功路径 `setEditing(null)`，接口异常/组件重渲染后仍保留，用户再点发送会**再截断一次**（此时 index 已变）。 | 发送前立即 `setEditing(null)` 并保存一份 `history`/`index` 局部变量；失败只回滚 UI 提示，不回滚消息。 |

其余细节与 demo 对齐即可：进入编辑要 `input.select()`（已做）、`busy` 时不可编辑（已做 `canEdit: !busy`）、`Enter` 发送沿用现有 `onKeyDown`、编辑中禁止切换会话应清 `editing`（建议 `setActiveId` 时一并 `setEditing(null)`）。

### 2.3 需要改/新增的函数（落在哪里）

| 动作 | 落在 client.js 的哪里 |
| --- | --- |
| 编辑入口（读原消息、预填草稿/附件/备份） | `ChatPanel` 内新增 `startEdit(message)`（现在内联在 `onEdit` 里，抽出来） |
| 取消编辑（还原草稿/附件） | `ChatPanel` 内新增 `cancelEdit()`，替换 `dsc-editBar` 里的内联 onClick |
| 编辑发送 | 改造 `ChatPanel.send()` 的 `if (editing)` 分支（见 §2.2 E1/E5） |
| 请求重建 | 沿用 `requestMessages(history, question, english)`，**不要**改签名 |
| 截断提示 / 二次确认 | `dsc-editBar` 文案；`ConfirmDialog`（`client.js` 已有组件） |
| 编辑按钮显示态 | `UserMessage` 组件（已有 `canEdit`/`onEdit`），CSS 增 `.dsc-userActions` 悬停显隐 |

### 2.4 消息模型

- **编辑不需要新增字段**：`{id, role:'user', text, attachments}` 够用；新回答仍 `{id, role:'assistant', blocks:[], versions, versionIndex, status:'streaming', stopReason:'', error:''}`。
- 若要实现 demo 的分支版本（本期**不做**，列在这里避免以后返工）：需在消息上加 `parentId`/`selectedChildId`，会话加 `rootMessageId`，并在 `loadConversations` 做迁移；`versionIndex` 机制只覆盖"同一回答的多个版本"，**不能**替代"同一提问的多个版本"。

### 2.5 中英文案

复用（已存在，改文案即可）：

| key | 中文（demo 逐字） | 出处 |
| --- | --- | --- |
| `editMessage` | `编辑消息` | `src/i18n/zh.ts:30` |
| `cancelEdit` | `取消` | `src/i18n/zh.ts:17` |
| `send` | `发送` | `src/i18n/zh.ts:29` |

新增（因为我们的截断语义与 demo 不同，必须有说明）：

| key | zh | en |
| --- | --- | --- |
| `editTruncateHint` | `发送后将删除这条消息之后的全部回答` | `Sending will delete the replies after this message` |
| `editConfirmTitle`（可选，仅当后续回答 >0） | `编辑会删除后续回答？` | `Editing deletes the later replies?` |
| `editConfirmBody`（可选） | `这条消息之后的回答将被删除且无法找回。` | `The replies after this message will be removed and cannot be recovered.` |

> demo 里没有"删除"类文案，`editTruncateHint` 是我们自己的补充，不要从 demo 硬抄。现有的 `editingMessage`（`正在编辑这条消息，发送后将替换它及其后的回答`）已表达"替换"语义，可保留；**若同时保留两句会重复**，建议用 `editTruncateHint` 替换 `editingMessage` 的文案内容，key 名不动。

---

## 3. 继续生成：demo 的判定与实现事实

### 3.1 `canContinueReply` 源码（逐字引用）

```ts
// src/services/chat/reply.ts:166-191
/**
 * 只有正常达到输出上限或被停止的回复可续写，报错回复不能续写。
 * 末条限制由调用方判断，拒绝和客户端工具调用不能续写。
 * 本轮含服务端工具调用或结果（含 READ_LINK 和孤立结果块）的回复不能续写。
 * 服务端模板提示不能作为续写前缀。
 */
export const canContinueReply = (reply: AssistantMessage): boolean => {
  if (
    !reply.prefix ||
    reply.stopReason === 'refusal' ||
    reply.stopReason === 'tool_use' ||
    reply.blocks.some(
      (block) =>
        block.type === 'server_tool_use' ||
        block.type === 'web_search_tool_result' ||
        block.type === 'web_fetch_tool_result' ||
        (block.type === 'text' && block.isTemplate)
    )
  ) {
    return false
  }
  return (
    reply.status === 'stopped' ||
    (reply.status === 'done' && reply.stopReason === 'max_tokens')
  )
}
```

六个条件，缺一不可：

| 条件 | 含义 | 出处 |
| --- | --- | --- |
| `reply.prefix` | 只在"由本客户端新建的回答"上允许续写；导入的历史回答 `prefix:false` | 类型注释 `src/services/chat/types.ts:86-87`；`createReply` 置 true `store.ts:266`；导入置 false `src/services/chat/history/toLocal.ts:230` |
| `stopReason !== 'refusal'` | 安全拒绝不能续写 | `reply.ts:175` |
| `stopReason !== 'tool_use'` | 以工具调用结尾的不能续写 | `reply.ts:176` |
| 无 `server_tool_use` / `web_search_tool_result` / `web_fetch_tool_result` | 本轮用过服务端工具（含 read_link）就不行 | `reply.ts:177-183` |
| 无 `text.isTemplate` | 服务端模板提示（过载/过滤/超长）不能当 prefill | `reply.ts:182`；模板来源 `toLocal.ts:120-121` |
| `status==='stopped'` 或 `status==='done' && stopReason==='max_tokens'` | 只有"被停止"或"撞输出上限"两种才会被切断 | `src/services/chat/types.ts:68-72` |

**"末条"限制不在函数里**，由调用方保证：

- UI 层：`isLast && canContinueReply(message)`（`src/components/messages/AssistantMessage.tsx:160`），`isLast` 来自 `MessageList.tsx:167`（`index === lastIndex`）；
- store 层二次校验（`store.ts:697-707`）：`path.at(-2)` 必须是 user、`path.at(-1)` 必须是 assistant 且 `previous.id === messageId`、再 `canContinueReply(previous)`；
- 生成中不可点：`disabled={busy}`（`AssistantMessage.tsx:165`）。

### 3.2 按钮放在哪、长什么样

```tsx
// src/components/messages/AssistantMessage.tsx:160-173
{isLast && canContinueReply(message) ? (
  <Button
    variant="outlined"
    size="s"
    className={styles.continueButton}
    disabled={busy}
    onClick={() => {
      stopReadAloud()
      continueReply(sessionId, message.id)
    }}
  >
    {t('continueGenerating')}
  </Button>
) : null}
```

- 容器：回答底部的操作行 `.bottom`（复制、重新生成、版本切换同一行），整体只在 `streaming ? null : …` 分支里渲染（`AssistantMessage.tsx:141-175`）。
- 位置：操作行 `div.actions` **之后**、`.bottom` 直接子节点 → 视觉上在图标按钮行下方/右侧独立成一行（`.continueButton` 单独样式）。
- 文案：`t('continueGenerating')` = `继续生成`（`src/i18n/zh.ts:32`）；英文 `Continue`（`src/i18n/en.ts:36`）。
- 点击副作用：先 `stopReadAloud()`，再 `continueReply(sessionId, message.id)`。

### 3.3 `continueReply`：状态怎么处理

```ts
// src/services/chat/store.ts:688-724（节选）
const { thinking, search } = useSettings.getState()
const reply: AssistantMessage = {
  ...previous,                                   // ★ 保留 id / blocks / 版本位置
  model: previous.model ?? MODEL,
  thinking: previous.thinking ?? thinking,
  search: previous.search ?? search,
  status: 'pending',
  stopReason: undefined,
  stopDetails: undefined,
  error: undefined,
}
updateReply(sessionId, reply)
void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
```

- **不新建消息、不新建版本槽**，只把原消息 `status` 改成 `pending` 并清空 `stopReason/stopDetails/error`；
- `history = path.slice(0, -2)`（去掉最后两条 user+assistant），`question = path.at(-2)`，`prefix = previous`；
- 开关：未记录请求配置的老回答回填当前默认（`store.ts:711-714`）；有记录就沿用原值（同一轮继续，开关不能变）；
- `latestReminder` 沿用原回答快照：`store.ts:985-989`（`prepared.prefix ? prepared.prefix.latestReminder : createLatestReminder(...)`）。

### 3.4 prefill 怎么拼

入口在 `toRequestMessages` 末尾：

```ts
// src/services/chat/reply.ts:329-341
if (prefix?.prefix) {
  const assistant = toAssistantParam(prefix, true, thinking)
  // 没有非空白正文或有效思考时直接重发原问题，避免服务端拒绝空 Prefill。
  if (
    assistant.content.some(
      (block) =>
        (block.type === 'text' && block.text.trim()) ||
        (block.type === 'thinking' && block.thinking.trim())
    )
  ) {
    messages.push(assistant)
  }
}
```

`toAssistantParam(blocks, prefix, thinking)`（`reply.ts:223-284`）在 `prefix=true` 时的分支：

| 块 | 处理 | 出处 |
| --- | --- | --- |
| `thinking` 且内容全空白 | `continue` 跳过，不占位、不制造空行 | `reply.ts:243-246` |
| `thinking` 且 `thinking=true`（开关开） | `content.push({type:'thinking', thinking, signature: signature ?? ''})` **保留本轮思考与签名** | `reply.ts:261-264` |
| `thinking` 且 `thinking=false` | 不回传（历史思考同样不回传） | `reply.ts:261-264` 的反面 |
| `text` 连续 | 直接拼接（`text.text += block.text`） | `reply.ts:247-250` |
| `text` 被思考/工具隔开 | 前一块是 text 时用 `'\n\n'` 连接，否则原样起头 | `reply.ts:251-257` |
| `server_tool_use` / `web_fetch_tool_result`（kind=`read_link`） | 原样回传（含 signature，服务端解密后拼回该轮提问末尾）；无签名的一对都不回传 | `reply.ts:229-239, 265-278` |
| 其它工具块 | 丢弃 | `reply.ts:265-278` |
| 末尾 | 过滤 `text === ''` 的空块 | `reply.ts:280-283` |

thinking 开关从哪来：`streamReply` 里 `toRequestMessages(..., initial.thinking ?? false, latestReminder)`（`store.ts:992-998`），请求体 `thinking: { type: initial.thinking ? 'enabled' : 'disabled' }`（`store.ts:1005`）。
→ **续写时 thinking 的取值是"原回答的 thinking"，不是当前 UI 开关**。

### 3.5 续写块怎么追加

`applyEvent`（`reply.ts:72-137`）的机制：

- 参数带一个**本次请求的** `blockIndexes: Map<事件 index, 全局 blocks 下标>`；
- `content_block_start`：`blockIndexes.set(event.index, next.blocks.length)`，然后 `blocks: [...next.blocks, block]`（`reply.ts:83-92`）——因为起始 `reply` 已经带着旧 blocks，所以**新块天然追加在旧块之后**；
- `content_block_delta` 按映射写回对应块；`content_block_stop` 给 thinking 补 `endedAt`；
- `content_block_start` 若收到 `tool_use`（客户端工具）→ `prefix: false`（`reply.ts:86-89`，续写不可再用）；
- 结束 `settleReply`（`reply.ts:143-160`）；用户停止 → `settleReply(reply,'stopped',...)`（`store.ts:1037-1040`）。

### 3.6 什么情况下**不**出现「继续生成」（回归清单）

1. 回答是 `error`（报错）；
2. `stopReason === 'refusal'`；
3. `stopReason === 'tool_use'`，或 blocks 里存在 `server_tool_use`/`web_search_tool_result`/`web_fetch_tool_result`（**开了联网搜索并真的搜了**）；
4. 回答里含 `isTemplate` 的服务端提示文本；
5. 不是最后一条消息；
6. 正在生成（`busy`）；
7. 导入的历史回答（`prefix:false`）。

---

## 4. 继续生成：落到 client.js

### 4.1 现状快照

| 已有 | 位置 |
| --- | --- |
| `AssistantMessage` 已接 `canContinue` / `onContinue`，按钮 `t('continueGenerating')` | `client.js` `AssistantMessage`（底部 `.dsc-botFoot` 最后一个按钮） |
| 线程渲染已传 `canContinue: canContinueReply(message)` / `onContinue: () => continueReply(active, message)` | `client.js` `ChatPanel` 线程渲染处 |
| `ChatPanel.continueReply(conversation, message)` 已存在：算 index、`messages.slice(0, index-1)`、push assistant prefill、`patchVersion` 置 streaming、`runReply(..., {initialBlocks})` | `client.js` `ChatPanel.continueReply` |
| `runReply` 支持 `options.initialBlocks` 并据此追加块 | `client.js` `runReply`（`let blocks = options && options.initialBlocks ? options.initialBlocks.slice() : []`） |

**`canContinueReply` 已有初版**（`client.js` 的 `function canContinueReply(message)`，与 `TOP_UP_URL`、`describeReply` 相邻）。它已经覆盖了 `status/stopReason/工具块` 三类条件，但与 demo 相比还差 3 点，按 §4.2/§4.3 校准：

| 差距 | 现状 | 要求 |
| --- | --- | --- |
| C1 | 不检查 prefill 是否有非空白正文 | 空白 prefill 会被服务端拒绝；demo 有守卫（`src/services/chat/reply.ts:332-338`）。`canContinueReply` 末尾要加 `Boolean(assistantPrefillText(blocks).trim())` |
| C2 | `continueReply` 的 prefill 用 `assistantText(message)`（所有文本块 `''` 硬拼） | 被思考/工具隔开的正文要用 `'\n\n'` 连接 → 改用 §4.3 的 `assistantPrefillText(blocks)` |
| C3 | 不排除 `text.isTemplate` | 我们目前不写 `isTemplate`，可接受；若将来写入模板块必须补判 |

（本节其余内容即为该函数的判定基线，实现已有则逐条对照，不要另写一个同名的。）

### 4.2 校准 `function canContinueReply(message)`（已有初版，按本节定稿）

放在 `client.js` 的工具区（与 `assistantText`、`patchVersion` 同段），**纯函数、不依赖 React**：

```js
/**
 * Whether one finished reply may be continued with an assistant prefill.
 * Mirrors the demo's canContinueReply (demo:src/services/chat/reply.ts:172-191)
 * on this panel's flatter block model.
 */
function canContinueReply(message) {
  if (!message || message.role !== 'assistant') return false;
  if (message.status === 'stopped') {
    // allowed below once the block checks pass
  } else if (!(message.status === 'done' && message.stopReason === 'max_tokens')) {
    return false;
  }
  if (message.error) return false;
  if (message.stopReason === 'refusal' || message.stopReason === 'tool_use') return false;
  const blocks = message.blocks || [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block) continue;
    // Our fold maps the service tool blocks onto 'tool' / 'sources' / 'fetch';
    // any of them means the turn used a server tool and cannot be a prefix.
    if (block.type === 'tool' || block.type === 'sources' || block.type === 'fetch') return false;
    if (block.type === 'text' && block.isTemplate) return false;
  }
  return Boolean(assistantPrefillText(blocks).trim());
}
```

字段映射（demo → 我们）：

| demo 条件 | 我们的等价物 | 备注 |
| --- | --- | --- |
| `reply.prefix` | 无字段；`loadConversations` 里所有 assistant 都是本插件生成 → 视为 true | 若要支持"导入备份后不可续写"，在消息上加 `prefix` 并在 `loadConversations` 读入（可选） |
| `stopReason === 'refusal' / 'tool_use'` | 同名字段已存于版本槽 | `patchVersion` 已持久化 `stopReason` |
| `server_tool_use` / `web_search_tool_result` / `web_fetch_tool_result` | 折叠后的 `tool` / `sources` / `fetch` 块 | 见 `sanitizeBlocks` 的块类型 |
| `text.isTemplate` | 我们的拒绝提示不入 blocks（按 `stopReason` 展示）→ 保留判断以防将来写入 | |
| `status==='stopped' \|\| (done && max_tokens)` | 完全相同 | `stopReason` 只在 `message_delta` 收到时写（`runReply`） |
| 末条 | 调用点已保证 `isLast`/`!busy`；再在 `continueReply` 里校验 `index === messages.length - 1` | |

⚠️ `patchVersion` 写版本槽时用的是 `Object.assign({}, versions[index], patch)`，`stopReason: ''` 是**空字符串**不是 `undefined`；判定要用 `=== 'max_tokens'` / `=== 'stopped'` 这种正向比较，不要写 `!message.stopReason` 的反向逻辑。

### 4.3 新增 `function assistantPrefillText(blocks)`

demo 的 prefill 是**内容块数组**（文本块可能被 `'\n\n'` 分隔），我们的存储块更简单，但**不能**直接复用 `assistantText()`（它把文本块用 `''` 硬拼，会丢段落）。

```js
/** Join the answer text the way the demo builds an assistant prefill:
 *  consecutive text blocks concatenate; a run that was separated by a
 *  thinking/tool block is joined with a blank line. */
function assistantPrefillText(blocks) {
  const parts = [];
  let current = '';
  let open = false;
  for (let i = 0; i < (blocks || []).length; i += 1) {
    const block = blocks[i];
    if (block && block.type === 'text') {
      current += String(block.text || '');
      open = true;
      continue;
    }
    if (open) { parts.push(current); current = ''; open = false; }
  }
  if (open) parts.push(current);
  return parts.filter((part) => part.trim()).join('\n\n');
}
```

### 4.4 prefill 怎么放进请求（改写 `ChatPanel.continueReply`）

现状（`ChatPanel.continueReply`）：

```js
const request = requestMessages(messages.slice(0, index - 1), question, t('send') === 'Send');
request.push({ role: 'assistant', content: [{ type: 'text', text: assistantText(message) }] });
```

按 demo 语义改成：

```js
const text = assistantPrefillText(message.blocks);
if (!text.trim()) return;                       // 等价 demo 的空 prefill 守卫
request.push({ role: 'assistant', content: [{ type: 'text', text }] });
```

- `index` 必须用 `messages.length - 1` 语义校验（最后一条）；
- `history` 用 `messages.slice(0, index - 1)`（不含最后两条），与 demo `path.slice(0,-2)` 一致；
- **不要**把 `requestMessages` 里已有的 `latest_reminder` 去掉；
- 续写请求的 `thinking` 传当前 `settings.thinking`（我们的 `streamMessage` 只接受全局 `settings`），与 demo"沿用原回答开关"有差异 —— 记在 §4.6。

### 4.5 thinking 开启时的两条走法（必须选一条写进代码注释）

| 走法 | 做法 | 风险 |
| --- | --- | --- |
| A（**本期采用**） | prefill 只放**正文文本**，thinking 块不进 prefill；请求体仍按当前 `settings.thinking` 发 `thinking: {type:'enabled'}` | 与 demo 不同（demo 会带 signature）；若服务端对"assistant prefill + thinking enabled"要求带 thinking 块，可能 400 |
| B（Phase 2） | 先补数据：`applyStreamEvent` 保存 `signature_delta` 到块上，`sanitizeBlocks` 保留 `signature`；再按 demo 把 `{type:'thinking', thinking, signature}` 放进 prefill 的 content 里 | 需要迁移历史数据（旧块无 signature） |

A 的降级策略（必须有）：`runReply` 抛错且 `status === 400` 且错误信息里出现 `thinking|prefill|assistant`（大小写不敏感）时，**自动去掉 prefill 重试一次**（不带 assistant 尾条重发），并把失败信息写进 `message.error` 仅在重试也失败时。实现位置：`ChatPanel.runReply` 的 catch 之前包一层，或在 `continueReply` 里 `try/catch` 后调用 `send`-like 重建请求（推荐后者，`runReply` 保持无状态）。

### 4.6 仍需对齐/接受的差异

| 差异 | demo | 我们 | 处置 |
| --- | --- | --- | --- |
| thinking/搜索开关 | 沿用原回答快照（`store.ts:711-714`） | 只有全局 `settings` | 接受；若要做，消息上加 `thinking`/`search` 字段并在 `runReply` 逐条透传（改动大，不在本期） |
| `latest_reminder` | 沿用原回答快照（`store.ts:985-989`） | 每次 `requestMessages` 重新生成 | 接受（影响极小）；可选：消息上存 `reminder` 字段 |
| 块类型 | 保留原始协议块 | 折叠成 `tool/sources/fetch` | 已通过 §4.2 的块类型判断补偿 |
| 版本 | 不新建版本 | 不新建版本（`patchVersion` 就地改） | 一致 |

### 4.7 按钮与文案

- 位置：`AssistantMessage` 底部 `.dsc-botFoot`，放在「重新生成」之后（现有顺序：朗读 → 复制 → 重新生成 → 继续生成），只有 `canContinue` 为真时渲染；
- 生成中隐藏（`streaming` 时不渲染 foot）；`busy` 时禁用；
- 文案复用 `continueGenerating`：中文 `继续生成`（`src/i18n/zh.ts:32` 逐字），英文 `Continue`（`src/i18n/en.ts:36`）。不需要新增 key。
- 可选补充：`continueHint`（`接着这条回答继续生成` / `Keep generating this answer`）作为 `title`，但 demo 没有，**默认不加**。

---

## 5. 验收清单

**编辑**
1. 任意用户消息悬停出现「编辑消息」；最后一条常显；生成中不出现。
2. 点击后输入框预填该消息全文，光标全选；Esc 取消、不修改数据；Enter 或「发送」提交。
3. 编辑并发送后：该消息文本更新、其后的消息被删除、新回答流式生成、`editing` 清空、`dsc-editBar` 消失。
4. 原消息带附件、只删改文字并发送 → 允许发送（E1 修好后），附件仍是原附件。
5. 无 API Key 时点编辑发送 → 打开设置（不是静默失败）。
6. 刷新页面后编辑结果仍在（localStorage 已持久化，`conversations` 300ms 去抖写入）。

**继续生成**
7. 手动「停止生成」后，最后一条回答出现「继续生成」；点击后**不新增消息**，正文在原消息里继续增长。
8. 触发 `max_tokens` 截断后同样出现按钮（可用 `max_tokens` 很小的测试请求验证）。
9. 开了联网搜索并真的搜索的回答 → 无按钮。
10. 报错回答、拒答回答 → 无按钮。
11. 生成中、非最后一条 → 无按钮。
12. 点续写后新块追加在原块后（思考区仍在上方，不重复出现历史思考）。
13. 刷新页面后按钮状态不变（`stopReason` 已随版本槽持久化）。
14. thinking 开启时续写不报 400；若报 400 应自动降级重试一次并成功。

---

## 6. 最容易错的地方（按踩坑概率排序）

1. **把 demo 的"编辑"当成"截断"**：demo 是 `appendBranch` + 版本切换，一条都不删。我们的实现是真删，文案必须说明（§2.5）。
2. **`canContinueReply` 漏掉"含工具块"判定**：联网回答续写必 400（demo 专门有这条，`reply.ts:177-183`）。
3. **thinking 时照抄 demo 的 prefill**：demo 会把 `thinking + signature` 一起回传（`reply.ts:261-264`），我们**没有 signature**（`applyStreamEvent` 只处理 `thinking_delta`），照抄会被服务端拒绝。
4. **续写新建了版本槽或新消息**：会出现"1/N 版本"错乱、正文分裂成两条消息。
5. **`blockIndexes` 没清空**：续写时若沿用旧映射，新 `content_block_start` 会覆盖已有块。`runReply` 每次新建 `indexes`，不要提到组件级。
6. **`status`/`stopReason` 没写回版本槽**：刷新后按钮消失；必须走 `patchVersion`。
7. **编辑后没有立即清 `editing`**：重复点击发送会二次截断（index 已变，可能删错范围）。
8. **无 Key 时编辑发送静默 return**：必须走 `missingKey` 提示 + 打开设置（当前 `send()` 已有，别在编辑分支里提前 return 掉）。
