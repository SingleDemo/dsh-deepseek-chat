/**
 * 插件改动：自定义对话接口的客户端工具桥接。
 *
 * 原版把联网能力作为 DeepSeek 的服务端工具声明给模型；自定义接口（中转站）
 * 不支持这些服务端工具，所以这里把同样的能力改成普通工具声明给模型：
 * 模型自己决定要不要调用，调用后由插件请求 DeepSeek 官方 Search / Fetch 接口
 * 执行，再把结果作为 tool_result 回填，模型继续作答。
 *
 * 执行用的官方接口：
 * - POST https://api.deepseek.com/v1/tools/search  { query, count, need_content }
 * - POST https://api.deepseek.com/v1/tools/fetch   { url }
 */
import { officialEndpoint, request, streamChatCompletion } from './client.js'
import type { MessageStreamEvent, WebSearchResult } from './types.js'
import type { ReplyBlock } from '../chat/types.js'

/** 声明给模型的客户端工具，语义与 DeepSeek 的服务端工具一致。 */
export const RELAY_TOOLS = [
  {
    name: 'web_search',
    description:
      'Search the web for current information. Use it when the answer needs fresh news, recent events, prices, or anything beyond the training data.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'search keywords, can use site:/after:/before: operators' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_url',
    description: 'Fetch and read a web page so the answer can rely on its content, e.g. when the user pasted a link.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'absolute http(s) url' } },
      required: ['url'],
    },
  },
]

type ToolRun = {
  /** 展示在回答里的工具调用/结果块 */
  blocks: ReplyBlock[]
  /** 回填给模型的工具结果文本 */
  result: string
}

const randomHex = (): string => {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const toolId = (kind: 's' | 'rl') => `srvtoolu_${kind}_${randomHex()}`

const officialAuth = async (): Promise<Record<string, string>> => {
  const endpoint = await officialEndpoint()
  return endpoint.headers
}

/** 调用官方 Search 接口 */
const callSearch = async (
  query: string,
  signal: AbortSignal
): Promise<{ sources: WebSearchResult[]; text: string }> => {
  const auth = await officialAuth()
  const response = await request('https://api.deepseek.com/v1/tools/search', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ query, count: 8, need_content: false }),
    signal,
  })
  const payload = (await response.json()) as { results?: unknown }
  const rows = Array.isArray(payload.results) ? payload.results : []
  const sources: WebSearchResult[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (typeof item.url !== 'string' || typeof item.title !== 'string') continue
    sources.push({
      type: 'web_search_result',
      title: item.title,
      url: item.url,
      snippet: typeof item.summary === 'string' ? item.summary : typeof item.snippet === 'string' ? item.snippet : '',
      site_name: typeof item.site_name === 'string' ? item.site_name : null,
      site_icon: typeof item.site_icon === 'string' ? item.site_icon : null,
      page_age: typeof item.date === 'string' ? item.date : null,
      encrypted_content: '',
    })
  }
  const text = sources
    .slice(0, 8)
    .map((source, index) => `[${index + 1}] ${source.title} ${source.url}\n${source.snippet ?? ''}`.trim())
    .join('\n')
  return { sources, text }
}

/** 调用官方 Fetch 接口 */
const callFetch = async (url: string, signal: AbortSignal): Promise<{ title: string; text: string }> => {
  const auth = await officialAuth()
  const response = await request('https://api.deepseek.com/v1/tools/fetch', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  })
  const payload = (await response.json()) as { title?: unknown; content?: unknown }
  return {
    title: typeof payload.title === 'string' ? payload.title : url,
    text: typeof payload.content === 'string' ? payload.content.slice(0, 8000) : '',
  }
}

