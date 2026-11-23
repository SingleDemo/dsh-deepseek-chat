/**
 * 插件改动：自定义对话接口的「简化版 pi agent loop」。
 *
 * 结构参照 earendil-works/pi 的 agent-loop：
 *   收集一轮的 tool calls → 执行（并行）→ 每个调用写回一个 tool_result →
 *   带着结果再请求，直到模型不再调用工具或达到上限。
 *
 * pi 的包没有发布到 npm（agent 未发布，pi-ai 依赖 AWS/node:http 等无法进浏览器），
 * 所以这里按同样的语义实现一个只带「联网」工具的简化版：
 *   - web_search：始终可用
 *   - read_url：仅当用户的消息里真的带链接时声明，避免模型调用时漏参数
 *
 * 只在自定义对话接口下使用；官方端点保持原生行为。
 */
import { officialEndpoint, request, streamChatCompletion } from './client.js'
import type { MessageStreamEvent, WebSearchResult } from './types.js'
import type { ReplyBlock } from '../chat/types.js'

type Effort = 'low' | 'high' | 'max'

type ToolName = 'web_search' | 'read_url'

type ToolDeclaration = {
  name: ToolName
  description: string
  input_schema: Record<string, unknown>
}

const WEB_SEARCH: ToolDeclaration = {
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
}

const READ_URL: ToolDeclaration = {
  name: 'read_url',
  description: 'Fetch and read one web page so the answer can rely on its content.',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'absolute http(s) url' } },
    required: ['url'],
  },
}

type ToolCall = { id: string; name: string; input: Record<string, unknown> }

type ToolOutcome = { blocks: ReplyBlock[]; result: string; failed: boolean }

/** 失败/无结果时也要发结果块：否则界面会把"没有结果"渲染成"联网搜索暂不可用"。 */
const searchErrorBlock = (id: string): ReplyBlock => ({
  type: 'web_search_tool_result',
  tool_use_id: id,
  content: [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }],
  kind: 'search',
} as unknown as ReplyBlock)

const fetchErrorBlock = (id: string): ReplyBlock => ({
  type: 'web_fetch_tool_result',
  tool_use_id: id,
  content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' },
  kind: 'read_link',
} as unknown as ReplyBlock)

