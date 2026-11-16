# 11 · API Key 校验（ApiKeyField）

> 规格对象：`client.js` 设置对话框里的 API Key 字段（`function SettingsDialog`）
> 参照实现：原版 demo `deepseek-ai/chat-demo@5d5dd75`
> 约定：demo 用 `src/...:行号`；`client.js` 只标函数/组件名，行号写 `≈`。
> 本文只写规格，不实施。

---

## 0. 结论摘要

1. demo **没有"独立的验证按钮 + 保存"两步**：输入框边上的「确定」按下时**先校验、通过才落盘**（`GET /models`），失败**不保存**、错误显示在输入框下方，仍停在编辑态可改。
2. 校验接口是 **`{API_ORIGIN}/models`（根路径，不在 `/anthropic/v1` 下）**，鉴权用 **`Authorization: Bearer <key>`**，不是聊天用的 `x-api-key`。这是最容易写错的一点。
3. 三态文案（demo 逐字）：`正在验证...` / `API Key 无效，请检查后重试` / `校验失败：{message}`；另有一个隐藏第四态：**网络异常**（无 HTTP 状态码）显示 `网络异常，请检查你的网络状况`。
4. 并发处理只有**一个 re-entrancy 守卫**（`if (!apiKey || verifying) return`）+ 按钮 `disabled`，**没有节流、没有防抖、没有超时**（`verifyApiKey` 支持 `AbortSignal` 但调用处没传）。

---

## 1. demo 的实现事实

### 1.1 组件结构

| 部分 | 事实 | 出处 |
| --- | --- | --- |
| 字段标题 | `t('apiKeyStart')` = `输入 API Key 开始使用` | `src/components/settings/ApiKeyField.tsx:29`；`src/i18n/zh.ts:101` |
| 已保存态 | 只显示掩码 `'*'.repeat(apiKey.length)`（**与 Key 等长的星号**，不是固定 8 个）+ 编辑图标按钮 `tooltip={t('apiKeyEdit')}` | `ApiKeyField.tsx:30-39` |
| 输入态判定 | `showInput = !apiKey \|\| editing`（`useApiKeyEditor`） | `ApiKeyField.tsx:15` |
| 输入框 | `type="password"`、`placeholder={t('apiKeyPlaceholder')}`、`autoComplete="off"`、`spellCheck={false}`、`autoFocus={!isMobile \|\| editing}` | `ApiKeyField.tsx:42-50` |
| 桌面端行内「确定」 | 只在 `!isMobile && form.value.trim()` 时渲染；`disabled={form.verifying}`；`onMouseDown={e => e.preventDefault()}` 保持输入框焦点 | `ApiKeyField.tsx:63-77` |
| 移动端整行「确定」 | `ApiKeyConfirm`：`showInput && form.value.trim()` 时才出现，同样 `disabled={verifying}` | `ApiKeyField.tsx:87-100` |
| 错误行 | `{showInput && form.error ? <div className={styles.error}>{form.error}</div> : null}` —— **只在输入态显示** | `ApiKeyField.tsx:80` |
| 失焦回退 | 已有 Key 且输入框被清空后失焦 → `setEditing(false)` 回到已保存态 | `ApiKeyField.tsx:56-61` |

### 1.2 什么时候触发验证

**只有三种用户动作，全部是"提交"**，没有 onBlur / onChange / 打开设置时自动验证：

| 触发 | 代码 |
| --- | --- |
| 输入框按 `Enter`（`!event.nativeEvent.isComposing` 中文输入法保护） | `ApiKeyField.tsx:51-55` |
| 桌面端点行内「确定」 | `ApiKeyField.tsx:72` |
| 移动端点整行「确定」 | `ApiKeyField.tsx:95` |

三者都调用 `form.submit()`；按钮文案在请求中是 `t('apiKeyVerifying')`（`ApiKeyField.tsx:74, 97`）。

### 1.3 请求什么接口、什么参数

```ts
// src/services/api/client.ts:92-99
/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}
```

