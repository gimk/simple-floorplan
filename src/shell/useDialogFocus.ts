// Focus management for dialogs and popovers: focus moves in on open, Tab stays inside,
// and focus goes back to the previous element on close.
import { useEffect, type RefObject } from 'react'

export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Pure part: where must focus go on Tab / Shift+Tab?
 * Returns the element to focus, or null when the browser may move focus by itself.
 */
export function nextTrapTarget<T>(items: T[], active: T | null, shift: boolean): T | null {
  if (items.length === 0) return null
  const first = items[0]
  const last = items[items.length - 1]
  const idx = active === null ? -1 : items.indexOf(active)
  if (idx === -1) return shift ? last : first
  if (shift && active === first) return last
  if (!shift && active === last) return first
  return null
}

/** Pure part: must the global shortcuts stay silent? True when a modal, dialog or open menu is active. */
export function shortcutsBlocked(
  state: { shortcutsOpen: boolean; moreOpen: boolean },
  doc?: { querySelector: (sel: string) => unknown } | null,
): boolean {
  if (state.shortcutsOpen || state.moreOpen) return true
  return !!doc?.querySelector('[role="dialog"]')
}

/** Focus the first focusable element of `container` on open, trap Tab inside it, restore focus on close. */
export function useDialogFocus(open: boolean, containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return
    const previous = document.activeElement as HTMLElement | null
    const items = () => [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!container.contains(document.activeElement)) {
      const first = items()[0]
      if (first) first.focus()
      else {
        if (container.tabIndex < 0) container.tabIndex = -1
        container.focus()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = items()
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const active = container.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null
      const target = nextTrapTarget(list, active, e.shiftKey)
      if (target) {
        e.preventDefault()
        target.focus()
      }
    }
    container.addEventListener('keydown', onKey)
    return () => {
      container.removeEventListener('keydown', onKey)
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus()
    }
  }, [open, containerRef])
}
