type Mermaid = typeof import('mermaid').default

/**
 * Local patch: mermaid is fetched on demand instead of being bundled, which
 * keeps the plugin bundle several megabytes smaller. The UMD build registers
 * `window.mermaid`, and the vendored app renders exactly as before.
 */
const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11.10.1/dist/mermaid.min.js'

let mermaidPromise: Promise<Mermaid> | null = null
let renderQueue = Promise.resolve()
let nextId = 0

const loadScript = () =>
  new Promise<Mermaid>((resolve, reject) => {
    const global = (window as unknown as { mermaid?: Mermaid }).mermaid
    if (global) {
      resolve(global)
      return
    }
    const script = document.createElement('script')
    script.src = MERMAID_CDN
    script.async = true
    script.onload = () => {
      const loaded = (window as unknown as { mermaid?: Mermaid }).mermaid
      if (loaded) {
        resolve(loaded)
      } else {
        reject(new Error('mermaid did not register a global'))
      }
    }
    script.onerror = () => reject(new Error('mermaid failed to load'))
    document.head.appendChild(script)
  })

const loadMermaid = () => {
  mermaidPromise ??= loadScript().catch((error: unknown) => {
    mermaidPromise = null
    throw error
  })
  return mermaidPromise
}

/** 转义图片标签，对同一图中的全部标签生效。 */
const sanitizeMermaid = (code: string) => code.replace(/<((?:img|image)\s+)/gi, '&lt;$1')

/** 串行执行初始化和绘制，避免不同图表互相覆盖 Mermaid 的全局配置。 */
export const renderMermaid = (
  code: string,
  dark: boolean,
  isCancelled: () => boolean
): Promise<string | null> => {
  const result = renderQueue.then(async () => {
    if (isCancelled() || !code.trim()) {
      return null
    }

    const mermaid = await loadMermaid()
    if (isCancelled()) {
      return null
    }

    mermaid.initialize({
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
    })

    const { svg } = await mermaid.render(`standalone-mermaid-${nextId++}`, sanitizeMermaid(code))
    return isCancelled() ? null : svg
  })

  // 某张图失败不阻塞后续图表；调用方仍收到原始任务的错误。
  renderQueue = result.then(
    () => {},
    () => {}
  )
  return result
}