- URL：`${API_ORIGIN}/models`，`API_ORIGIN` 是构建期注入的（`client.ts:12-13`，默认 `https://api.deepseek.com`）。**不是** `${ANTHROPIC_BASE_URL}/models`。
- 方法 `GET`，无 body、无 query、无 `anthropic-beta` 头。
- 鉴权：`Authorization: Bearer <apiKey>`；注意聊天接口用的是 `x-api-key`（`client.ts:85-90`），**两套头不能混用**。
- **不产生费用**（注释原文），所以可以放心在产品里让用户主动点。

### 1.4 成功与失败的判定

失败在 `request()` 里被统一成 `ApiError`：

```ts
// src/services/api/client.ts:69-83
export const request = async (url, init) => {
  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) throw await readErrorResponse(response)
  return response
}
```

- **成功 = `response.ok`（任何 2xx）**，响应体不解析（`/models` 的返回内容 demo 完全不看）。
- **失败 = 非 2xx 或 fetch 抛错**，错误消息取法（`client.ts:51-67`）：
  1. 响应体是 JSON 且形如 `{error:{message:string}}` → 用 `body.error.message`；
  2. 否则用响应原文；
  3. 都没有用 `response.statusText`。
  → 最终 `ApiError(kind:'http', message, status)`。fetch 本身失败 → `ApiError('network', error.message)`（**没有 status**）。
- 状态码分类（`src/services/api/errors.ts:17-44`）：

```ts
export const classifyStatus = (status) => {
  if (status === 401) return 'unauthorized'
  if (status === 402) return 'insufficientBalance'
  if (status === 413) return 'tooLarge'
  if (status === 429) return 'rateLimited'
  if ((status ?? 0) >= 500) return 'serverBusy'
  return 'other'
}
export const classifyApiError = (error) => {
  if (!(error instanceof ApiError)) return 'other'
  if (error.status === undefined) return error.kind === 'network' ? 'network' : 'other'
  return classifyStatus(error.status)
}
```

### 1.5 三（四）态文案映射（核心）

```ts
// src/components/settings/useApiKeyForm.ts:14-28
const error =
  failure === null
    ? null
    : classifyApiError(cause) === 'unauthorized'
      ? t('apiKeyInvalid')
      : classifyApiError(cause) === 'network'
        ? t('commonNetworkErrorToast')
        : t('apiKeyVerificationFailed', {
            message:
              cause instanceof ApiError && cause.localMessage
                ? t(cause.localMessage.key, cause.localMessage.params)
                : cause instanceof Error
                  ? cause.message
                  : String(cause),
          })
```

| 状态 | 判定 | 文案 key | 中文（**逐字**） | 出处 |
| --- | --- | --- | --- | --- |
| 正在验证 | `verifying === true` | `apiKeyVerifying` | `正在验证...`（三个半角点，**不是** `…`） | `src/i18n/zh.ts:104` |
| 成功 | `response.ok` | 无文案 | 直接保存并退出编辑态（**demo 没有"Key 可用"提示**） | `useApiKeyForm.ts:38-41` |
| 无效 | `classifyApiError === 'unauthorized'`（HTTP **401**） | `apiKeyInvalid` | `API Key 无效，请检查后重试` | `src/i18n/zh.ts:106` |
| 网络异常 | 无 status 且 `kind === 'network'` | `commonNetworkErrorToast` | `网络异常，请检查你的网络状况` | `src/i18n/zh.ts:67` |
| 其它失败 | 其余一切（402/413/429/5xx/4xx/非 ApiError） | `apiKeyVerificationFailed` | `校验失败：{message}` | `src/i18n/zh.ts:107` |

`{message}` 的取值优先级：`ApiError.localMessage` 的翻译 > `Error.message` > `String(cause)`。
→ **402 余额不足不会显示"余额不足"**，只会显示服务端原文（例如 `校验失败：Insufficient Balance`）。

按钮文案：`t('confirm')` = `确定`（`src/i18n/zh.ts:105`）；`t('apiKeyEdit')` = `修改 API Key`（`src/i18n/zh.ts:102`）；`t('apiKeyPlaceholder')` = `请输入 API Key`（`src/i18n/zh.ts:103`）。

