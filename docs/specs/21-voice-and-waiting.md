# 21 · 语音输入状态机与「等待态」三点动画

> 规格对象：`client.js` 输入区的麦克风按钮与录音状态（`toggleRecording` / `transcribe` / `stopRecorder` / `recState` / `recSeconds`），以及助手消息的等待指示（`AssistantMessage`）。
> 参照实现：原版 demo `deepseek-ai/chat-demo@5d5dd75`。
> 约定：demo 用 `src/...:行号`；`client.js` 只标函数 / state / CSS 类名，行号写 `≈`（工作区并行修改，行号会漂移）。
> 本文只写规格，不实施。

---

## 0. 结论摘要

1. demo 的录音状态机只有三个状态：`idle` / `recording` / `transcribing`（`useVoiceInput.ts:8`）。**`recording` 在点击瞬间就置位**，不等 `getUserMedia` 授权返回（`useVoiceInput.ts:111-112`），所以“授权弹窗未决时再点一次 = 取消”是内建行为。
2. 每个状态都有**逐字文案**，分别出现在 tooltip / `aria-label` 与按钮左侧读秒上：`语音输入`、`结束录音并转写`、`正在转写，点击取消`、`录音中 {seconds}s`、`非 HTTPS 页面无法使用语音输入`（`zh.ts:150-160`，`VoiceButton.tsx:28-40`）。
3. 转写中**必须可取消**：demo 的切换函数在 `transcribing` 时走 `cancel()`（`useVoiceInput.ts:107-110`），插件现在把按钮 `disabled` 掉是错的。
4. 错误/边界共 6 类，判定与文案固定：权限拒绝、无设备、识别失败、识别为空、到达时长上限、非安全上下文。**`voiceInputTooLong`（录音过长，请缩短后重试）在 demo 里没有任何调用点**，是备用文案，不要接进当前流程。
5. 上限：demo 录音器 `MAX_SECONDS = 120`（`recorder.ts:9`），到达上限回调里 toast `已达到单次录音时长上限` 并自动结束转写（`useVoiceInput.ts:114-119`、`recorder.ts:72-76`）。插件现有 `RECORDING_LIMIT_SECONDS = 110` + 文案「录音已自动停止（110 秒）」——建议**保留 110 s 安全余量、换掉文案**。
6. 等待态是**三点透明度呼吸**（不是跳动、不是打字机）：3 个 6 px 圆点、`gap:6px`、容器高 34 px、颜色 `--dsw-alias-label-dimmed`、`fading 0.9s linear infinite`、第 2/3 点延迟 0.1/0.2 s（`AssistantMessage.module.css:14-47`）。出现条件是：流式中 + 没有工具步骤 + 没有正文 + **本条回复没开思考模式**（`AssistantMessage.tsx:57`）。
7. 插件落点：录音用现有 `recState`/`recSeconds`/`toggleRecording`/`transcribe` + `RECORDING_LIMIT_SECONDS`；文案补进 `zh`/`en` 字典；按钮视觉按 demo 换成“品牌色双层圆 + 呼吸光圈”，删掉现有红点 `.dsc-recDot`；等待态加在 `AssistantMessage` 的正文前。

---

## 1. demo 的实现事实

### 1.1 状态机

```
              click
   ┌──────┐ ────────► ┌───────────┐ click / 到达上限 ┌──────────────┐
   │ idle │           │ recording │ ───────────────► │ transcribing │
   └──────┘ ◄──────── └───────────┘                  └──────────────┘
      ▲  授权失败/启动失败/取消            click（取消） │      ▲
      │                                             │      │
      └─────────────────────────────────────────────┴──────┘
                              成功 → 写入草稿；空/失败 → 提示后回 idle
```

