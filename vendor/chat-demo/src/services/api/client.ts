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
/** 插件额外能力：设置里可以覆盖接口地址，改完立刻生效，无需重新构建 */
const apiBaseUrl = () => {
  const override = useSettings.getState().apiBaseUrl
  return `${(override && override.trim() ? override.trim() : API_ORIGIN).replace(/\/+$/, '')}/anthropic/v1`
}
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

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  ...(usesAccountAuth() ? {} : { 'x-api-key': apiKey }),
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

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
  const response = await authedRequest(`${API_ORIGIN}/models`, { method: 'GET', signal })
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
  await request(`${API_ORIGIN}/models`, {
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
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
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