### 1.6 并发 / 节流

```ts
// src/components/settings/useApiKeyForm.ts:30-47
const submit = async () => {
  const apiKey = value.trim()
  if (!apiKey || verifying) {
    return                                    // ★ 唯一的并发守卫
  }
  setVerifying(true)
  setFailure(null)                            // ★ 新请求前清掉旧错误
  try {
    await verifyApiKey(apiKey)
    setApiKey(apiKey)                         // 只有成功才落盘
    setValue('')
    onSaved?.()                               // = setEditing(false)
  } catch (e) {
    setFailure({ cause: e })                  // 失败保留输入内容
  } finally {
    setVerifying(false)
  }
}
```

- **并发**：`verifying` 闭包 + `disabled={form.verifying}` 双重挡住重复提交；同一时刻最多 1 个请求。
- **节流/防抖**：**没有**。用户连续点会在上一次结束后再发；没有频率限制、没有冷却、没有重试退避。
- **超时**：`verifyApiKey` 签名支持 `signal`，但 `useApiKeyForm.ts:38` **没传** → 请求挂住时「正在验证...」会一直显示。
- **失败后的输入**：`value` 不清空（`ApiKeyField.tsx:49`），用户可直接改；`error` 在下次提交成功后才消失（`setFailure(null)` 在请求前）。
- **保存时机**：`setApiKey`（`src/services/settings.ts:122-125`）写 localStorage `chat-demo:api-key`（`settings.ts:23`）并同步 zustand；失败**不写**。
- **面板关闭再打开**：`useApiKeyForm` 的 `value/verifying/failure` 全是组件状态，关掉设置就重置（`SettingsDialog.tsx:57-67` 在 `SettingsContent` 里创建）。

---

## 2. 落到 client.js

### 2.1 现状快照

| 已有 | 位置 |
| --- | --- |
| 设置弹窗「连接」分组里的 API Key 输入框 + 行内「验证」按钮 + 结果行 | `client.js` `SettingsDialog`（`dsc-keyRow`） |
| `keyCheck` 状态 `{state:'idle'\|'checking'\|'ok'\|'bad', message}` | 同上（`const [keyCheck, setKeyCheck] = useState(...)`） |
| `checkKey()` 调用 `await verifyKey(target)` 并分支 401 / 402 / 其它 | 同上 |
| 文案 `keyVerify` / `keyVerifying` / `keyValid` / `keyInvalid` / `keyVerifyFailed` | `client.js` 的 `en`/`zh` 词表 |

**`verifyKey` 已有初版**（`client.js` 的 `async function verifyKey(settings)`），但**与 demo 的协议不一致，必须改**：

| # | 现状（初版） | 必须改成 | 原因 |
| --- | --- | --- | --- |
| K1 | `POST {base}/anthropic/v1/messages`，body `{model, max_tokens:1, thinking:{type:'disabled'}, messages:[{role:'user',content:'hi'}]}`，头用 `x-api-key` | `GET {base}/models`，头 `Authorization: Bearer <key>`，无 body | demo 用 `/models` 且注释明确"**不产生费用**"（`src/services/api/client.ts:92-99`）；用 `messages` 校验**每点一次验证都会扣 token/产生一次计费请求**，这在产品上不可接受 |
| K2 | 失败信息统一走 `describeFailure()`（带 `HTTP 401 · ` 前缀） | 按 §2.2 的 `verifyKey` + `keyCheckMessage` 返回**数字 status + 干净 message** | 401 特判失效；文案不再是 demo 逐字 |
| K3 | `checkKey` 里手工判 `401` / `402`，402 显示 `noticeBalance`（`账户余额不足，请充值后重试。`） | 只有 401 特判，**其余（含 402）一律** `keyVerifyFailed: 校验失败：{message}` | demo `useApiKeyForm.ts:14-28` 只单列 401 与网络 |
| K4 | 网络失败会进 catch，显示 `校验失败：Failed to fetch` | 识别"无 HTTP 状态码"→ `keyNetwork`（`网络异常，请检查你的网络状况`） | demo 单独分支（`useApiKeyForm.ts:19-20`） |
| K5 | 无并发守卫、无超时（只有按钮 `disabled`） | 加 `checking` 守卫 + 15s AbortController | 组件卸载/连点会重复请求、`setState` 警告 |