| 迁移 | 触发 | 实现细节 | 出处 |
| --- | --- | --- | --- |
| idle → recording | 点击按钮 | **先** `setStatus('recording')`，**后** `await startRecording()`；用 `operationRef` 令牌识别“授权期间被取消” | `useVoiceInput.ts:111-124` |
| recording → transcribing | 再次点击 | `finish()`：先 `await recording.stop()`；停完才 `setStatus('transcribing')` | `useVoiceInput.ts:55-78`（77 行置位） |
| recording → transcribing（自动） | 录满上限 | recorder 的 `onLimit` 回调：toast 上限文案 + `void finish()` | `useVoiceInput.ts:114-119`；`recorder.ts:66-76` |
| transcribing → idle（取消） | 再次点击 | `cancel()`：递增令牌、`recording.cancel()`、`controller.abort()`、`setStatus('idle')` | `useVoiceInput.ts:42-53`、`107-110` |
| transcribing → idle（成功） | ASR 返回 | 文本 trim 后非空 → 回调写入输入框；空 → toast 空文案 | `useVoiceInput.ts:78-86` |
| transcribing → idle（失败） | 抛错 | 非用户取消时 toast 失败文案 | `useVoiceInput.ts:87-96` |
| 任意 → idle | 组件卸载/切会话 | 卸载 cleanup 调 `cancelOperation`；切会话由 `ChatInput` 额外订阅取消 | `useVoiceInput.ts:146`；`ChatInput.tsx:117-127` |

关键细节（易漏）：

* 授权未决时按钮已经显示“录音中”，秒表也在走（状态先置位）；此时再点走 `finish()`，`recordingRef.current` 还是 null → 直接 `cancel()`，迟到的录音对象自己 `cancel()` 释放（`useVoiceInput.ts:55-61`、`120-123`）。
* 转写结果回来时检查 `controller.signal.aborted || operationRef.current !== operation`，取消后**绝不写入草稿**（`useVoiceInput.ts:79-81`）。
* `finish()` 的 `finally` 只在令牌未变时 `setStatus('idle')`，避免取消后旧任务把新录音重置（`useVoiceInput.ts:91-96`）。

### 1.2 每个状态的 UI / 文案 / 按钮样式 / 读秒 / 点击行为

| 状态 | tooltip + `aria-label` | 按钮外观 | 左侧读秒 | 点击行为 | 出处 |
| --- | --- | --- | --- | --- | --- |
| `idle` | `语音输入` | 34×34 透明圆形按钮 + 麦克风描边图标，文字 `--dsw-alias-label-primary` | 无 | 开始录音 | `VoiceButton.tsx:36`、`71-72`；`VoiceButton.module.css:19-48` |
| `recording` | `结束录音并转写` | 26×26 内层实心品牌色圆（`opacity .75`）+ 外层 26×26 半透明光圈（`opacity .2`，呼吸）+ 白色麦克风实心图标 | `录音中 {seconds}s` | 结束录音并转写 | `VoiceButton.tsx:32-33`、`40`、`58-68`；CSS `55-96`、`98-141` |
| `transcribing` | `正在转写，点击取消` | 14×14 旋转 spinner（1.5 px 描边，顶部高亮） | 无 | **取消**（abort） | `VoiceButton.tsx:34-35`、`69-70`；CSS `159-173` |
| 非安全上下文 | `非 HTTPS 页面无法使用语音输入` | 按钮置灰（`color:--dsw-alias-label-caption`、`cursor:not-allowed`），点击无效 | 无 | 无 | `VoiceButton.tsx:30-31`、`44-56`；CSS `50-53`；`useVoiceInput.ts:14`、`100-102` |

读秒：

* 文案模板 `录音中 {seconds}s`（`zh.ts:151`），插值由 `useTranslate` 的 `{name}` 替换完成（`src/i18n/index.ts:17-23`），例如 `录音中 3s`。
* 秒数来源：`status === 'recording'` 时每 **500 ms** 刷新 `floor((Date.now()-startedAt)/1000)`（`useVoiceInput.ts:133-144`）。
* 位置：按钮**左侧**独立 `<span>`（`VoiceButton.tsx:40`），12 px / 17 px / `--dsw-alias-label-caption` / `tabular-nums`（CSS `1-11`）。
* 窄屏隐藏：`@media not all and (min-width: 768px) { .timer { display:none } }`（CSS `13-17`）。

按钮动效细节（做等价实现时的数值）：