/** 执行一次工具调用，返回可展示的块与回填文本。 */
export const executeRelayTool = async (
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  fallback = ''
): Promise<ToolRun> => {
  const link = typeof input.url === 'string' && /^https?:\/\//i.test(input.url)
    ? input.url.trim()
    : (fallback.match(/https?:\/\/[^\s"'）)]+/) || [])[0]
  if (name === 'read_url' && link) {
    const url = link
    const id = toolId('rl')
    try {
      const page = await callFetch(url, signal)
      return {
        blocks: [
          {
            type: 'server_tool_use',
            id,
            name: 'deepseek_read_url',
            input: { action: 'read_link', url },
            caller: { type: 'direct' },
            kind: 'read_link',
          } as unknown as ReplyBlock,
          {
            type: 'web_fetch_tool_result',
            tool_use_id: id,
            content: {
              type: 'web_fetch_result',
              url,
              content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '' }, title: page.title },
              published_at: null,
            },
            kind: 'read_link',
          } as unknown as ReplyBlock,
        ],
        result: page.text ? `网页《${page.title}》内容：\n${page.text}` : '网页内容为空',
      }
    } catch {
      return {
        blocks: [],
        result: '读取该链接失败，请说明无法访问。',
      }
    }
  }
  if (name !== 'web_search') {
    return { blocks: [], result: `未知工具：${name}。可用工具只有 web_search 和 read_url。` }
  }
  // 默认按搜索处理
  // 中转站偶尔把 tool_use 的 input 丢了：这时用用户原问题兜底，保证真的能搜到东西。
  const query = typeof input.query === 'string' && input.query.trim()
    ? input.query.trim()
    : (fallback.trim() || String(input.query ?? ''))
  const id = toolId('s')
  try {
    const { sources, text } = await callSearch(query, signal)
    return {
      blocks: [
        {
          type: 'server_tool_use',
          id,
          name: 'deepseek_web_search',
          input: { action: 'search', queries: [query] },
          caller: { type: 'direct' },
          kind: 'search',
        } as unknown as ReplyBlock,
        {
          type: 'web_search_tool_result',
          tool_use_id: id,
          content: sources,
          kind: 'search',
        } as unknown as ReplyBlock,
      ],
      result: text ? `搜索「${query}」的结果：\n${text}` : `搜索「${query}」没有返回结果。`,
    }
  } catch {
    return { blocks: [], result: '搜索失败，请基于已有知识回答并说明无法联网。' }
  }
}

export type { MessageStreamEvent }

/** 给事件加上统一偏移，避免多轮之间 content_block 索引冲突。 */
const offsetEvent = (event: MessageStreamEvent, offset: number, pad: boolean): MessageStreamEvent => {
  if (event.type !== 'content_block_start' && event.type !== 'content_block_delta' && event.type !== 'content_block_stop') {
    return event
  }
  const next = { ...(event as unknown as Record<string, unknown>) }
  next.index = Number(next.index) + offset
  if (pad && event.type === 'content_block_delta') {
    // 思考增量在第二轮不应再算进第一轮的思考块：按文本增量处理即可
  }
  return next as unknown as MessageStreamEvent
}

/**
 * 自定义接口的完整一轮：先带工具请求，模型若调用工具就由插件执行，
 * 把结果回填后继续请求，直到模型给出最终回答（最多三轮）。
 */
export async function* streamWithRelayTools(
  body: Record<string, unknown>,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const messages: unknown[] = Array.isArray(body.messages) ? [...(body.messages as unknown[])] : []
  const lastUser = [...((body.messages as { role?: string; content?: unknown }[]) ?? [])]
    .reverse()
    .find((message) => message?.role === 'user')
  const fallback = typeof lastUser?.content === 'string'
    ? lastUser.content
    : Array.isArray(lastUser?.content)
      ? (lastUser.content as { type?: string; text?: string }[])
        .filter((block) => block?.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
      : ''
  let offset = 0
  let failedRounds = 0
  const MAX_TOOL_ROUNDS = 4
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    // 最后一轮不再声明工具，逼模型给出最终回答，而不是继续调用。
    const offerTools = round < MAX_TOOL_ROUNDS
    const requestBody = offerTools
      ? { ...body, messages, tools: RELAY_TOOLS, tool_choice: { type: 'auto' } }
      : { ...body, messages }
    const calls: { id: string; name: string; input: Record<string, unknown> }[] = []
    const buffered: MessageStreamEvent[] = []
    let stopReason: string | undefined
    for await (const event of streamChatCompletion(requestBody, signal)) {
      if (event.type === 'content_block_start') {
        const block = (event as unknown as { content_block?: Record<string, unknown> }).content_block
        if (block && block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          calls.push({ id: block.id, name: block.name, input: (block.input as Record<string, unknown>) ?? {} })
        }
      }
      if (event.type === 'message_delta') {
        const delta = (event as unknown as { delta?: { stop_reason?: string } }).delta
        if (delta?.stop_reason) stopReason = delta.stop_reason
      }
      if (offerTools) {
        buffered.push(event)
      } else {
        yield offsetEvent(event, offset, false)
      }
    }
    if (!offerTools) return
    // 模型这一轮没有调用工具 → 它已经直接作答，把本轮内容补发给界面。
    if (stopReason !== 'tool_use' || !calls.length) {
      for (const event of buffered) yield offsetEvent(event, offset, false)
      return
    }
    // 确实调用了工具：中间轮的思考/正文不展示（与原版服务端工具一致），只保留工具步骤。
    const assistantContent: unknown[] = calls.map((call) => ({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: call.input,
    }))
    // 输出被 token 上限截断时，工具参数可能不完整：不执行，回填错误让模型重发。
    const truncated = stopReason === 'length'
    const batch = calls.slice(0, 3)
    const runs = truncated
      ? batch.map(() => ({
        blocks: [] as ReplyBlock[],
        result: '工具调用因输出长度被截断，参数可能不完整。请不要执行，改用更短的参数重新调用。',
      }))
      : await Promise.all(
        batch.map((call) => executeRelayTool(call.name, call.input, signal, fallback).catch(() => ({
          blocks: [] as ReplyBlock[],
          result: '工具执行失败，请基于已有信息回答并说明无法联网。',
        })))
      )
    const resultContent: unknown[] = []
    for (let i = 0; i < batch.length; i += 1) {
      const call = batch[i]
      const run = runs[i]
      for (const block of run.blocks) {
        yield { type: 'content_block_start', index: offset++, content_block: block } as unknown as MessageStreamEvent
        yield { type: 'content_block_stop', index: offset - 1 } as unknown as MessageStreamEvent
      }
      resultContent.push({ type: 'tool_result', tool_use_id: call.id, content: run.result })
    }
    messages.push({ role: 'assistant', content: assistantContent })
    messages.push({ role: 'user', content: resultContent })
    // 连续两轮工具都没产出（全部报错）就停手，避免无限重试烧额度。
    if (runs.every((run) => run.blocks.length === 0)) {
      failedRounds += 1
      if (failedRounds >= 2) return
    } else {
      failedRounds = 0
    }
  }
}