（初版的 `keyCheck` 状态集合 `idle/checking/ok/bad` 与文案 key 可以保留，只需替换取值来源。）

### 2.2 改造 `verifyKey` 并新增 `keyCheckMessage`（放 `api` 段，`endpoints()` 之后）

1）`endpoints()` 增加一个成员（`client.js` 的 `endpoints()`）：

```js
function endpoints(baseUrl) {
  const base = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return {
    messages: base + MESSAGES_PATH,
    files: base + FILES_PATH,
    models: base + '/models',        // ★ 根路径，与 demo 一致
    asr: base + '/v1/tools/asr',
    tts: base + '/v1/tools/tts',
  };
}
```

2）新增 `verifyKey(settings, signal)`。**不要复用 `streamMessage` / `describeFailure`**：`describeFailure` 会给消息加 `HTTP 401 · ` 前缀，而 demo 的校验 UI 只要干净文案，且我们需要拿到**数字 status** 来区分 401。

```js
/**
 * Probe the key with GET /models (free) — the demo's verification call.
 * Never throws for HTTP failures: the caller needs the numeric status to
 * pick the right copy. Abort is re-thrown so the caller can ignore it.
 * @returns {Promise<{ok:boolean, status:number|undefined, message:string}>}
 */
async function verifyKey(settings, signal) {
  const target = String(settings.apiKey || '').trim();
  if (!target) return { ok: false, status: undefined, message: '' };
  let response;
  try {
    response = await fetch(endpoints(settings.baseUrl).models, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + target },   // ★ Bearer，不是 x-api-key
      signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    return { ok: false, status: undefined, message: error && error.message ? error.message : String(error) };
  }
  if (response.ok) return { ok: true, status: response.status, message: '' };
  let body = '';
  try {
    body = await response.text();
  } catch (error) {
    body = '';
  }
  let message = body || response.statusText || '';
  try {
    const parsed = JSON.parse(body);
    if (parsed && parsed.error && typeof parsed.error.message === 'string') message = parsed.error.message;
  } catch (error) {
    /* 非 JSON：保留原文 */
  }
  return { ok: false, status: response.status, message };
}
```

3）新增文案选择器（纯函数，便于测试）：

```js
/** Map a verification result onto the demo's three-state copy. */
function keyCheckMessage(result, t) {
  if (result.status === 401) return t('keyInvalid');
  if (result.status === undefined) return t('keyNetwork');
  return t('keyVerifyFailed').replace('{message}', result.message || '');
}
```

> 为什么不用"分类函数"：demo 的 `classifyApiError` 只把 401 单列，网络单列，其余全归 `t('apiKeyVerificationFailed', {message})`（`useApiKeyForm.ts:14-28`）。照抄这个 **if/else 形状**比引一套新的 condition 枚举更不容易偏。

### 2.3 状态机与 UI（改 `SettingsDialog` 的 `checkKey`）

```
idle ──触发──> checking ──ok──> ok（demo 无文案；我们保存并关闭/或短暂显示）
                    └──fail──> bad（红色文案，输入内容保留，可再点）
```

| 状态 | 按钮文案 | 附加 UI |
| --- | --- | --- |
| `idle` / `bad` | `t('keyVerify')` = `验证` | `bad` 时右侧显示红色 `message` |
| `checking` | `t('keyVerifying')` = `正在验证...` | 按钮 `disabled`；`message` 清空 |
| `ok` | `t('keyVerify')` | 可选显示 `t('keyValid')`（**demo 没有**，建议只用一次性的 `notice`/`settingsSaved` 提示，不常驻） |

