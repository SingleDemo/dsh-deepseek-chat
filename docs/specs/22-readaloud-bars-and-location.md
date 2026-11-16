# 22 · 朗读按钮 / 波形动画 / 位置信息

> 规格对象：`client.js` 的朗读按钮（`toggleSpeak` / `speaking` / `speakPending` / `AssistantMessage` 底部操作行）、朗读波形（新增 `ReadingBars`）、位置设置（`SettingsDialog` / `loadSettings`）与请求里的 `latest_reminder`（`latestReminder` / `requestMessages`）。
> 参照实现：原版 demo `deepseek-ai/chat-demo@5d5dd75`。
> 约定：demo 用 `src/...:行号`；`client.js` 只标函数 / state / CSS 类名，行号写 `≈`（工作区并行修改，行号会漂移）。
> 本文只写规格，不实施。

---

## 0. 结论摘要

1. 朗读按钮三态是 **idle / loading / playing**（`readAloud.ts:13`）：idle 显示播放三角 + tooltip `朗读`；另外两态都显示波形并把 tooltip 换成 `停止朗读`（`ReadAloudButton.tsx:18-19`）。**loading 和 playing 都允许点击取消**——同一时间只读一条，点同一按钮 = 停止。
2. 波形是 **SVG + SMIL**（不是 CSS、不是 canvas）：4 根 2 px 条，间距 2 px，`viewBox 0 0 16 16`；playing 时每根条在 14→4→14 px 间以 1.6 s `ease-in-out` 往复，相邻相位差 0.4 s（0.25 周期），`height` 与 `y` 用同一 spline 同步，保证竖直居中（`ReadingBars.tsx:17-27`、`57-80`）。
3. 颜色：playing 用 `--dsw-alias-brand-primary`；loading 用 `--dsw-static-neutral-300`（暗色主题换 `--dsw-static-neutral-550`）并叠一层黑色扫光（`ReadingBars.module.css:5-21`、`311-313`）。`prefers-reduced-motion` 时显示静态帧高度 `[7,14,4,10]`（`ReadingBars.tsx:24`）。
4. 插件可在无构建环境用 **CSS-only 4 根 span** 等价实现（推荐）：同样的几何、时长、相位、颜色、reduced-motion 降级；不必移植 SMIL 的 `unpauseAnimations` 与时间容器。
5. 位置：demo 是 `{region, province?, city?}` 三级结构（`location.ts:13-17`），数据 34 省 / 392 市（含县级）/ 249 个国家地区（`locationData.ts`），只用于拼 `latest_reminder` 的**第三段**（`latestReminder.ts:19-30`）。
6. 插件采用**自由文本 + 默认空 + 写进第三段**的最小方案：设置里一个输入框（label `位置信息`，来自 `zh.ts:91`），存 `settings.location` 字符串，默认 `''`；`latestReminder()` 第三段填它（空也保留空段，5 段协议不变）；保存前 trim、去逗号/换行、限长 40。
7. 最容易踩的坑：① `latest_reminder` 用逗号分段，位置里出现逗号会直接把 5 段协议打坏；② 朗读只有 loading/playing 两态可点，loading 不能 disable；③ 波形相邻相位是 0.4 s 不是同步；④ 位置默认必须为空字符串（`''`），不能是 `null`/`undefined` 拼进 `join`。

---

## 1. 朗读按钮（ReadAloudButton）三态

### 1.1 状态与 UI

| 状态 | 何时进入 | 按钮内容 | tooltip / 可访问名 | 点击行为 | 出处 |
| --- | --- | --- | --- | --- | --- |
| `idle` | 初始；朗读结束；取消；报错 | 播放三角图标 `IconPlayMediaOutline16` | `朗读` | 开始朗读这条回复 | `ReadAloudButton.tsx:18`、`19`、`21-23`；`zh.ts:164` |
| `loading` | 点击后、首帧音频到达前（已 abort 旧的） | `ReadingBars mode="loading"`（4 根短条 + 扫光） | `停止朗读` | 停止（abort 请求） | `ReadAloudButton.tsx:15`、`18`、`19`；`readAloud.ts:93`、`128-130`；`zh.ts:165` |
| `playing` | 第一块 PCM 数据已排入 AudioContext | `ReadingBars mode="playing"`（波形） | `停止朗读` | 停止播放并释放 AudioContext | `readAloud.ts:128-130`、`132-136`；`zh.ts:165` |

