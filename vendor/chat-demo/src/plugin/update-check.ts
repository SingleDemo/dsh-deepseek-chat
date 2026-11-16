/**
 * Local patch: tell the user when a newer release is published.
 *
 * The plugin index is served from jsDelivr (the same CDN the panel already uses
 * for mermaid), so checking costs one small JSON request and works without an
 * account. A failed check never blocks the panel — it only reports "unknown".
 */
declare const __PLUGIN_VERSION__: string

const INDEX_URL = 'https://cdn.jsdelivr.net/gh/SingleDemo/dsh-deepseek-chat@main/market/index.json'
const CACHE_KEY = 'chat-demo:update-check'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

export const PLUGIN_VERSION = __PLUGIN_VERSION__

export type UpdateState =
  | { state: 'latest'; current: string }
  | { state: 'available'; current: string; latest: string }
  | { state: 'unknown'; current: string; reason: string }

type IndexVersion = { version?: string }
type IndexPlugin = { name?: string; versions?: IndexVersion[] }
type IndexBody = { plugins?: IndexPlugin[] }

/** Compare two plain SemVer strings; pre-release tags sort before releases. */
export const compareVersions = (a: string, b: string): number => {
  const split = (value: string) => {
    const [core, pre] = value.split('-')
    return { core: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre: pre ? pre.split('.') : [] }
  }
  const left = split(a)
  const right = split(b)
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  if (!left.pre.length && !right.pre.length) return 0
  if (!left.pre.length) return 1
  if (!right.pre.length) return -1
  const length = Math.max(left.pre.length, right.pre.length)
  for (let i = 0; i < length; i += 1) {
    const l = left.pre[i]
    const r = right.pre[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = Number(l)
    const rn = Number(r)
    const numeric = !Number.isNaN(ln) && !Number.isNaN(rn)
    if (numeric && ln !== rn) return ln > rn ? 1 : -1
    if (!numeric && l !== r) return l > r ? 1 : -1
  }
  return 0
}

/** The highest version the index lists for this plugin. */
const latestFromIndex = (body: IndexBody): string | null => {
  const plugin = (body.plugins ?? []).find((entry) => entry && entry.name === 'dsh-deepseek-chat')
  if (!plugin || !Array.isArray(plugin.versions)) return null
  let latest: string | null = null
  for (const entry of plugin.versions) {
    const version = entry && entry.version
    if (typeof version !== 'string') continue
    if (latest === null || compareVersions(version, latest) > 0) latest = version
  }
  return latest
}

const readCache = (): { at: number; latest: string } | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (parsed && typeof parsed.at === 'number' && typeof parsed.latest === 'string') return parsed
  } catch {
    // ignore a corrupt cache
  }
  return null
}

/**
 * Compare the running version with the published index.
 * @param force - ignore the cached answer and ask the index again.
 */
export const checkForUpdate = async (force = false): Promise<UpdateState> => {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return compareVersions(cached.latest, PLUGIN_VERSION) > 0
      ? { state: 'available', current: PLUGIN_VERSION, latest: cached.latest }
      : { state: 'latest', current: PLUGIN_VERSION }
  }
  try {
    const response = await fetch(INDEX_URL, { cache: 'no-store', headers: { accept: 'application/json' } })
    if (!response.ok) return { state: 'unknown', current: PLUGIN_VERSION, reason: `HTTP ${response.status}` }
    const latest = latestFromIndex((await response.json()) as IndexBody)
    if (!latest) return { state: 'unknown', current: PLUGIN_VERSION, reason: 'not-in-index' }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), latest }))
    } catch {
      // storage is optional
    }
    return compareVersions(latest, PLUGIN_VERSION) > 0
      ? { state: 'available', current: PLUGIN_VERSION, latest }
      : { state: 'latest', current: PLUGIN_VERSION }
  } catch (error) {
    return {
      state: 'unknown',
      current: PLUGIN_VERSION,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