改造后的 `checkKey`（要点全在注释里）：

```js
const keyCheckRef = useRef({ state: 'idle' });
const runKeyCheck = async () => {
  const target = Object.assign({}, settings, {
    apiKey: apiKey.trim(),
    baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
  });
  if (!target.apiKey) return { ok: false, cancelled: true };
  if (keyCheckRef.current.state === 'checking') return { ok: false, cancelled: true };  // 并发守卫
  keyCheckRef.current = { state: 'checking' };
  setKeyCheck({ state: 'checking', message: '' });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);   // ★ demo 没有，我们补
  try {
    const result = await verifyKey(target, controller.signal);
    if (result.ok) {
      keyCheckRef.current = { state: 'ok' };
      setKeyCheck({ state: 'ok', message: '' });
      return { ok: true };
    }
    const message = keyCheckMessage(result, t);
    keyCheckRef.current = { state: 'bad' };
    setKeyCheck({ state: 'bad', message });
    return { ok: false, message };
  } catch (error) {
    // 只可能是 AbortError：超时按网络失败提示，不要显示"校验失败"
    keyCheckRef.current = { state: 'bad' };
    setKeyCheck({ state: 'bad', message: t('keyNetwork') });
    return { ok: false, message: t('keyNetwork') };
  } finally {
    window.clearTimeout(timer);
  }
};
```

- 成功不落盘 Key 本身（Key 是随「保存」一起 `patchSettings` 写的）——这一点与 demo 不同，见 §2.4。
- 只在 `keyCheck.state !== 'checking'` 时允许再次触发；`checkKey` 按钮 `disabled={checking || !apiKey.trim()}`（现状已有，保持）。

### 2.4 触发时机：demo「校验通过才保存」怎么落

demo 的保存动作和校验是同一个动作；我们的保存是**整体设置保存**（apiKey + baseUrl + model + voice），两者要合流：

| 场景 | 行为 |
| --- | --- |
| 用户点「验证」 | 只校验，不保存。失败显示文案；成功给出一次性提示（`settingsSaved` 复用或新增 `keyValidNotice`）。 |
| 用户点「保存」且 **apiKey 与已存值不同**（`apiKey.trim() !== String(settings.apiKey).trim()`） | 先 `runKeyCheck()`，`ok` 才 `onSave(...)` + 关闭；失败则**不保存、不关闭**，停留并显示错误。等价 demo `useApiKeyForm.ts:38-41`。 |
| 用户点「保存」且 apiKey 未改 | 直接保存（避免无谓请求；demo 里没有这个场景，因为 demo 每次都要输入）。 |
| 无 apiKey | 「验证」按钮 disabled；「保存」允许（改模型/语音也要能存），不校验。 |

保存失败（`writeJson` 返回 `false`，见 `client.js` `writeJson`）必须提示，不能静默：

```js
const saved = patchSettings({ apiKey: apiKey.trim(), baseUrl: ..., model: ..., voice });
if (!saved) setNotice(t('settingsSaveFailed'));
```

（`patchSettings` 现在没返回 `writeJson` 结果，需要让它 `return writeJson(...)`。）

### 2.5 中英文案

复用/修正（**中文必须与 demo 逐字一致**）：

| key | 现状 | 目标 zh（demo 逐字） | en |
| --- | --- | --- | --- |
| `keyVerifying` | `正在验证…`（U+2026） | **`正在验证...`**（三个半角点，`src/i18n/zh.ts:104`） | `Verifying...`（`src/i18n/en.ts:109`） |
| `keyInvalid` | `API Key 无效，请检查后重试` | 不变（逐字一致，`src/i18n/zh.ts:106`） | `Invalid API Key. Please check it and try again.` |
| `keyVerifyFailed` | `校验失败：{message}` | 不变（逐字一致，`src/i18n/zh.ts:107`） | `Verification failed: {message}` |
| `keyVerify` | `验证` | 保留（demo 无此按钮；自造） | `Verify` |
| `keyValid` | `Key 可用` | **默认不展示**（demo 成功无文案）；仅在一次性提示里用 | `Key works` |