实现事实：

* 状态是**全局单条**：`{ messageId, status }`，只有 `messageId` 与当前按钮匹配时才取真实状态，否则按 idle 渲染（`ReadAloudButton.tsx:15`）。
* 点击入口 `toggleReadAloud(messageId, text, onError)`（`ReadAloudButton.tsx:21-23`）：先 `stopReadAloud()` 停掉旧朗读；如果点的是**同一条**正在读的消息，就直接返回（等于停止）（`readAloud.ts:85-89`）。
* 状态流转：`setState({messageId, status:'loading'})` → 首个音频块开始排程时切 `playing`（`readAloud.ts:128-130`）→ 最后一个 buffer `onended` 时 `finish()` 回 idle（`132-136`）；任何错误 `finish()` + `onError`（`137-142`）。
* `AudioContext` 采样率 `24000`（`readAloud.ts:91`、`src/services/api/speech.ts:14`）；首帧前多缓冲 `START_DELAY = 0.1` s（`readAloud.ts:24`、`124`）。
* 停止：`stopReadAloud()` 需要时由发送、停止生成、重新生成等动作调用（`readAloud.ts:38-44`；`ChatInput.tsx:147`、`269`；`AssistantMessage.tsx:155`、`167`）。

### 1.2 错误文案映射

`describeReadAloudError`（`readAloud.ts:56-74`）→ 由按钮统一 `showToast(...)`（`ReadAloudButton.tsx:22`），toast 3 s：

| 分支 | 判定 | 文案（逐字） | 出处 |
| --- | --- | --- | --- |
| 协议错 | `ApiError.kind === 'protocol'` | 直接显示服务端返回的 message 原文 | `readAloud.ts:57-59` |
| 无法合成 | HTTP `400` | `这条回答暂时无法朗读` | `readAloud.ts:61-63`；`zh.ts:166` |
| Key 无效 | `classifyApiError === 'unauthorized'` | `API Key 无效，请更换后重试` | `readAloud.ts:65-66`；`zh.ts:161` |
| 余额不足 | `insufficientBalance` | `账户余额不足` | `readAloud.ts:67-68`；`zh.ts:162` |
| 限流 | `rateLimited` | `操作过于频繁，请稍后再试` | `readAloud.ts:69-70`；`zh.ts:163` |
| 其他 | 默认 | `朗读失败，请稍后再试` | `readAloud.ts:71-72`；`zh.ts:167` |

朗读接口本身：`POST /v1/tools/tts`，body `{text, voice_id, format:'pcm', filter_markdown:true}`，返回裸 PCM 流（`src/services/api/speech.ts:48-64`）；服务端负责过滤 Markdown。

---

## 2. 波形（ReadingBars）实现要点

### 2.1 是 SMIL，不是 CSS

| 事实 | 出处 |
| --- | --- |
| 文件头注释明确：playing 波形用 **SMIL** 同步改变 `rect` 的 `height` 与 `y`，保持圆角与竖直居中；两种高度极值之间 `ease-in-out` 插值；`prefers-reduced-motion` 时显示静态帧 | `ReadingBars.tsx:1-10` |
| SVG 在两个状态之间**保持挂载**，让 SMIL 时间轴连续（覆盖 Chromium 容器启动延迟）；挂载时调用 `unpauseAnimations()` 以确保 WebKit 时间轴启动 | `ReadingBars.tsx:7-9`、`36-40` |
| `loading` 态条是静态的（height 4），另叠 4 个黑色 `rect` 蒙层做扫光 | `ReadingBars.tsx:83-94`；CSS `15-21` |
| `playing` 态入场：整个 `<svg>` 走一次 `tts-settle`（scaleY .2857→1，0.15 s） | CSS `307-323` |
| reduced-motion 时：`playing` 分支不渲染 `<animate>`，用静态高度数组 `[7,14,4,10]`；CSS 同时把 `.playing`/`.sweep` 动画关掉 | `ReadingBars.tsx:24`、`52`、`57`；CSS `325-330` |

### 2.2 几何、时长、相位

