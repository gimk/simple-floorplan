// Live keyboard modifier tracker (Shift, Alt, Cmd/Ctrl). Safe when `window` is undefined (SSR, Node).
export type Modifiers = { shift: boolean; alt: boolean; cmd: boolean }

type ModEvent = { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }

let current: Modifiers = { shift: false, alt: false, cmd: false }
const listeners = new Set<(m: Modifiers) => void>()
let attached = false

function set(next: Modifiers): Modifiers {
  if (next.shift === current.shift && next.alt === current.alt && next.cmd === current.cmd) return current
  current = next
  for (const cb of [...listeners]) cb(current)
  return current
}

/**
 * The single "no snap" modifier for every tool: Cmd (macOS) or Ctrl (elsewhere).
 * Alt is NOT used: in the rect tool Alt means "from centre".
 */
export const isFreeSnap = (m: Pick<Modifiers, 'cmd'>): boolean => m.cmd

/** Human-readable label of the no-snap key, for tool hints. Same text in every tool. */
export const FREE_SNAP_LABEL: string =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
    ? '⌘'
    : 'Ctrl'

/** Read the modifier state from a keyboard or pointer event, update the tracker and notify. */
export function syncModifiersFromEvent(e: ModEvent): Modifiers {
  return set({ shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey || e.ctrlKey })
}

/** Current modifier state (a stable object until a modifier changes). */
export function getModifiers(): Modifiers {
  return current
}

const onKey = (e: KeyboardEvent) => { syncModifiersFromEvent(e) }
const onBlur = () => { set({ shift: false, alt: false, cmd: false }) }

function attach() {
  if (attached || typeof window === 'undefined') return
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  window.addEventListener('blur', onBlur)
  attached = true
}

function detach() {
  if (!attached || typeof window === 'undefined') return
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKey)
  window.removeEventListener('blur', onBlur)
  attached = false
}

/** Subscribe to modifier changes. Returns the unsubscribe function. */
export function subscribeModifiers(cb: (m: Modifiers) => void): () => void {
  listeners.add(cb)
  attach()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) detach()
  }
}