| 层 | 几何 | 颜色/透明度 | 动画 |
| --- | --- | --- | --- |
| `.halo` | `inset:0`（26×26 圆） | `--dsw-alias-brand-primary`，`opacity:.2` | `haloEnter .15s ease-out both`，随后 `haloBreath 1.8s ease-in-out .15s infinite`（scale 1→1.1→1） |
| `.core` | `inset:2px`（22×22 圆） | 同色，`opacity:.75` | `coreEnter .2s ease-out .14s both`（scale .6→1） |
| `.outline`（原描边 mic） | 居中的 16 px 图标 | 品牌色 | `fadeOut .12s ease-out .14s both` |
| `.glyph`（实心 mic） | 相对定位、压在最上 | `--dsw-static-neutral-bluish-00` | `fadeIn .1s ease-out .26s both` |

`prefers-reduced-motion: reduce` 时：`halo/core/glyph` 动画关闭、`outline` 直接 `display:none`、`halo` `scale:none`（`VoiceButton.module.css:143-157`）。也就是说**降级帧是：实心品牌圆 + 白色 mic，没有光圈呼吸**。

### 1.3 错误与边界判定（完整表）

| 场景 | 判定条件 | 文案（逐字） | 呈现 | 出处 |
| --- | --- | --- | --- | --- |
| 非 HTTPS / 非安全上下文 | `!window.isSecureContext` | `非 HTTPS 页面无法使用语音输入` | 按钮置灰 + tooltip；点击直接 return，不 toast | `useVoiceInput.ts:14`、`100-102`；`VoiceButton.tsx:30-31` |
| 权限拒绝 | `DOMException` 且 `name` 是 `NotAllowedError` 或 `SecurityError` | `无法使用麦克风，请在浏览器设置中允许访问` | toast 3 s | `useVoiceInput.ts:17-20` |
| 无设备 | `DOMException` 且 `name === 'NotFoundError'` | `未检测到麦克风` | toast 3 s | `useVoiceInput.ts:21-23` |
| 其他录音启动失败 | 其余异常（含 `OverconstrainedError`、无 `mediaDevices`） | `语音识别失败，请稍后再试` | toast 3 s | `useVoiceInput.ts:16-26` |
| 到达单次时长上限 | 录音回调 `onLimit`（采满 `MAX_SECONDS`，demo 120 s） | `已达到单次录音时长上限` | toast + 自动结束并转写 | `useVoiceInput.ts:114-119`；`recorder.ts:9`、`72-76` |
| 识别失败 | `transcribe` 抛错且不是用户取消 | `语音识别失败，请稍后再试` | toast 3 s | `useVoiceInput.ts:87-90` |
| 识别为空 | 返回文本 `trim()` 为空 | `未识别到语音内容` | toast 3 s，不写草稿 | `useVoiceInput.ts:82-86` |
| “录音过长” | **demo 无此路径** | `录音过长，请缩短后重试`（`zh.ts:156`，无调用点） | — | 全仓检索仅 i18n 定义，无引用 |

toast 规格：同一时间只显示一条，新的替换旧的，默认 3 s 自动消失（`src/components/base/toastState.ts:9-18`）。

### 1.4 时长上限与录音器（只列与本规格相关的部分）

| 事实 | 出处 |
| --- | --- |
| `SAMPLE_RATE = 16000`、`MAX_SECONDS = 120`、`BUFFER_SIZE = 4096` | `recorder.ts:7-11` |
| 采到 `MAX_SECONDS * SAMPLE_RATE` 个样本时置 `limited` 并调 `onLimit()`；之后不再收集 | `recorder.ts:66-76` |
| `stop()`：释放资源；一个样本都没采到返回 `null`（于是 `finish()` 静默回 idle，不算失败） | `recorder.ts:86-90`；`useVoiceInput.ts:66-74` |
| 取消：断开节点 + 停所有 track + `context.close()`；节点断开失败也继续释放 | `recorder.ts:33-53` |
| 输出 WAV：单声道 16-bit PCM 16 kHz | `recorder.ts:100-132` |
| ASR 接口约束：≤120 s、≤8 MiB，`audio` 字段为 WAV 或 Ogg Opus | `src/services/api/speech.ts:16`、`22-29` |

