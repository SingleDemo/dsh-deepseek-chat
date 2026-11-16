/**
 * Browser half of the DeepSeek chat plugin.
 *
 * The panel is the vendored chat-demo application (`vendor/chat-demo/src`,
 * MIT, see UPSTREAM.md) rendered inside a host slot. Only the shell around it
 * belongs to this plugin: the sidebar launcher, the theme variables scoped to
 * the panel, and the stylesheet injection.
 */
import { Suspense, createElement, lazy } from 'react'
import { CSS_TEXT } from './generated/css.js'

// The demo app (and its markdown/math/diagram stack) loads when the panel opens.
const DemoPanel = lazy(() => import('./demo-panel.js').then((module) => ({ default: module.DemoPanel })))

const PANEL_ID = 'deepseek-chat'
const NS = 'deepseek-chat'
const STYLE_ID = 'dsh-deepseek-chat-css'
const HOST_CLASS = 'dsc-demo-host'

/** Panel-local rules: the demo fills an absolutely positioned box; give it one. */
const HOST_CSS = `
.${HOST_CLASS} {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  background-color: var(--dsw-alias-bg-base);
}
.${HOST_CLASS} > div { flex: 1; min-width: 0; min-height: 0; }
`

/** Append both stylesheets once per page, ignoring repeat mounts. */
function injectStyles() {
  if (typeof document === 'undefined' || !document.head) return () => {}
  if (document.getElementById(STYLE_ID)) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS_TEXT + HOST_CSS
  document.head.appendChild(style)
  return () => {
    if (style.parentNode) style.parentNode.removeChild(style)
  }
}

/** Draw the sidebar launcher as a chat bubble. */
function PanelIcon(props) {
  const size = props && props.size ? props.size : 20
  return createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
  },
    createElement('path', {
      d: 'M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.3 3.2a.6.6 0 0 1-.95-.48V17H4.5A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5Z',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinejoin: 'round',
    }),
    createElement('path', {
      d: 'M8 10.2h8M8 13.2h5',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinecap: 'round',
    }))
}

/**
 * Mirror the demo's theme preference onto the panel container, so its palette
 * never repaints the rest of the Harness page.
 */
function DemoHost() {
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

/** The `main` slot occupant. */
function ChatPanel() {
  return createElement(Suspense, { fallback: null }, createElement(DemoPanel))
}

export { injectStyles }

export default {
  inject: ['slots', 'locale', 'layout'],
  apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, {
      en: { panel: 'DeepSeek chat' },
      zh: { panel: 'DeepSeek 对话' },
    }), 'deepseek-chat: dictionaries')
    const t = ctx.locale.bind(NS)
    ctx.effect(injectStyles, 'deepseek-chat: stylesheet')

    const openPanel = () => {
      try {
        ctx.layout.selectPanel(PANEL_ID)
      } catch (error) {
        console.error('[deepseek-chat] could not open the chat panel', error)
      }
    }
    const backToConversation = () => {
      try {
        ctx.layout.selectPanel(null)
      } catch (error) {
        console.error('[deepseek-chat] could not return to the conversation', error)
      }
    }
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 40,
      label: () => t('panel'),
      locale: NS,
    }, PanelIcon))
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: () => ({ t, openPanel, backToConversation }),
    }, ChatPanel))
  },
}
