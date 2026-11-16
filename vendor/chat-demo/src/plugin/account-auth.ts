/**
 * Local patch: use the Harness's DeepSeek account login instead of an API key.
 *
 * The Host half serves `/plugins/dsh-deepseek-chat/account-token`, which answers
 * `{ ok: true, token }` for a signed-in account on a loopback request. The token
 * is kept in memory only and refetched when a request is rejected.
 */
import { useSettings } from '../services/settings.js'

const TOKEN_ROUTE = '/plugins/dsh-deepseek-chat/account-token'
/** Refresh the token well before it can expire; a 401 also forces a refetch. */
const TOKEN_TTL_MS = 10 * 60 * 1000

export type AccountTokenState =
  | { state: 'ok'; token: string }
  | { state: 'signed-out' }
  | { state: 'unavailable' }

let cached: { token: string; at: number } | null = null
let inflight: Promise<AccountTokenState> | null = null

/** True when the user picked the account login instead of a pasted key. */
export const usesAccountAuth = (): boolean => useSettings.getState().authMode === 'account'

const fetchToken = async (origin?: string): Promise<AccountTokenState> => {
  const query = origin ? `?origin=${encodeURIComponent(origin)}` : ''
  try {
    const response = await fetch(`${TOKEN_ROUTE}${query}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return { state: 'unavailable' }
    const body = (await response.json()) as { ok?: boolean; token?: string; reason?: string }
    if (body.ok && typeof body.token === 'string' && body.token) {
      cached = { token: body.token, at: Date.now() }
      return { state: 'ok', token: body.token }
    }
    cached = null
    return { state: body.reason === 'unavailable' ? 'unavailable' : 'signed-out' }
  } catch {
    cached = null
    return { state: 'unavailable' }
  }
}

/** Resolve the account token, reusing the cached one until it goes stale. */
export const accountToken = async (origin?: string, force = false): Promise<AccountTokenState> => {
  if (!force && cached && Date.now() - cached.at < TOKEN_TTL_MS) {
    return { state: 'ok', token: cached.token }
  }
  inflight ??= fetchToken(origin).finally(() => {
    inflight = null
  })
  return inflight
}

/** Drop the cached token; the next request resolves a fresh one. */
export const invalidateAccountToken = (): void => {
  cached = null
}

/** Extra authentication headers for one API call; empty when a key is used. */
export const accountAuthHeaders = async (origin?: string): Promise<Record<string, string>> => {
  if (!usesAccountAuth()) return {}
  const result = await accountToken(origin)
  return result.state === 'ok' ? { 'x-dsh-auth-token': result.token } : {}
}