| 项 | 值 | 出处 |
| --- | --- | --- |
| 画布 | `width=16 height=16 viewBox="0 0 16 16"` | `ReadingBars.tsx:46-49` |
| 条数 | 4 | `BAR_XS` |
| 条宽 / 间距 / 总宽 | 宽 `2`；x 坐标 `1,5,9,13` → 间距 `2`；总占宽 `14`，在 16 视口内居中 | `ReadingBars.tsx:17-18` |
| 圆角 | `rx = 1` | `ReadingBars.tsx:56`、`91` |
| playing 常态高度 | `14`（y=1） | `ReadingBars.tsx:52-54` |
| playing 波形极值 | `height 14 → 4 → 14`，`y 1 → 6 → 1`，同一 spline 同步 | `ReadingBars.tsx:60-80` |
| 周期 | `dur="1.6s"`，`repeatCount="indefinite"` | 同上 |
| 缓动 | `calcMode="spline"`，`keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"`（ease-in-out） | `ReadingBars.tsx:26-27`、`64-65` |
| 相位 | `begin` 依次 `0s / -1.2s / -0.8s / -0.4s`：相邻差 0.4 s = 0.25 周期，波从左往右传 | `ReadingBars.tsx:21` |
| loading 高度 | `4`（y=6） | `ReadingBars.tsx:52-54` |
| reduced-motion 静态高度 | `[7, 14, 4, 10]`（“换算到 4–14 档”） | `ReadingBars.tsx:24` |

### 2.3 颜色 token

| 元素 | 颜色 | 出处 |
| --- | --- | --- |
| playing 条 | `fill: var(--dsw-alias-brand-primary)` | `ReadingBars.module.css:311-313` |
| loading 条（浅色） | `fill: var(--dsw-static-neutral-300)` | `ReadingBars.module.css:5-7` |
| loading 条（暗色） | `[data-ds-dark-theme]` 下 `fill: var(--dsw-static-neutral-550)` | `ReadingBars.module.css:9-13` |
| loading 扫光蒙层 | `fill:#000`（字面黑，属于动画蒙层），`fill-opacity` 用 4 组高斯状 keyframes，峰值 `0.4`，`1.5s linear infinite` 依次从左扫到右 | `ReadingBars.module.css:15-305` |
| playing 入场 | `animation: tts-settle 0.15s cubic-bezier(0.22, 1, 0.36, 1)` | `ReadingBars.module.css:307-309` |

> 注意：demo 的扫光是“黑色蒙层 + 逐条高斯 keyframes”，不是渐变位移；四条 `tts-sweep-1..4` 的相位分别错开 1/4 周期，视觉上是高光从左向右扫过。

### 2.4 reduced-motion

* `usePrefersReducedMotion()`：`window.matchMedia('(prefers-reduced-motion: reduce)')`，监听变化，兼容旧 `addListener`（`ReadingBars.tsx:101-112`）。
* 降级效果：playing 显示固定高度 `[7,14,4,10]` 的静态条，没有波形；loading 的扫光 CSS 动画关闭（条仍在）。

---

## 3. 插件里的等价最小实现建议（无构建）

### 3.1 结论：用 CSS-only 4 根 span，不移植 SMIL

理由：

1. 无构建、`React.createElement` 里写 SMIL 可行但要 `<svg ref>` + `unpauseAnimations()` + 时间容器语义，跨状态挂载容易出错；CSS `@keyframes` 更短、无 ref、卸载即清。
2. 视觉要求只有“4 根条、两态、0.4 s 相位差、1.6 s 周期、品牌色”，CSS `transform: scaleY()` 完全能表达，且不触发布局。
3. 插件已有 `dsc-spin` 等 keyframes，继续用 CSS 与现有风格一致。

JSX（新增组件 `ReadingBars({ mode })`，`mode` 为 `'loading' | 'playing'`）：

```js
function ReadingBars(props) {
  const mode = props.mode === 'playing' ? 'playing' : 'loading';
  return h('span', { className: 'dsc-bars', 'data-mode': mode, 'aria-hidden': 'true' },
    [0, 1, 2, 3].map((index) => h('span', { key: index, className: 'dsc-bar' })));
}
```

CSS（放进 `CSS` 模板串；所有数值对齐 demo）：