> 插件现状用 `MediaRecorder`（ogg/webm）+ 必要时在浏览器里重编码成 16 kHz WAV（`encodeWav`），上限 110 s。这属于实现差异，**本规格不要求换回 ScriptProcessor**；只要求状态机、文案、取消与上限行为对齐。

### 1.5 等待态三点动画

出现条件（`AssistantMessage.tsx:57`）：

```ts
const waiting = streaming && view.steps.length === 0 && !view.answer && !message.thinking
```

四项同时成立才显示：

1. 这条回复正在流式输出（`streaming`）；
2. 还没有任何工具步骤（`view.steps` 包含搜索/浏览等，见 `useReplyView` / `ReplyArea`）；
3. 还没有任何正文（`!view.answer`）；
4. **本条请求没有开启思考模式**（`message.thinking === false`）——思考模式会显示“正在思考”区域，两者互斥。

渲染（`AssistantMessage.tsx:79-85`）：正文位置渲染一个 `.waiting` 容器和 3 个 `.waitingDot`（`[0,1,2].map`）。

CSS（`src/components/messages/AssistantMessage.module.css`）：

| 选择器 | 值 | 行 |
| --- | --- | --- |
| `.waiting` | `display:flex; align-items:center; gap:6px; height:34px` | `14-19` |
| `.waitingDot` | `width:6px; height:6px; border-radius:50%; background:var(--dsw-alias-label-dimmed); animation:fading .9s linear infinite` | `21-27` |
| `.waitingDot:nth-child(2)` / `(3)` | `animation-delay:.1s` / `.2s` | `28-34` |
| `@keyframes fading` | `0%,100%{opacity:.3} 33%,66%{opacity:1}` | `37-47` |

要点：

* 是**透明度呼吸**，不是上下跳动、不是缩放、不是打字机；三点同相位错开 0.1 s。
* 容器高 34 px，和一条正文/操作行同高，避免出现时把下方内容顶跳。
* 没有 `aria-live`、没有文字；三点纯装饰。

---

## 2. 落在 `client.js` 的具体落点

### 2.1 文案字典（必须逐字）

在 `zh` / `en` 字典里处理（`client.js` 顶部；插件已有 `voiceInput/listening/transcribing/recordDenied/recordFailed/recordTooLong` 等键）。**目标值来自 `zh.ts:150-160`**：

| demo key | 中文（逐字） | 插件现有键/值 | 处理 |
| --- | --- | --- | --- |
| `voiceInput` | `语音输入` | `voiceInput: '语音输入'` | 保留 |
| `voiceInputTimer` | `录音中 {seconds}s` | 无（用 `recSeconds + 's'` 硬拼） | **新增**；显示时 `t('voiceInputTimer').replace('{seconds}', String(recSeconds))` |
| `voiceInputStop` | `结束录音并转写` | 无（用 `listening: '正在录音…点击结束'`） | **新增**并替换 tooltip/title |
| `voiceInputCancel` | `正在转写，点击取消` | 无 | **新增**（转写中 tooltip/title） |
| `voiceInputPermissionDenied` | `无法使用麦克风，请在浏览器设置中允许访问` | `recordDenied: '麦克风权限被拒绝'` | 替换文案 |
| `voiceInputNoDevice` | `未检测到麦克风` | 无（归到 recordFailed） | **新增**并接 `NotFoundError` 分支 |
| `voiceInputTooLong` | `录音过长，请缩短后重试` | 无 | 不接（demo 死文案；留作服务端判定过长时备用） |
| `voiceInputFailed` | `语音识别失败，请稍后再试` | `recordFailed: '无法启动麦克风'` | 替换文案（启动失败与识别失败共用此句，与 demo 一致） |
| `voiceInputEmpty` | `未识别到语音内容` | 无 | **新增** |
| `voiceInputLimitReached` | `已达到单次录音时长上限` | `recordTooLong: '录音已自动停止（110 秒）'` | 替换文案 |
| `voiceInputRequiresHttps` | `非 HTTPS 页面无法使用语音输入` | 无 | **新增**（禁用态 tooltip） |

