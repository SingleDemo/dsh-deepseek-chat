/**
 * The vendored chat-demo application plus the panel-local theme bridge.
 *
 * Loaded lazily by `entry.tsx`, so the prism/katex/mermaid/markdown stack is
 * parsed only when the chat panel is first opened.
 */
import { createElement, useEffect, useRef } from 'react'
import { App as ChatDemoApp } from '../vendor/chat-demo/src/app/App.js'
import { useSettings } from '../vendor/chat-demo/src/services/settings.js'
import { setPortalTarget } from '../vendor/chat-demo/src/plugin/portal.js'

const HOST_CLASS = 'dsc-demo-host'

/**
 * Mirror the demo's theme preference onto the panel container, so its palette
 * never repaints the rest of the Harness page.
 */
/** Read the theme the Harness is showing, so "system" can follow the host. */
function hostTheme() {
  const source = document.documentElement.getAttribute('data-ds-theme-source')
  if (source === 'dark' || source === 'light') return source
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
}

export function DemoPanel() {
  const ref = useRef(null)
  const preference = useSettings((state) => state.themePreference)
  useEffect(() => {
    setPortalTarget(ref.current)
    return () => setPortalTarget(null)
  }, [])
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => {
      const node = ref.current
      if (!node) return
      const theme = preference === 'system' ? hostTheme() : preference
      node.classList.toggle('dark', theme === 'dark')
      node.classList.toggle('light', theme === 'light')
      if (theme === 'dark') node.setAttribute('data-ds-dark-theme', 'dark')
      else node.removeAttribute('data-ds-dark-theme')
    }
    sync()
    query.addEventListener('change', sync)
    // DSH switches its own theme without a media-query change, so watch the root too.
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-theme-source'] })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => {
      query.removeEventListener('change', sync)
      observer.disconnect()
    }
  }, [preference])
  return createElement('div', { className: HOST_CLASS, ref }, createElement(ChatDemoApp))
}