```css
/* 16×16 视口内的 4 根条：宽 2、间距 2、总宽 14、圆角 1 */
.dsc-bars {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 16px;
  height: 16px;
  flex: none;
  vertical-align: -3px;
}

.dsc-bar {
  display: block;
  width: 2px;
  height: 14px;                 /* 基准高 14，用 scaleY 表达 4–14 */
  border-radius: 1px;
  transform-origin: center;
  background: var(--dsw-alias-brand-primary);
  will-change: transform;
}

/* ── playing：14→4→14，1.6s，ease-in-out，相位 0/-1.2/-0.8/-0.4 ── */
.dsc-bars[data-mode='playing'] { animation: dsc-bars-settle .15s cubic-bezier(.22, 1, .36, 1); }
.dsc-bars[data-mode='playing'] .dsc-bar {
  transform: scaleY(1);
  animation: dsc-bar-wave 1.6s cubic-bezier(.42, 0, .58, 1) infinite;
}
.dsc-bars[data-mode='playing'] .dsc-bar:nth-child(2) { animation-delay: -1.2s; }
.dsc-bars[data-mode='playing'] .dsc-bar:nth-child(3) { animation-delay: -.8s; }
.dsc-bars[data-mode='playing'] .dsc-bar:nth-child(4) { animation-delay: -.4s; }

@keyframes dsc-bar-wave {
  0%, 100% { transform: scaleY(1); }          /* 14px */
  50%      { transform: scaleY(.2857); }      /* 4px = 4/14 */
}
@keyframes dsc-bars-settle {
  from { transform: scaleY(.2857); }
  to   { transform: scaleY(1); }
}

/* ── loading：4 根 4px 短条 + 扫光蒙层 ── */
.dsc-bars[data-mode='loading'] { position: relative; overflow: hidden; }
.dsc-bars[data-mode='loading'] .dsc-bar {
  height: 4px;
  background: var(--dsw-static-neutral-300, var(--dsw-alias-label-secondary));
}
.dsc-bars[data-mode='loading']::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg,
    transparent 0%,
    var(--dsw-alias-bg-base) 45%,
    var(--dsw-alias-bg-base) 55%,
    transparent 100%);
  opacity: .55;
  transform: translateX(-100%);
  animation: dsc-bars-sweep 1.5s linear infinite;
}
@keyframes dsc-bars-sweep {
  to { transform: translateX(100%); }
}

@media (prefers-reduced-motion: reduce) {
  .dsc-bars[data-mode='playing'],
  .dsc-bars[data-mode='playing'] .dsc-bar,
  .dsc-bars[data-mode='loading']::after { animation: none; }
  /* demo 的静态帧 [7,14,4,10] ÷ 14 */
  .dsc-bars[data-mode='playing'] .dsc-bar { transform: scaleY(1); }
  .dsc-bars[data-mode='playing'] .dsc-bar:nth-child(1) { transform: scaleY(.5); }
  .dsc-bars[data-mode='playing'] .dsc-bar:nth-child(3) { transform: scaleY(.2857); }
  .dsc-bars[data-mode='playing'] .dsc-bar:nth-child(4) { transform: scaleY(.714); }
  .dsc-bars[data-mode='loading']::after { display: none; }
}
```

说明：

* 相邻相位沿用 demo 的负延迟 `-1.2s / -0.8s / -0.4s`（第 1 根 0）。
* loading 的扫光用“背景色半透明渐变横移”近似 demo 的黑色高斯蒙层：浅色/暗色主题都成立（背景色 token 会跟着主题变），比写死黑色安全；若要求更接近 demo，可改成 4 条独立的 `opacity` keyframes，但复杂度不值得。
* 高度用固定 14 px + `scaleY`，避免动画 `height` 造成每帧布局。
* 暗色主题不额外处理：playing 用品牌色不变；loading 的 `--dsw-static-neutral-300` 若在 DSH 暗色下不存在或过亮，用 `var(--dsw-static-neutral-300, var(--dsw-alias-label-secondary))` 兜底即可（插件现有 token 白名单里没有 static 系列）。
* 若坚持要 SMIL 逐帧一致：`h('animate', { attributeName:'height', values:'14;4;14', keyTimes:'0;0.5;1', calcMode:'spline', keySplines:'0.42 0 0.58 1;0.42 0 0.58 1', dur:'1.6s', begin: WAVE_BEGINS[i], repeatCount:'indefinite' })` 可原样移植 `ReadingBars.tsx:57-80`，但需要 `ref` + `unpauseAnimations()`（`36-40`），不推荐作为第一版。

