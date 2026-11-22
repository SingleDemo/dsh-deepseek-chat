import { translate, type TranslationMessage } from '../../i18n/index.js'
import { useSettings } from '../settings.js'
import { accountAuthHeaders, invalidateAccountToken, usesAccountAuth } from '../../plugin/account-auth.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** 官方端点用 /anthropic/v1；自定义地址（中转站、自建）用标准的 /v1。 */
const OFFICIAL_ORIGIN = 'https://api.deepseek.com'

/**
 * 插件额外能力：设置里可以覆盖接口地址，改完立刻生效，无需重新构建。
 * 支持三种写法：官方 origin、任意 origin（自动补 /v1）、显式的 /v1 或 /anthropic/v1 前缀。
 */
const resolveBase = (value: string | null): string => {
  const raw = (value && value.trim()) || ''
  if (!raw) return `${API_ORIGIN}/anthropic/v1`
  const trimmed = raw.replace(/\/+$/, '')
  if (/\/anthropic\/v1$/.test(trimmed)) return trimmed
  if (/\/v1$/.test(trimmed)) return trimmed
  // DeepSeek 官方保持扩展端点；其他中转/自建按 Anthropic 兼容的标准路径。
  return /^https?:\/\/api\.deepseek\.com$/i.test(trimmed) ? `${trimmed}/anthropic/v1` : `${trimmed}/v1`
}

const apiBaseUrl = () => resolveBase(useSettings.getState().apiBaseUrl)

/**
 * 对话请求的凭据：对话接口单独的 Key 优先，否则用官方凭据。
 * 自定义接口一律用 Bearer（它们的 CORS 只放行 Authorization）。
 */
const chatApiKey = () => {
  const settings = useSettings.getState()
  return settings.chatApiKey || settings.apiKey || ''
}

/** 官方端点与凭据：账号登录优先，其次手填的官方 Key。 */
export const officialEndpoint = async (): Promise<{ base: string; headers: Record<string, string> }> => {
  if (usesAccountAuth()) {
    const account = await accountAuthHeaders(OFFICIAL_ORIGIN)
    if ('x-dsh-auth-token' in account) {
      return { base: `${OFFICIAL_ORIGIN}/anthropic/v1`, headers: account }
    }
  }
  const key = useSettings.getState().apiKey || ''
  return {
    base: `${OFFICIAL_ORIGIN}/anthropic/v1`,
    headers: key ? { authorization: `Bearer ${key}` } : {},
  }
}

/** 模型列表端点：官方是 {origin}/models，兼容端点是 {base}/models。 */
const modelsUrl = () => {
  const base = apiBaseUrl()
  return /\/anthropic\/v1$/.test(base) ? `${base.replace(/\/anthropic\/v1$/, '')}/models` : `${base}/models`
}

/** 是否指向 DeepSeek 官方端点（决定要不要带扩展字段）。 */
export const usesOfficialEndpoint = () => apiBaseUrl().indexOf(OFFICIAL_ORIGIN + '/') === 0
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

/** 账号登录态的默认推理源，账号服务据此判断 token 是否可用 */
const inferenceOrigin = (): string => {
  try {
    return new URL(apiBaseUrl()).origin
  } catch {
    return API_ORIGIN
  }
}

/**
 * 插件改动：官方端点用 x-api-key；自定义端点（中转站/自建）经常只放行
 * Authorization，且 CORS 预检只允许少数请求头，所以那边只发 Bearer。
 */
const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => {
  // 自定义对话接口只能用它的 Key：账号登录的 token 只对官方 origin 有效。
  if (!usesOfficialEndpoint()) {
    return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  }
  return {
    ...(usesAccountAuth() ? {} : { 'x-api-key': apiKey }),
    // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
    ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
  }
}

/**
 * 插件改动：账号登录时附加 x-dsh-auth-token；被拒（401）时刷新一次 token 再重试。
 * 手填 API Key 的路径与此前完全一致。
 */
const authedRequest = async (url: string, init: RequestInit): Promise<Response> => {
  const origin = inferenceOrigin()
  const once = async () => request(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...(await accountAuthHeaders(origin)) },
  })
  try {
    return await once()
  } catch (error) {
    if (usesAccountAuth() && error instanceof ApiError && error.status === 401) {
      invalidateAccountToken()
      return once()
    }
    throw error
  }
}

