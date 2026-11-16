import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * Local patch (not upstream): dialogs render into the plugin panel instead of
 * `document.body`, so their overlay dims the panel rather than the whole
 * Harness window. Every other popover keeps its viewport-anchored coordinates.
 */
let target: HTMLElement | null = null

export const setPortalTarget = (element: HTMLElement | null) => {
  target = element
}

export const PanelPortal = ({ children }: { children: ReactNode }) =>
  createPortal(children, target ?? document.body)