### 3.2 朗读按钮落点（现有符号）

| 落点 | 现状 | 目标 |
| --- | --- | --- |
| `AssistantMessage` 底部操作行 | `h('button', { className:'dsc-plainAction', disabled: speakPending, title: speaking ? t('stopReading') : t('speak'), onClick: onSpeak }, speaking ? t('stopReading') : speakPending ? '…' : t('speak'))` | 文案/图标改为三态：idle 播放三角 + `朗读`；loading/playing 显示 `<ReadingBars mode>` + `停止朗读`；**去掉 `disabled: speakPending`**（loading 必须可点取消） |
| `speaking` / `speakPending` | state（`ttsId` / `ttsPendingId`）已存在 | 组合成 `mode`：`speakPending ? 'loading' : speaking ? 'playing' : 'idle'` |
| `toggleSpeak(message)` | `if (!message \|\| ttsPendingId) return;`（loading 中点了无效） | 去掉 `ttsPendingId` 早退：loading 中点同一按钮要 `stopSpeak()`（abort TTS 请求） |
| `stopSpeaking` | 停 `Audio`、revoke URL、`setTtsId(null)` | 同时 `setTtsPendingId(null)`；abort `synthesizeSpeech` 的 fetch（补 `AbortController`） |
| 文案 | `speak: '朗读'`、`stopReading: '停止朗读'`、`speakFailed: '语音合成失败'` | `朗读` / `停止朗读` 保留；错误文案换成 1.2 的 demo 值（见下表） |
| 错误处理 | catch 里 `setNotice(speakFailed)` | 按 1.2 映射：400 → `这条回答暂时无法朗读`；401/余额/限流 → 对应文案；其他 → `朗读失败，请稍后再试`；协议错 → 服务端 message |

需要补的文案（`zh.ts` 逐字）：

| demo key | 中文 | 插件处理 |
| --- | --- | --- |
| `ttsPlay` | `朗读` | 已有 `speak`，保留（值相同） |
| `ttsStop` | `停止朗读` | 已有 `stopReading`，保留（值相同） |
| `ttsUnavailable` | `这条回答暂时无法朗读` | **新增**（400 分支） |
| `ttsFailed` | `朗读失败，请稍后再试` | **新增**，替换 `speakFailed: '语音合成失败'` |
| `apiKeyInvalidRetry` | `API Key 无效，请更换后重试` | 可复用现有 `noticeInvalidKey` 的句式，但值不同（现有是 `API Key 无效或已被删除，请更换后重试。`）——按 demo 新增独立键 |

---

## 4. 位置信息

### 4.1 demo 的数据结构、归一化、UI

**结构**（`src/services/location.ts:13-17`）：

```ts
export type UserLocation = {
  region: string        // 必填，国家/地区代码（ISO 3166-1 alpha-2 风格，如 CN/US/JP）
  province?: string     // region === 'CN' 时可选
  city?: string         // 有 province 时可选
}
```

**归一化**（`location.ts:30-54`），所有写入都必须过它：

| 输入 | 结果 |
| --- | --- |
| 非对象 / 数组 / null | `null` |
| `region` 不在 `regionCodes` 里 | `null`（非法整条丢弃） |
| `region !== 'CN'` | `{ region }`，**丢掉** province/city |
| `CN` 且没有 province | 有 city → `null`；否则 `{ region }` |
| `CN` + province 不在省份列表 | `null` |
| `CN` + province + 无 city | `{ region, province }` |
| `CN` + province + city 不在该省城市列表 | `null` |
| 其余 | `{ region, province, city }` |

**数据规模**（`src/services/locationData.ts`，文件 452 行 / 13,209 B）：

| 数据 | 规模 | 行号 | 说明 |
| --- | --- | --- | --- |
| `provinceNames` | **34** 条 | `1-36` | 省/直辖市/自治区/特别行政区，编码如 `110000` 北京、`440000` 广东、`810000` 香港 |
| `cityNames` | **392** 条 | `38-431` | 地级市为主；台湾省把县级也平铺进来了（如 `710500` 金门县） |
| `regionCodes` | **249** 个 | `433-439` | ISO 国家/地区码，`CN` 在列 |
| `regionNameOverrides` | 3 个码 × 2 语言 | `441-452` | TW/HK/MO 的固定中文名与英文名（如 `TW: '中国台湾'`） |