en 字典同步补（可参考 demo `src/i18n/en.ts:159-169`）。旧的 `listening`/`transcribing` 键若不再引用可删，避免两套文案。

### 2.2 状态与行为改动（按现有符号）

| 落点（现有符号） | 现状 | 目标 |
| --- | --- | --- |
| `recState`（`'idle' | 'recording' | 'transcribing'`） | 已存在，三态 | 保持三态；**把 `setRecState('recording')` 提前到发起 `getUserMedia` 之前**，并加 `startingRef`/`opToken`，实现“授权弹窗未决时点击=取消” |
| `toggleRecording` | `if (recState !== 'idle') { stopRecorder(); return; }`；转写中这一步是空操作（`recRef` 已空） | 分状态：`recording` → 结束并转写；`transcribing` → **取消**（abort ASR + `setRecState('idle')`）；`idle` → 开始 |
| `transcribe(blob)` | `setRecState('transcribing')` → `transcribeAudio(...)`（**没传 signal**）→ `finally setRecState('idle')` | `transcribeAudio` 增加 `signal`；用 `AbortController` + 令牌；取消后不写草稿、不 setNotice；`finally` 只在令牌一致时回 idle |
| `stopRecorder` | 清 timer、`recorder.stop()`（onstop 里转写） | 保持；取消路径要额外 `stream.getTracks().stop()` + 清 chunks + 不触发转写 |
| `recSeconds` / timer | 500 ms 刷新，`>= RECORDING_LIMIT_SECONDS` 时 `setNotice(recordTooLong)` + stop | 保留 110 s 上限；文案换成 `voiceInputLimitReached`；到上限后自动结束并转写（与 demo 同一行为） |
| `RECORDING_LIMIT_SECONDS` | `= 110` | **保留 110**（ASR 服务上限 120 s，留 10 s 编码/上传余量）；在注释里写明这是对 demo 120 s 的有意偏离及理由 |
| `notice`（`setNotice`，4 s 自动消失） | 录音错误走面板内 notice 行 | 继续用 notice 承载这些提示（等价于 demo 的 toast；时长可保持 4 s，不必强改 3 s）；**文案必须是 2.1 的逐字值** |
| 安全上下文 | 无判断 | 新增 `const VOICE_AVAILABLE = typeof window === 'undefined' || window.isSecureContext;`；不可用时按钮 `disabled` + `title=t('voiceInputRequiresHttps')`；`toggleRecording` 直接 return |
| 设备能力 | 有 `!media || !getUserMedia || !MediaRecorder` 检查 → `recordFailed` | 保留检查，但文案按 2.1 改为 `voiceInputFailed`；`getUserMedia` 的错误映射按 1.3 的三分支（NotAllowed/Security、NotFound、其余） |
| 卸载/切会话 | 有 `stopRecorder`，但没有 abort ASR | 组件卸载 effect 里同时 `abortController.abort()`；切会话（`activeId` 变化）也取消，避免转写结果落到另一个会话的草稿 |

### 2.3 按钮视觉（CSS）

落点：CSS 模板串里的 `.dsc-tool` 系列（现有 `.dsc-tool[data-recording='true']` 与 `.dsc-recDot`）。目标（对齐 `VoiceButton.module.css`）：

