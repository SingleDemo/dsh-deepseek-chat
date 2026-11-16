/**
 * The vendored chat-demo application plus the panel-local theme bridge.
 *
 * Loaded lazily by `entry.tsx`, so the prism/katex/mermaid/markdown stack is
 * parsed only when the chat panel is first opened.
 */
import { createElement, useEffect, useRef } from 'react'
import { App as ChatDemoApp } from '../vendor/chat-demo/src/app/App.js'
import { useSettings } from '../vendor/chat-demo/src/services/settings.js'

const HOST_CLASS = 'dsc-demo-host'

/**
 * Mirror the demo's theme preference onto the panel container, so its palette
 * never repaints the rest of the Harness page.
 */
export function DemoPanel() {
  const ref = useRef(null)
  const preference = useSettings((state) => state.themePreference)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => {
      const node = ref.current
      if (!node) return
      const theme = preference === 'system' ? (query.matches ? 'dark' : 'light') : preference
      node.classList.toggle('dark', theme === 'dark')
      node.classList.toggle('light', theme === 'light')
      if (theme === 'dark') node.setAttribute('data-ds-dark-theme', 'dark')
      else node.removeAttribute('data-ds-dark-theme')
    }
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [preference])
  return createElement('div', { className: HOST_CLASS, ref }, createElement(ChatDemoApp))
}