**省-市关系**：按城市编码前两位匹配省份编码前两位（`location.ts:8-9`，`city.startsWith(code.slice(0, 2))`），没有单独层级字段。

**地区名**：`getRegionName(code, locale)` 用 `Intl.DisplayNames(['zh-CN'|'en-US'], {type:'region'})`，境外码可用 `regionNameOverrides` 覆盖（`location.ts:19-28`）。

**持久化与默认值**（`settings.ts`）：`location` 存在本机设置里（类型 `15` 行，localStorage key `chat-demo:location` 在 `25` 行）；`initialLocation()`（`65-79`）：解析失败 → `null`；浏览器语言是中文且 `region==='CN' && province` → 保留完整值，否则中文浏览器下只认“有省的 CN”，非中文浏览器只保留 `{region}`。

**设置 UI**（`SettingsDialog.tsx:208-270`，挂在「通用设置」tab 的 `99-102`）：按**浏览器语言**（`isChineseBrowser()`，`settings.ts:53-55`）二选一：

* 中文浏览器：省下拉（`settingsLocationProvince`）+ 市下拉（`settingsLocationCity`），省变更时 `setLocation({region:'CN', province})`，市变更时带上 province（`226-252`）。
* 其他浏览器：国家/地区下拉（`settingsLocationRegion`），`setLocation({region})`（`254-265`）。

对应文案（`zh.ts:91-94`，逐字）：`位置信息` / `请选择省份/地区` / `请选择市` / `请选择国家或地区`。

### 4.2 `latest_reminder` 里 locationName 的规则

`src/services/chat/latestReminder.ts`：

```ts
const locationName = (location, locale) => {                    // 6-16
  if (!location) return ''
  if (location.region === 'CN' && locale === 'zh-CN') {
    const province = provinces.find(p => p.code === location.province)
    const city = province?.cities.find(c => c.code === location.city)
    return city?.name ?? province?.name ?? getRegionName('CN', locale)   // 市 → 省 → 中国
  }
  return getRegionName(location.region, locale)                 // 用 Intl.DisplayNames
}

export const createLatestReminder = ({ locale, location }, now = new Date()) =>   // 19-30
  [formatDate(now),                                             // 1. 日期（本地时区）
   new Intl.DateTimeFormat(locale, {weekday:'long'}).format(now), // 2. 星期
   locationName(location, locale),                              // 3. 位置（可为空串）
   'Web',                                                       // 4. 平台
   translate('latestReminderLanguage')].join(',')                // 5. 语言（中文/English）
```

| 规则 | 结果示例（zh-CN，2026-11-16 周一） |
| --- | --- |
| 没设置位置 | `2026-11-16,星期一,,Web,中文`（**第 3 段是空，仍然 5 段**） |
| 选了省 + 市 | `2026-11-16,星期一,杭州市,Web,中文`（市名优先，带“市”字） |
| 只选省 | `2026-11-16,星期一,浙江省,Web,中文` |
| CN 但只有 region | `2026-11-16,星期一,中国,Web,中文` |
| 境外（locale=zh-CN） | `2026-11-16,星期一,日本,Web,中文`（`Intl.DisplayNames` 输出） |
| 英文界面 | `2026-11-16,Monday,,Web,English` |

**插入位置**（`src/services/chat/reply.ts`）：`toRequestMessages` 在每一轮 user 之前按需插入一条 `{role:'latest_reminder', content}`，内容变化才插（`312-318`、`324`）；本轮提问前也插一次（`327`）。`reply.latestReminder` 是消息上的快照（`types.ts:85`、`reply.ts:308`），由 store 在发请求时用当前设置生成（`store.ts:986-989`）。协议里 `latest_reminder` 是 Chat Engine 扩展角色（`src/services/api/types.ts:158-159`）。

### 4.3 插件最小可用方案：自由文本 + 默认空 + 写进第三段

**目标**：不搬 34 省 / 392 市数据，不做级联选择；设置里一个自由文本框，默认空；把内容放到 `latest_reminder` 第三段。

