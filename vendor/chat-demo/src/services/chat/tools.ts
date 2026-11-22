/**
 * 插件改动：自定义对话接口下的联网工具阶段。
 *
 * 由自定义模型自己判断是否需要联网（客户端 tool_use），真正执行搜索/读链接时
 * 调用 DeepSeek 官方端点，再把结果作为资料注入这一轮的回答请求。
 * 任何一步失败都返回 null，调用方继续按普通对话发送。
 */
import { chatComplete, officialComplete } from '../api/client.js'
import type {
  ServerToolBlock,
  WebFetchToolResultBlock,
  WebSearchResult,
  WebSearchToolResultBlock,
} from '../api/types.js'
import type { ReplyBlock } from './types.js'

/** 模型可调用的工具；客户端工具，与 DeepSeek 的服务端工具不是一回事。 */
const CLIENT_TOOLS = [
  {
    name: 'web_search',
    description:
      'Search the web for current information. Use it when the question needs fresh news, prices, or anything after your training data.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'search keywords' } },
      required: ['query'],
    },
  },
  {
    name: 'read_url',
    description: 'Read a web page the user linked and use its content when the answer depends on it.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'absolute http(s) url' } },
      required: ['url'],
    },
  },
]

const DECIDE_SYSTEM =
  'You can call web_search and read_url. Call a tool only when the answer needs live information or the content of a link the user gave; otherwise answer directly.'

type ToolCall = { kind: 'search'; query: string } | { kind: 'read'; url: string }

export type ToolPhase = {
  /** 预先放进回复里的工具步骤与来源块，界面会按原有样式展示 */
  blocks: ReplyBlock[]
  /** 追加到系统提示词里的参考资料 */
  context: string
  searches: number
  reads: number
}

const randomHex = (): string => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const toolUseId = (kind: 's' | 'rl') => `srvtoolu_${kind}_${randomHex()}`

/** 让自定义模型决定要不要联网、搜什么 */
/** 工具阶段每一步都有超时，避免用户长时间干等。 */
const withTimeout = (signal: AbortSignal, ms: number): AbortSignal => {
  try {
    return AbortSignal.any([signal, AbortSignal.timeout(ms)])
  } catch {
    return signal
  }
}

const decide = async (question: string, model: string, signal: AbortSignal): Promise<ToolCall[]> => {
  const payload = await chatComplete(
    {
      model,
      system: DECIDE_SYSTEM,
      max_tokens: 512,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: question }],
      tools: CLIENT_TOOLS,
      tool_choice: { type: 'auto' },
    },
    withTimeout(signal, 45000)
  )
  const content = Array.isArray(payload.content) ? payload.content : []
  const calls: ToolCall[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type !== 'tool_use' || typeof item.name !== 'string') continue
    const input = item.input && typeof item.input === 'object' ? (item.input as Record<string, unknown>) : {}
    if (item.name === 'web_search' && typeof input.query === 'string' && input.query.trim()) {
      calls.push({ kind: 'search', query: input.query.trim() })
    }
    if (item.name === 'read_url' && typeof input.url === 'string' && /^https?:\/\//i.test(input.url.trim())) {
      calls.push({ kind: 'read', url: input.url.trim() })
    }
    if (calls.length >= 3) break
  }
  return calls
}

/** 官方执行搜索；返回可直接展示的结果与给模型看的文本 */
const executeSearch = async (
  query: string,
  signal: AbortSignal
): Promise<{ sources: WebSearchResult[]; text: string }> => {
  const payload = await officialComplete(
    {
      model: 'deepseek-flash',
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: query }],
      tools: [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }],
      safety_check: { level: 'high' },
    },
    withTimeout(signal, 60000)
  )
  const blocks = Array.isArray(payload.content) ? payload.content : []
  const sources: WebSearchResult[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type !== 'web_search_tool_result' || !Array.isArray(item.content)) continue
    for (const entry of item.content) {
      if (entry && typeof entry === 'object' && (entry as Record<string, unknown>).type === 'web_search_result') {
        sources.push(entry as WebSearchResult)
      }
    }
  }
  const text = sources
    .slice(0, 6)
    .map((source, index) => `[${index + 1}] ${source.title} ${source.url}\n${source.snippet ?? ''}`.trim())
    .join('\n')
  return { sources, text }
}

/** 官方读取链接；把官方整理出的正文作为工具结果 */
const executeRead = async (url: string, signal: AbortSignal): Promise<{ text: string }> => {
  const payload = await officialComplete(
    {
      model: 'deepseek-flash',
      max_tokens: 1600,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: `请阅读这个网页并提取与问题有关的要点：${url}` }],
      tools: [{ type: 'deepseek_read_url', name: 'deepseek_read_url' }],
      safety_check: { level: 'high' },
    },
    withTimeout(signal, 60000)
  )
  const blocks = Array.isArray(payload.content) ? payload.content : []
  const text = blocks
    .filter((block) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text')
    .map((block) => String((block as Record<string, unknown>).text ?? ''))
    .join('\n')
    .slice(0, 4000)
  return { text }
}

/**
 * 跑一次工具阶段：判断 → 执行 → 返回块与上下文。
 * 只在「自定义对话接口 + 智能搜索开启 + 新问题」时调用。
 */
export const runToolPhase = async (input: {
  question: string
  model: string
  signal: AbortSignal
}): Promise<ToolPhase | null> => {
  if (!input.question.trim()) return null
  const calls = await decide(input.question, input.model, input.signal)
  if (!calls.length) return null

  const blocks: ReplyBlock[] = []
  const parts: string[] = []
  let searches = 0
  let reads = 0

  for (const call of calls) {
    if (input.signal.aborted) break
    if (call.kind === 'search') {
      const id = toolUseId('s')
      const { sources, text } = await executeSearch(call.query, input.signal)
      const use: ServerToolBlock = {
        type: 'server_tool_use',
        id,
        name: 'deepseek_web_search',
        input: { action: 'search', queries: [call.query] },
        caller: { type: 'direct' },
        kind: 'search',
      }
      const result: WebSearchToolResultBlock = {
        type: 'web_search_tool_result',
        tool_use_id: id,
        content: sources,
        kind: 'search',
      }
      blocks.push(use as unknown as ReplyBlock, result as unknown as ReplyBlock)
      searches += 1
      if (text) parts.push(`搜索「${call.query}」的结果：\n${text}`)
      continue
    }
    const id = toolUseId('rl')
    const { text } = await executeRead(call.url, input.signal)
    const use: ServerToolBlock = {
      type: 'server_tool_use',
      id,
      name: 'deepseek_read_url',
      input: { action: 'read_link', url: call.url },
      caller: { type: 'direct' },
      kind: 'read_link',
    }
    const result: WebFetchToolResultBlock = {
      type: 'web_fetch_tool_result',
      tool_use_id: id,
      content: {
        type: 'web_fetch_result',
        url: call.url,
        content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '' }, title: null },
        published_at: null,
      },
      kind: 'read_link',
    }
    blocks.push(use as unknown as ReplyBlock, result as unknown as ReplyBlock)
    reads += 1
    if (text) parts.push(`链接 ${call.url} 的内容要点：\n${text}`)
  }

  if (!blocks.length) return null
  const context = parts.length
    ? `\n\n以下是刚刚联网取得的资料，回答时可直接使用；不要声称无法联网：\n${parts.join('\n\n')}`
    : ''
  return { blocks, context, searches, reads }
}