```css
/* 录音中：品牌色双层圆 + 呼吸光圈；去掉红点 */
.dsc-tool[data-recording='true'] {
  position: relative;
  border-color: transparent;
  background: transparent;
  color: var(--dsw-static-neutral-bluish-00, #fff);
}
.dsc-tool[data-recording='true']::before,   /* 外层光圈 */
.dsc-tool[data-recording='true']::after {   /* 内层实心圆 */
  content: '';
  position: absolute;
  left: 50%; top: 50%;
  translate: -50% -50%;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  pointer-events: none;
}
.dsc-tool[data-recording='true']::before {
  width: 26px; height: 26px;
  opacity: .2;
  animation: dsc-halo-enter .15s ease-out both, dsc-halo-breath 1.8s ease-in-out .15s infinite;
}
.dsc-tool[data-recording='true']::after {
  width: 22px; height: 22px;
  opacity: .75;
  animation: dsc-core-enter .2s ease-out .14s both;
}
.dsc-tool[data-recording='true'] > svg {
  position: relative; z-index: 1;
  animation: dsc-fade-in .1s ease-out .26s both;
}
@keyframes dsc-halo-enter { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: .2; } }
@keyframes dsc-halo-breath { 0%,100% { scale: 1; } 50% { scale: 1.1; } }
@keyframes dsc-core-enter { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: .75; } }
@keyframes dsc-fade-in { from { opacity: 0; } }

/* 转写中：14×14 spinner */
.dsc-recSpinner {
  width: 14px; height: 14px; box-sizing: border-box;
  border-radius: 50%;
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  animation: dsc-spin .8s linear infinite;   /* dsc-spin 插件已有，可复用 */
}
@media (prefers-reduced-motion: reduce) {
  .dsc-tool[data-recording='true']::before,
  .dsc-tool[data-recording='true']::after,
  .dsc-tool[data-recording='true'] > svg { animation: none; }
  .dsc-tool[data-recording='true']::before { scale: none; opacity: .2; }
}
```

对应改动：

* 删除 `.dsc-recDot`（红点）及其 `dsc-pulse` 动画引用；录音中不再显示红点。
* 现有 `.dsc-tool[data-recording='true']` 的红色边框/红色底色/红色图标（`border-color: --dsw-alias-state-error-primary` 等）全部删除，改品牌色方案。
* 按钮尺寸沿用插件现有 `.dsc-tool`（高 34），伪元素几何按 demo 的 26/22 px 圆心对齐。
* 转写中：按钮 `disabled` 改为**不 disabled**，图标位置渲染 `.dsc-recSpinner`，`title/aria-label = t('voiceInputCancel')`，点击走取消。

### 2.4 按钮渲染（JSX 落点）

在 composer 工具栏的麦克风按钮（现有 `h('button', { className:'dsc-tool', 'data-recording': ..., title, disabled, onClick: toggleRecording, … }, recState === 'recording' ? recDot : MicIcon, label)`) 改成：

```js
const voiceLabel = !VOICE_AVAILABLE
  ? t('voiceInputRequiresHttps')
  : recState === 'recording'
    ? t('voiceInputStop')
    : recState === 'transcribing'
      ? t('voiceInputCancel')
      : t('voiceInput');

h('button', {
  type: 'button',
  className: 'dsc-tool',
  'data-recording': recState === 'recording' ? 'true' : 'false',
  'aria-pressed': recState === 'recording' ? 'true' : 'false',
  'aria-disabled': !VOICE_AVAILABLE ? 'true' : 'false',
  disabled: !VOICE_AVAILABLE,
  title: voiceLabel,
  'aria-label': voiceLabel,
  onClick: toggleRecording,
},
  recState === 'transcribing' ? h('span', { className: 'dsc-recSpinner' })
    : recState === 'recording' ? null            /* 图标用现有 MicIcon，样式由 ::before/::after 承担双层圆 */
      : h(MicIcon),
  recState === 'recording'
    ? h('span', { className: 'dsc-toolLabel' }, t('voiceInputTimer').replace('{seconds}', String(recSeconds)))
    : null)
```

说明：

* 读秒放在按钮内 `.dsc-toolLabel`（现有窄屏已隐藏 `.dsc-toolLabel`，等价 demo 的 <768 px 隐藏读秒）；若要与 demo 完全同构，可在按钮**前**加 `.dsc-recTimer` 并同步窄屏隐藏规则。
* 录音中按钮不再显示描边 mic → 用实心/白色显示（`> svg` 颜色由 CSS 覆盖），与 demo 的 `.outline`→`.glyph` 交叉淡入视觉接近；不要求逐帧复刻，只要求“品牌色双层圆 + 白色 mic + 呼吸”。
* 非安全上下文：`disabled` + `title`，不加 button 级 tooltip 组件（插件没有 demo 的 `Tooltip`，用原生 `title` 即可，现有工具按钮都这么写）。

### 2.5 等待态三点（落点与 CSS）

**出现条件**（写进 `AssistantMessage`）：