| 项 | 规格 |
| --- | --- |
| 存储 | `settings.location: string`，默认 `''`（空字符串，不是 null）；随现有 `SETTINGS_KEY` 一起存 localStorage，`loadSettings()` 里 `typeof stored.location === 'string' ? stored.location : ''` |
| 上限与清洗 | 保存时 `trim()`；把 `, ， 、 ; ；` 与换行替换为空格（**逗号必须去掉**，见下）；最长 40 字符；空串允许 |
| 请求 | `latestReminder(english, location)` 第三段直接 `String(location \|\| '').trim()`；`requestMessages(history, question, english, location)` 透传；调用处传 `settings.location`（现有 4 个调用点都传，见 4.4） |
| 空值 | 第三段输出空串，`join(',')` 后仍为 5 段：`2026-11-16,星期一,,Web,中文`（**绝不能** `filter(Boolean)` 或 `join` 前删空值） |
| 默认值 | 未填 → 与 demo 的 `location=null` 等价（第三段空） |
| 展示 | 不改任何对话 UI；位置只影响模型上下文（与 demo 一致） |
| 升级路径 | 若要完全对齐 demo：引入 34 省 / 392 市 / 249 地区的 `locationData`（13.2 KB）做级联 + `normalizeLocation` 校验；工作量集中在 UI 与校验，数据结构照 4.1 抄 |

**逗号为什么必须去掉**：协议是 `join(',')` 的 5 段；用户输入 `北京, 朝阳` 会让服务端多解析出第 6 段，`locationName` 语义错位。清洗规则落库前执行，读取时再 `trim` 一次。

### 4.4 落点表

| 落点（符号） | 要做的事 |
| --- | --- |
| `loadSettings()` | 返回值加 `location: typeof stored.location === 'string' ? stored.location : ''` |
| `SETTINGS_KEY` 持久化 | 无需新 key，`settings` 对象整体序列化已覆盖 |
| `SettingsDialog` | 在「连接」或「语音」之后加一段；落点建议：`h('div',{className:'dsc-sectionTitle'}, t('settingsLocation'))` + `h('div',{className:'dsc-field'}, h('label',{className:'dsc-label',htmlFor:'dsc-location'}, t('settingsLocation')), h('input',{id:'dsc-location', className:'dsc-inputText', maxLength:40, spellCheck:false, value:location, onChange:…}))`；`location` 用 `useState(settings.location \|\| '')`；`onSave` 时按 4.3 清洗后写回 |
| 文案 | `settingsLocation: '位置信息'`（`zh.ts:91` 逐字）；en 用 `Location`（`en.ts:96`）。**不要**为自由文本编造 placeholder/hint——zh.ts 里没有对应文案；若产品要 placeholder，必须作为“新增文案”登记并同步 en（见第 6 节偏差说明） |
| `latestReminder(english, location)` | 第三段 `String(location \|\| '').trim()`；保持 5 段 |
| `requestMessages(history, question, english, location)` | 透传第 4 参；首条 `{role:'latest_reminder'}` 内容由它生成 |
| `ChatPanel` 四个调用点 | 传 `settings.location`（发送、重试/重新生成、继续生成、编辑后重发都要用同一份设置） |
| 样式 | 复用现有 `.dsc-field` / `.dsc-label` / `.dsc-inputText` / `.dsc-sectionTitle`，无需新增 CSS |

### 4.5 与 demo 的差异（明确记录）

| 维度 | demo | 插件最小方案 | 影响 |
| --- | --- | --- | --- |
| 结构 | `{region, province?, city?}` + 校验 | 单个自由字符串 | 无省市层级；模型拿到的是用户自由输入（如“杭州”） |
| 选择方式 | 中文浏览器省市级联 / 其他浏览器国家选择 | 一个文本框 | 体验简化，无非法值校验 |
| 空值语义 | `null` → 第三段空 | `''` → 第三段空 | 等价 |
| 插入频率 | 每轮 user 前按变化插入 | 只在消息列表开头插入一次 | 长对话里位置变化不会中途更新（可后续升级） |
| 数据量 | 13.2 KB 静态数据 + Intl | 0 | 插件体积更小 |
| 文案 | 4 条（含 3 个选择占位符） | 只用 `位置信息` 1 条 | 不编造文案 |

---

## 5. 验收清单

### 5.1 朗读按钮 / 波形