const randomHex = (): string => {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const toolId = (kind: 's' | 'rl') => `srvtoolu_${kind}_${randomHex()}`

const officialAuth = async (): Promise<Record<string, string>> => (await officialEndpoint()).headers

const linkIn = (text: string): string | undefined => (text.match(/https?:\/\/[^\s"'）)]+/) || [])[0]

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && typeof block === 'object' && (block as { type?: string }).type === 'text')
      .map((block) => String((block as { text?: string }).text ?? ''))
      .join('\n')
  }
  return ''
}

/** 工具调用块：先下发，界面立刻显示「搜索 xxx」 */
const useBlock = (name: ToolName, id: string, input: Record<string, unknown>, query: string): ReplyBlock => {
  if (name === 'read_url') {
    return {
      type: 'server_tool_use',
      id,
      name: 'deepseek_read_url',
      input: { action: 'read_link', url: String(input.url ?? '') },
      caller: { type: 'direct' },
      kind: 'read_link',
    } as unknown as ReplyBlock
  }
  return {
    type: 'server_tool_use',
    id,
    name: 'deepseek_web_search',
    input: { action: 'search', queries: [query] },
    caller: { type: 'direct' },
    kind: 'search',
  } as unknown as ReplyBlock
}

const callSearch = async (query: string, signal: AbortSignal): Promise<{ sources: WebSearchResult[]; text: string }> => {
  const response = await request('https://api.deepseek.com/v1/tools/search', {
    method: 'POST',
    headers: { ...(await officialAuth()), 'content-type': 'application/json' },
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

const callFetch = async (url: string, signal: AbortSignal): Promise<{ title: string; text: string }> => {
  const response = await request('https://api.deepseek.com/v1/tools/fetch', {
    method: 'POST',
    headers: { ...(await officialAuth()), 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  })
  const payload = (await response.json()) as { title?: unknown; content?: unknown }
  return {
    title: typeof payload.title === 'string' ? payload.title : url,
    content: typeof payload.content === 'string' ? payload.content.slice(0, 8000) : '',
  }
}

/** 执行单个工具：永远返回一个结果（pi 的「每个调用必有 tool_result」） */
const runTool = async (
  call: ToolCall,
  signal: AbortSignal,
  fallbackQuery: string
): Promise<ToolOutcome> => {
  if (call.name === 'read_url') {
    const url = typeof call.input.url === 'string' && /^https?:\/\//i.test(call.input.url)
      ? call.input.url.trim()
      : linkIn(fallbackQuery)
    if (!url) {
      return { blocks: [fetchErrorBlock(call.id)], result: 'read_url 缺少合法链接。请改用 web_search，或用用户消息里的链接重试。', failed: true }
    }
    try {
      const page = await callFetch(url, signal)
      return {
        blocks: [
          {
            type: 'web_fetch_tool_result',
            tool_use_id: call.id,
            content: {
              type: 'web_fetch_result',
              url,
              content: {
                type: 'document',
                source: { type: 'text', media_type: 'text/plain', data: '' },
                title: page.title,
              },
              published_at: null,
            },
            kind: 'read_link',
          } as unknown as ReplyBlock,
        ],
        result: page.content ? `网页《${page.title}》内容：\n${page.content}` : '网页内容为空',
        failed: false,
      }
    } catch {
      return { blocks: [fetchErrorBlock(call.id)], result: '读取该链接失败，请说明无法访问，并基于已搜索到的信息回答。', failed: true }
    }
  }
  if (call.name !== 'web_search') {
    return { blocks: [searchErrorBlock(call.id)], result: `未知工具 ${call.name}。只能用 web_search。`, failed: true }
  }
  const query = typeof call.input.query === 'string' && call.input.query.trim()
    ? call.input.query.trim()
    : fallbackQuery.trim()
  if (!query) {
    return { blocks: [searchErrorBlock(call.id)], result: 'web_search 缺少 query 参数，请补上关键词后重试。', failed: true }
  }
  // Search API 偶发失败：失败一次就重试一次，避免"明明拿到了网页却显示暂不可用"。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { sources, text } = await callSearch(query, signal)
      if (sources.length === 0 && attempt === 0) continue
      return {
        blocks: [
          {
            type: 'web_search_tool_result',
            tool_use_id: call.id,
            content: sources,
            kind: 'search',
          } as unknown as ReplyBlock,
        ],
        result: text ? `搜索「${query}」的结果：\n${text}` : `搜索「${query}」没有返回结果，请换个说法再搜一次。`,
        failed: sources.length === 0,
      }
    } catch {
      if (attempt === 1) {
        return { blocks: [searchErrorBlock(call.id)], result: '搜索失败，请如实说明无法联网，并基于已有知识回答。', failed: true }
      }
    }
  }
  return { blocks: [searchErrorBlock(call.id)], result: '搜索失败。', failed: true }
}

/**
 * 简化版 pi agent loop：带工具请求 → 执行工具 → 回填结果 → 继续，直到模型给出最终回答。
 * 所有轮次都使用调用方给定的思考强度，不做任何降级。
 */
export async function* runRelayAgentLoop(
  body: Record<string, unknown>,
  signal: AbortSignal,
  queryFallback: string
): AsyncGenerator<MessageStreamEvent> {
  const messages: unknown[] = Array.isArray(body.messages) ? [...(body.messages as unknown[])] : []
  const tools: ToolDeclaration[] = linkIn(queryFallback) ? [WEB_SEARCH, READ_URL] : [WEB_SEARCH]
  const MAX_ROUNDS = 4
  let failedRounds = 0
  let toolIndex = 0

  for (let round = 0; round <= MAX_ROUNDS; round += 1) {
    const offerTools = round < MAX_ROUNDS
    const requestBody = offerTools
      ? { ...body, messages, tools }
      : {
        ...body,
        messages,
        system: `${String(body.system ?? '')}\n\n本轮不要调用任何工具，请直接基于已有信息给出完整回答。`,
      }

    const calls: ToolCall[] = []
    let stopReason: string | undefined
    let sawText = false
    for await (const event of streamChatCompletion(requestBody, signal)) {
      if (event.type === 'content_block_start') {
        const block = (event as unknown as { content_block?: Record<string, unknown> }).content_block
        if (block && block.type === 'text') sawText = true
        if (block && block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          calls.push({ id: block.id, name: block.name, input: (block.input as Record<string, unknown>) ?? {} })
        }
      }
      if (event.type === 'message_delta') {
        const delta = (event as unknown as { delta?: { stop_reason?: string } }).delta
        if (delta?.stop_reason) stopReason = delta.stop_reason
      }
      // 参考 pi 的 message_update：每一轮的事件都实时下发（过程可见）。
      if (offerTools) {
        if (event.type === 'content_block_start') {
          const block = (event as unknown as { content_block?: { type?: string; text?: string } }).content_block
          if (block && block.type === 'text') {
            yield { ...event, content_block: { type: 'thinking', thinking: block.text ?? '' } } as unknown as MessageStreamEvent
            continue
          }
        }
        if (event.type === 'content_block_delta') {
          const delta = (event as unknown as { delta?: { type?: string; text?: string } }).delta
          if (delta && delta.type === 'text_delta') {
            yield { ...event, delta: { type: 'thinking_delta', thinking: delta.text ?? '' } } as unknown as MessageStreamEvent
            continue
          }
        }
      }
      yield event
    }

    if (!offerTools) {
      if (!sawText && !signal.aborted) {
        const notice = '模型这一轮没有生成正文，请重试；如果持续出现，建议先关闭深度思考。'
        yield { type: 'content_block_start', index: 800 + toolIndex++, content_block: { type: 'text', text: notice } } as unknown as MessageStreamEvent
        yield { type: 'content_block_stop', index: 800 + toolIndex - 1 } as unknown as MessageStreamEvent
      }
      return
    }
    // 没有工具调用 = 模型已经作答
    if (stopReason !== 'tool_use' || !calls.length) return

    const batch = calls.slice(0, 3)
    const truncated = stopReason === 'length'
    const plans = batch.map((call) => {
      const id = toolId(call.name === 'read_url' ? 'rl' : 's')
      const query = typeof call.input.query === 'string' ? call.input.query : queryFallback
      return { call, id, block: useBlock(call.name as ToolName, id, call.input, query) }
    })
    for (const plan of plans) {
      const index = 800 + toolIndex++
      yield { type: 'content_block_start', index, content_block: plan.block } as unknown as MessageStreamEvent
      yield { type: 'content_block_stop', index } as unknown as MessageStreamEvent
    }

    const outcomes: ToolOutcome[] = truncated
      ? plans.map((plan) => ({ blocks: [searchErrorBlock(plan.id)], result: '工具参数被输出上限截断，请用更短的参数重新调用。', failed: true }))
      : await Promise.all(
        plans.map((plan) =>
          runTool(plan.call, signal, queryFallback).catch(() => ({
            blocks: [searchErrorBlock(plan.id)],
            result: '工具执行异常，请如实说明无法联网。',
            failed: true,
          }))
        )
      )

    let sources = 0
    const resultContent: unknown[] = []
    for (let i = 0; i < plans.length; i += 1) {
      const plan = plans[i]
      const outcome = outcomes[i]
      for (const block of outcome.blocks) {
        const index = 800 + toolIndex++
        yield { type: 'content_block_start', index, content_block: block } as unknown as MessageStreamEvent
        yield { type: 'content_block_stop', index } as unknown as MessageStreamEvent
        const content = (block as { content?: unknown }).content
        if (Array.isArray(content)) sources += content.length
      }
      resultContent.push({ type: 'tool_result', tool_use_id: plan.id, content: outcome.result })
    }
    messages.push({
      role: 'assistant',
      content: batch.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })),
    })
    messages.push({ role: 'user', content: resultContent })

    if (sources > 0 && round === 0) {
      const index = 800 + toolIndex++
      const progress = `🔎 已获取 ${sources} 个网页，模型正在组织回答…`
      yield { type: 'content_block_start', index, content_block: { type: 'text', text: progress } } as unknown as MessageStreamEvent
      yield { type: 'content_block_stop', index } as unknown as MessageStreamEvent
    }

    const allFailed = outcomes.every((outcome) => outcome.failed && outcome.blocks.length === 0)
    failedRounds = allFailed ? failedRounds + 1 : 0
    if (failedRounds >= 2) return
  }
}

/** 兼容旧调用点：从消息里取用户问题作为工具参数兜底。 */
export async function* streamWithRelayTools(
  body: Record<string, unknown>,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : []
  const lastUser = [...messages].reverse().find((message) => message?.role === 'user')
  yield* runRelayAgentLoop(body, signal, textOf(lastUser?.content))
}

export type { Effort }