/** 一个可选模型；字段取服务端 listing，缺失即省略。 */
export type ModelInfo = {
  id: string
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
}

/**
 * 插件改动：读取可用模型列表（与校验同一个免费接口）。
 * 账号登录态或手填 Key 都由 authedRequest 统一附带凭据。
 */
export const listModels = async (apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> => {
  // 模型列表跟随对话接口：自定义接口用它的 Key，官方接口用账号 token 或官方 Key。
  const settings = useSettings.getState()
  const chatKey = settings.chatApiKey || apiKey
  const account = usesOfficialEndpoint() && usesAccountAuth()
    ? await accountAuthHeaders(inferenceOrigin())
    : {}
  const response = await request(modelsUrl(), {
    method: 'GET',
    headers: 'x-dsh-auth-token' in account
      ? account
      : { Authorization: `Bearer ${chatKey}` },
    signal,
  })
  const body = (await response.json()) as { data?: unknown }
  const data = Array.isArray(body.data) ? body.data : []
  const models: ModelInfo[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id) continue
    models.push({
      id: item.id,
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.context_window === 'number' ? { contextWindow: item.context_window } : {}),
      ...(typeof item.max_output_tokens === 'number' ? { maxOutputTokens: item.max_output_tokens } : {}),
    })
  }
  return models
}

/**
 * 用 GET /models 校验凭据（不产生费用）。
 * 插件改动：账号登录时校验账号 token，手填 Key 时沿用 Bearer。
 */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  const account = usesAccountAuth() ? await accountAuthHeaders(inferenceOrigin()) : {}
  await request(modelsUrl(), {
    method: 'GET',
    headers: 'x-dsh-auth-token' in account
      ? account
      : { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await authedRequest(`${apiBaseUrl()}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await authedRequest(`${apiBaseUrl()}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
/**
 * 插件改动：自定义端点（中转站/自建）先走非流式请求，再把完整响应拆成事件。
 * 不同实现的 SSE 事件流差异很大，非流式只有一种 JSON 形状，兼容性最好。
 */
const synthesizeEvents = (payload: unknown): MessageStreamEvent[] => {
  const events: MessageStreamEvent[] = []
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const blocks = Array.isArray(record.content) ? record.content : []
  let index = 0
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type === 'text' && typeof item.text === 'string') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } } as unknown as MessageStreamEvent)
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: item.text } } as unknown as MessageStreamEvent)
      events.push({ type: 'content_block_stop', index } as unknown as MessageStreamEvent)
      index += 1
      continue
    }
    if (item.type === 'thinking' && typeof item.thinking === 'string' && item.thinking) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } } as unknown as MessageStreamEvent)
      events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: item.thinking } } as unknown as MessageStreamEvent)
      events.push({ type: 'content_block_stop', index } as unknown as MessageStreamEvent)
      index += 1
    }
  }
  const stopReason = typeof record.stop_reason === 'string' ? record.stop_reason : 'end_turn'
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason } } as unknown as MessageStreamEvent)
  events.push({ type: 'message_stop' } as unknown as MessageStreamEvent)
  return events
}

export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  mode: 'chat' | 'official' = 'chat'
): AsyncGenerator<MessageStreamEvent> {
  if (mode === 'official') {
    // 搜索、读链接由 DeepSeek 官方执行，对话接口的自定义地址不参与。
    const endpoint = await officialEndpoint()
    const response = await request(`${endpoint.base}/messages`, {
      method: 'POST',
      headers: {
        ...endpoint.headers,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    })
    yield* readEventStream(response, signal)
    return
  }
  if (!usesOfficialEndpoint()) {
    // 兼容端点不认识 DeepSeek 的扩展角色，剥掉后按标准 Messages 发送。
    const messages = body.messages.filter((message) => message.role !== 'latest_reminder')
    const plain = await authedRequest(`${apiBaseUrl()}/messages`, {
      method: 'POST',
      headers: {
        ...anthropicHeaders(apiKey, hasFile(body)),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...body, messages, stream: false }),
      signal,
    })
    for (const event of synthesizeEvents(await plain.json())) {
      yield event
    }
    return
  }
  const response = await authedRequest(`${apiBaseUrl()}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  yield* readEventStream(response, signal)
}

/** 把一个 Anthropic SSE 响应逐事件读出；两处调用共用同一段协议处理。 */
async function* readEventStream(
  response: Response,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