- [ ] 每条有正文的助手回复底部有朗读入口；idle 显示 `朗读`（图标或图标+文字），点击开始。
- [ ] 开始后立刻进入 loading（波形/扫光可见），tooltip 变 `停止朗读`；首帧到达切 playing（波形动起来）。
- [ ] loading 中点击能停止（请求 abort），playing 中点击能停止（音频停、按钮回 idle）；不会出现“点了没反应”。
- [ ] 同一条重复点击 = 播/停切换；点另一条的朗读会先停旧的。
- [ ] 400 → `这条回答暂时无法朗读`；鉴权/余额/限流/其他按 1.2 文案，toast 3 s 量级。
- [ ] 4 根条：宽 2、间距 2、圆角 1、总宽 14；playing 1.6 s 周期、相邻错 0.4 s、14↔4 px 往复；loading 4 px 短条 + 扫光。
- [ ] 暗色主题下波形颜色正常（品牌色；loading 用 token 兜底）。
- [ ] `prefers-reduced-motion: reduce` 时显示静态帧（高度 7/14/4/10 等比例），无动画。

### 5.2 位置

- [ ] 设置里可见 `位置信息` 输入框，默认空；填「杭州」保存后重开设置仍在。
- [ ] 发一条消息，Network 里 `latest_reminder` 的 content 是 `YYYY-MM-DD,星期X,杭州,Web,中文`（5 段）。
- [ ] 清空位置后再发：content 是 `YYYY-MM-DD,星期X,,Web,中文`（**连续两个逗号**，仍 5 段）。
- [ ] 输入 `北京, 朝阳` → 落库为 `北京 朝阳`（逗号被清洗），请求仍是 5 段。
- [ ] 输入 41 个字符 → 截断到 40。
- [ ] 英文界面（`t('send') === 'Send'`）→ 语言段是 `English`，星期是英文。

---

## 6. 与当前工作区实现的偏差（快照，仅供自查）

> 工作区并行修改中，以下只按稳定符号列差异，不引用行号。

| 项 | demo 规格 | 快照实现 | 处理 |
| --- | --- | --- | --- |
| 朗读按钮形态 | 图标 + 波形，loading/playing 都可点 | 文字按钮，`speakPending` 时 `disabled`，加载中显示 `…` | 按 3.2：加 `ReadingBars`，去掉 disabled，loading 可取消 |
| 朗读错误文案 | `这条回答暂时无法朗读` / `朗读失败，请稍后再试` | `speakFailed: '语音合成失败'` | 新增 `ttsUnavailable`、把通用失败换成 `ttsFailed` |
| TTS 取消 | abort 请求 + 回 idle | 无 AbortController | 补 signal；`stopSpeaking` 里 abort 并清 pending |
| 波形 | SVG + SMIL，4 根 | 无 | 按 3.1 加 CSS-only 版 |
| 位置 | `{region, province?, city?}` + 校验 + 省市 UI | 已是自由文本 + `settings.location`；`latestReminder(english, location)` 已接第三段 | 结构方向正确；补 4.3 的清洗（trim/去逗号/限长） |
| 位置文案 | 只用 `位置信息` | 另造了 `settingsLocationPlaceholder` / `settingsLocationHint`（例如“例如：中国 · 安徽 · 合肥”“随每次请求发送……”） | 这两条**不在 `zh.ts` 里**，与“文案逐字来自 zh.ts”冲突；要么删掉，要么登记为新增文案并同步 en（建议 v1 删掉，只留标签） |
| 朗读音色文案（相邻） | `朗读音色` / `海星（女声）` / `暗潮（男声）`（`zh.ts:88-90`） | `音色` / `海星 · 女声` / `暗潮 · 男声` | 不属于本文验收范围，但同属语音面板，建议顺手对齐 |

---

## 附录：数据规模是怎么数的

在 demo 目录用脚本按行统计（UTF-8 读取）：

* `provinceNames` 段落内匹配 `^\s*'\d{6}':` → 34 条。
* `cityNames` 段落（第 38 行到 `regionCodes` 前）同样匹配 → 392 条（含台湾省县级条目）。
* `regionCodes` 的单引号长串按空格切分 → 249 个。
* `regionNameOverrides` → `zh-CN` 3 条（TW/HK/MO）、`en-US` 3 条。
* 文件共 452 行、13,209 字节（`src/services/locationData.ts`）。

> 若后续要“对齐 demo 的省市选择”，直接搬这 4 个常量 + `normalizeLocation` 即可；注意 `cityNames` 的 392 条里包含县级条目，省市两级 UI 会显示县级项（demo 也是这样）。