```js
// ChatPanel 传入 thinkingOn: settings.thinking !== 'off'
const { thinkingOn } = props;
const steps = buildSteps(blocks);                          // 已有
const hasBody = Boolean(answer.trim());                    // 已有
const waiting = streaming && steps.length === 0 && !hasBody && !thinkingOn;
```

**互斥处理（必须做，否则“正在思考”和三点会同时出现）**：

* 现有 `ReasoningArea` 在 `streaming` 时无论有没有步骤都会渲染头部，头衔兜底是 `正在思考`（`reasoningTitle` 的 `thinkingNow` 分支）。改为：
  ```js
  if (!steps.length && !(streaming && thinkingOn)) return null;
  ```
  这样：thinking 开 → 过程区显示“正在思考”，不显示三点；thinking 关且无步骤 → 过程区不渲染，三点独占等待位。
* `body` 的三元逻辑里，`streaming` 且无正文时**不要**再渲染 `.dsc-caret`，改为渲染三点容器（有正文时保留 caret 作为流式光标）：

  ```js
  const waitingDots = waiting
    ? h('div', { className: 'dsc-waiting', 'aria-hidden': 'true' },
        [0, 1, 2].map((index) => h('span', { key: index, className: 'dsc-waitingDot' })))
    : null;

  const body = source
    ? h('div', { className: 'dsc-botBody' }, renderMarkdown(...), streaming ? h('span', { className: 'dsc-caret' }) : null)
    : waitingDots || (streaming ? h('div', { className: 'dsc-botBody' }, h('span', { className: 'dsc-caret' })) : null);
  ```

**CSS**（加到 CSS 模板串；类名带 `dsc-` 前缀，keyframes 不要与现有 `dsc-blink`/`dsc-pulse` 撞名）：

```css
.dsc-waiting { display: flex; align-items: center; gap: 6px; height: 34px; }
.dsc-waitingDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-secondary));
  animation: dsc-fading .9s linear infinite;
}
.dsc-waitingDot:nth-child(2) { animation-delay: .1s; }
.dsc-waitingDot:nth-child(3) { animation-delay: .2s; }
@keyframes dsc-fading {
  0%, 100% { opacity: .3; }
  33%, 66% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .dsc-waitingDot { animation: none; opacity: .7; }
}
```

数值必须逐项对齐 demo：直径 6、间距 6、高 34、时长 .9 s、线性、无限循环、延迟 .1/.2 s、暗到亮再到暗的透明度曲线（.3 → 1 → .3，中间 1 的区间是 33%–66%）。颜色优先用 `--dsw-alias-label-dimmed`；插件现有 token 白名单里没有它（只有 `label-primary/secondary`），用 `var(--dsw-alias-label-dimmed, var(--dsw-alias-label-secondary))` 兜底，若 DSH 主题提供该 token 自动生效。

---

## 3. 验收清单与测试步骤

### 3.1 验收清单

- [ ] 未录音：麦克风按钮显示 `语音输入`；点击后立刻进入“录音中”外观（不等授权）。
- [ ] 录音中：按钮是品牌色双层圆 + 白色 mic + 光圈呼吸；左侧/按钮内显示 `录音中 Ns`，每 0.5 s 递增；tooltip/`aria-label` 是 `结束录音并转写`。
- [ ] 录音中再点：结束并进入转写；转写中显示 spinner，tooltip 是 `正在转写，点击取消`，**按钮可点**，点击后立刻回到 idle，结果不写入草稿。
- [ ] 授权弹窗未决时再点：取消；随后授权通过也不会开始录音（麦克风 track 被释放）。
- [ ] 权限拒绝 → 提示 `无法使用麦克风，请在浏览器设置中允许访问`；无设备 → `未检测到麦克风`；其他启动失败 → `语音识别失败，请稍后再试`。
- [ ] 识别为空 → `未识别到语音内容`；识别失败 → `语音识别失败，请稍后再试`。
- [ ] 录满 110 s 自动停止并转写，提示 `已达到单次录音时长上限`。
- [ ] 非安全上下文（用局域网 http 地址打开 DSH）→ 按钮置灰、tooltip `非 HTTPS 页面无法使用语音输入`、点击无反应。
- [ ] 切会话/关面板：录音被释放、转写被 abort，不会往新会话写草稿。
- [ ] 等待态：think=off 的新提问在首个 token 前显示三点，正文出现后消失；think=high 时不显示三点而显示“正在思考”；三点与 caret 不同时出现。
- [ ] 三点在暗色主题下可见（颜色来自 token 或 fallback）。