新增：

| key | zh | en | 用途 |
| --- | --- | --- | --- |
| `keyNetwork` | `网络异常，请检查你的网络状况`（demo `src/i18n/zh.ts:67` 逐字） | `Network problem. Check your connection and try again.` | 校验结果是网络异常时 |
| `keyTimeout`（可选） | `验证超时，请稍后重试` | `Verification timed out. Try again.` | 15s 超时；不想加就复用 `keyNetwork` |
| `settingsSaveFailed` | `设置保存失败，浏览器存储可能已满` | `Could not save settings. Browser storage may be full.` | `writeJson` 失败 |

> 现有 `noticeNetwork`（`网络异常，请检查网络后重试。`）用于聊天错误提示，**不要**拿来当校验文案，与 demo 逐字不一致。

### 2.6 消息模型 / 存储

- **消息模型不动**；`settings.apiKey` 仍是字符串，`SETTINGS_KEY` 结构不变，无需迁移。
- 只在 `SettingsDialog` 内加临时状态（`keyCheck` / `keyCheckRef` / 超时 timer），卸载时清 timer（`useEffect` cleanup），避免关闭设置后仍 `setState`。

---

## 3. 验收清单

1. 未填 Key：「验证」按钮 disabled；填 Key 后可点。
2. 正确 Key：点「验证」→ 按钮变 `正在验证...` 并 disabled → 成功后恢复，无红色文案。
3. 错误 Key（401）→ 显示 `API Key 无效，请检查后重试`，输入内容保留，可改后再验。
4. 断网（DevTools offline）→ 显示 `网络异常，请检查你的网络状况`（**不是** `校验失败：Failed to fetch`）。
5. 服务端 500 / 402 → 显示 `校验失败：<服务端原文>`。
6. 快速连点「验证」：只发 1 个请求（Network 面板确认）。
7. 点「保存」且改了 Key、Key 无效 → 设置不关闭、不落盘；改成有效 Key 再点保存 → 关闭并持久化。
8. 改了 model/voice 但没改 Key → 点保存不触发 `/models` 请求。
9. 请求挂起（断网后用 DevTools throttling 模拟）→ 15s 后出现超时提示，按钮恢复可点。
10. 刷新页面 → Key 仍在（localStorage），输入框显示掩码。

---

## 4. 最容易错的地方

1. **接口路径**：`/models` 在根上，写成 `/anthropic/v1/models` 必 404 → 用户会看到 `校验失败：HTTP 404 · …` 却以为是 Key 错。
2. **鉴权头**：校验用 `Authorization: Bearer`，聊天用 `x-api-key`；写反了 401 但聊天正常（或反之），极难排查。
3. **用聊天错误格式化函数**：`describeFailure()` 会拼 `HTTP 401 · ` 前缀，中文文案就不再是 demo 逐字，且 401 特判会失效（它是按文案判断而不是按状态码）。
4. **把 401 的判断写成"消息里包含 401/invalid"**：必须用数字 `status === 401`。
5. **把网络异常当成 `校验失败：{message}`**：demo 明确单独分支（`useApiKeyForm.ts:19-20`），断网时不该显示 `Failed to fetch`。
6. **AbortError 未识别**：超时/组件卸载后 `setState` 会报"校验失败：The user aborted a request"。
7. **校验成功就落盘**：我们不是 demo 的一体式保存，Key 应与其它设置一起在「保存」时写；否则用户点「验证」就悄悄改了 Key，但 baseUrl/model 还是旧的，语义混乱。
8. **`正在验证...` 写成 `正在验证…`**：demo 用的是三个半角点（`zh.ts:104`），逐字比对会挂。
9. **验证通过后 `writeJson` 失败被忽略**：`writeJson` 返回 `false` 表示 localStorage 写失败（配额/隐私模式），必须提示。
10. **关闭设置后请求回来 `setState`**：`SettingsDialog` 卸载后仍 set，React 会警告；用 `AbortController` + cleanup。
