/**
 * Host half of the DeepSeek chat plugin.
 *
 * It exposes one loopback route that hands the browser half a short-lived
 * account token resolved by the Harness's own DeepSeek account service, so a
 * signed-in user can chat without ever pasting an API key. The token never
 * leaves the Host except over that route, and the route refuses non-loopback
 * callers.
 */
const ROUTE = '/plugins/dsh-deepseek-chat/account-token'
const DEFAULT_INFERENCE_ORIGIN = 'https://api.deepseek.com'
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** Wait for the HTTP server (the panel is a web plugin anyway). */
export const inject = ['webServer']

/** Read an optional service without failing when the composition lacks it. */
function optionalService(ctx, name) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(name) || undefined
    return ctx[name] || undefined
  } catch {
    return undefined
  }
}

/** The host part of the request's Host header, lowercased. */
function hostnameOf(request) {
  const host = String((request.headers && request.headers.host) || '')
  const value = host.includes(']') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return value.toLowerCase()
}

function reply(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

/**
 * Resolve the account token for one request. The browser may pass `origin` when
 * the user configured a custom API base URL; the account service itself refuses
 * origins it was not configured for.
 */
async function resolveToken(service, origin) {
  if (!service || typeof service.resolveToken !== 'function') return undefined
  const base = origin && /^https?:\/\//.test(origin) ? origin : DEFAULT_INFERENCE_ORIGIN
  try {
    return await service.resolveToken(`${base.replace(/\/+$/, '')}/anthropic/v1/messages`)
  } catch {
    return undefined
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer || typeof webServer.register !== 'function') return () => {}
    return webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (request, response) => {
        if (!LOOPBACK.has(hostnameOf(request))) {
          reply(response, 403, { ok: false, reason: 'forbidden' })
          return
        }
        const account = optionalService(ctx, 'deepseekAccount')
        const url = new URL(String(request.url || ROUTE), 'http://127.0.0.1')
        const origin = url.searchParams.get('origin') || DEFAULT_INFERENCE_ORIGIN
        const token = await resolveToken(account, origin)
        if (!token) {
          reply(response, 200, { ok: false, reason: account ? 'signed-out' : 'unavailable' })
          return
        }
        reply(response, 200, { ok: true, token })
      },
    })
  }, 'deepseek-chat: account token route')
}