### 3.2 手工测试路径

1. 首页新建对话，不填内容直接点麦克风 → 观察授权弹窗与按钮状态；重复点击验证“授权期取消”。
2. 系统设置里禁用麦克风权限 → 点麦克风 → 验证权限拒绝文案。
3. 用一条 2 分钟的长录音验证 110 s 自动停止与文案。
4. 录音时切到另一条会话再切回 → 确认已停止且草稿无残留。
5. 关掉 think（默认 think 为 high，需要先切到 OFF）发一条 `你好` → 首 token 前的等待态应为三点；再切 HIGH 发一条 → 应为“正在思考”。
6. DevTools → Rendering → Emulate `prefers-reduced-motion: reduce` → 三点变静态、录音光圈不呼吸。

---

## 4. 与当前工作区实现的偏差（快照，仅供自查）

> 工作区已被并行修改，以下只按稳定符号列差异，不引用行号。

| 项 | demo 规格 | 快照实现 | 处理 |
| --- | --- | --- | --- |
| 录音中文案 | `结束录音并转写` | `listening: '正在录音…点击结束'` | 换文案，用 `voiceInputStop` |
| 转写中文案 | `正在转写，点击取消` | `transcribing: '正在识别语音…'`；按钮 disabled | 换文案；去掉 disabled，点击取消 |
| 读秒 | `录音中 {seconds}s` | 裸 `N + 's'` | 换模板文案 |
| 权限拒绝 | `无法使用麦克风，请在浏览器设置中允许访问` | `麦克风权限被拒绝` | 换 |
| 无设备 | `未检测到麦克风` | 无单独分支 | 补 `NotFoundError` 分支 |
| 启动失败 | `语音识别失败，请稍后再试` | `无法启动麦克风` | 换 |
| 到达上限 | `已达到单次录音时长上限` | `录音已自动停止（110 秒）` | 换；保留 110 s |
| 非 HTTPS | 禁用 + `非 HTTPS 页面无法使用语音输入` | 无判断 | 新增 `isSecureContext` 门禁 |
| 授权期取消 | 支持（状态先置 recording + 令牌） | 先 `await getUserMedia` 再置状态；授权期再点会重复发起 | 改状态置位顺序 + 令牌 |
| 转写取消 | 支持（AbortController） | 无 signal、无取消路径 | 补 AbortController + 令牌 |
| 录音视觉 | 品牌色双层圆 + 呼吸 | 红色边框/底色 + 红点脉冲 | 按 2.3 换；删 `.dsc-recDot` |
| 等待态 | 三点呼吸 | 只有 `.dsc-caret` 光标（无三点） | 按 2.5 加 |

> 另外注意：工作区里中文曾出现乱码（例如某个 `'…'` 被写成 `'鈥?`），改文案时用 UTF-8 写入并**逐字**比对 `zh.ts`，不要用 PowerShell 默认编码读改写。

---

## 附录：录音器差异（仅备忘）

| 维度 | demo | 插件现状 | 是否要求对齐 |
| --- | --- | --- | --- |
| 采集 | `AudioContext({sampleRate:16000})` + `ScriptProcessorNode`，直接得 PCM | `MediaRecorder`（ogg/webm）→ 非 ogg 时用 `OfflineAudioContext` 重采样成 16 kHz WAV | 否（能过 ASR 即可） |
| 上限 | 120 s（采满即回调） | 110 s（定时器判断） | 否；保留 110 但文案/行为对齐 |
| 取消 | 断节点 + 停 track + close | 停 recorder + 停 track；**缺 abort ASR** | 是（补 abort） |
| 空录音 | 无样本 → `stop()` 返回 null → 静默回 idle | 空 blob → notice `recordFailed` | 建议对齐：空录音不报错，静默回 idle（demo 行为更合理） |
