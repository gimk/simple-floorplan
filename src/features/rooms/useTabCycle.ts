// Tab cycling of the Select tool (Rayon "TAB: flick through overlapping entities").
//
// With the Select tool in Edit mode, Tab selects the NEXT thing of the pick stack under the
// pointer (./pickStack.ts), and Shift + Tab the one before it; the order wraps around. The browser
// does not move the focus in that case (preventDefault). When the stack has one item only, Tab keeps
// its browser meaning, and a Tab pressed while a field has the focus is never touched.
//
// The listener lives here because the select tool's pointer handlers (./interaction.ts) are plain
// functions: this module installs the key listener when the app imports it (interaction.ts imports
// it), so Tab works without a change in tools.tsx / App.tsx. `useTabCycle()` does the same from a
// React effect for a component that prefers it; the first one wins, so there is never a second
// listener.
import { useEffect } from 'react'
import { useDoc, useUi } from '../../model/store'
import type { Vec } from '../../model/types'
import { nextInStack, pickStack } from './pickStack'

/** Slack of a pick on the plan, screen px: the hit line of a wall is 18 px wide, so 10 px of slack. */
export const PICK_PX = 10

/** How the listener sees the plan: the same two helpers as `useViewport()`. */
export type TabCycleView = {
  toWorld: (clientX: number, clientY: number) => Vec
  px: (screenPx: number) => number
}

/** True when the event comes from a field: the Tab key then belongs to that field. */
const isTyping = (t: EventTarget | null) => {
  if (typeof HTMLElement === 'undefined' || !(t instanceof HTMLElement)) return false
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ||
    t.isContentEditable
}

/** The plan canvas (canvas/Viewport.tsx). Cached: it does not change while the app runs. */
let svgCache: SVGSVGElement | null = null
function canvasSvg(): SVGSVGElement | null {
  if (typeof document === 'undefined') return null
  if (!svgCache || !svgCache.isConnected) svgCache = document.querySelector('svg[data-testid="floorplan-canvas"]')
  return svgCache
}

/** The view of the plan from the DOM: the same maths as the viewport (canvas/Viewport.tsx). */
export function domView(): TabCycleView | null {
  const svg = canvasSvg()
  if (!svg) return null
  return {
    toWorld: (clientX, clientY) => {
      const r = svg.getBoundingClientRect()
      const v = useUi.getState().view
      return { x: v.x + (clientX - r.left) / v.zoom, y: v.y + (clientY - r.top) / v.zoom }
    },
    px: (n) => n / useUi.getState().view.zoom,
  }
}

/** Last position of the pointer over the plan (client px), or null when it never entered it. */
let pointer: { x: number; y: number } | null = null

/**
 * Select the next (or the previous) item of the stack at `at`. This is the whole rule of the
 * feature, without a DOM: it gives false when it changed nothing, so the caller can let the browser
 * keep the Tab key.
 */
export function tabStep(back: boolean, at: Vec | null, view: TabCycleView): boolean {
  if (!at) return false
  const ui = useUi.getState()
  if (ui.mode !== 'edit' || ui.tool !== 'select') return false
  const stack = pickStack(useDoc.getState().doc, at, view.px(PICK_PX))
  const next = nextInStack(stack, ui.selection, back)
  if (!next) return false
  ui.select(next)
  return true
}

let installed = false

/**
 * Install the pointer + Tab listeners once (idempotent). Returns the uninstall function; a second
 * call gives a function that does nothing, so the first installation stays in place.
 */
export function installTabCycle(view?: () => TabCycleView | null): () => void {
  if (installed || typeof window === 'undefined') return () => {}
  installed = true
  const viewOf = view ?? domView

  const move = (e: PointerEvent) => {
    // Only a pointer over the plan counts ("while the pointer is over the plan").
    const svg = canvasSvg()
    // A pointer that leaves the plan (sidebar, header) forgets its place, so Tab on a panel button
    // keeps its normal job: move the keyboard focus.
    if (svg && typeof Node !== 'undefined' && e.target instanceof Node && !svg.contains(e.target)) { pointer = null; return }
    pointer = { x: e.clientX, y: e.clientY }
  }
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (isTyping(e.target)) return
    const v = viewOf()
    if (!v) return
    const at = pointer ? v.toWorld(pointer.x, pointer.y) : null
    if (!tabStep(e.shiftKey, at, v)) return
    // The selection changed: the focus stays where it is.
    e.preventDefault()
  }
  const forget = () => { pointer = null }

  window.addEventListener('pointermove', move)
  window.addEventListener('keydown', key)
  window.addEventListener('blur', forget)
  return () => {
    installed = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('keydown', key)
    window.removeEventListener('blur', forget)
    pointer = null
  }
}

/**
 * Same as the installation above, from a React effect. A component may call it instead of relying on
 * the import (`src/features/rooms/tools.tsx`, SelectTool, is the natural place).
 */
export function useTabCycle(): void {
  useEffect(() => installTabCycle(), [])
}

// Install at import: interaction.ts imports this module, and the select tool imports interaction.ts,
// so the key listener exists as soon as the app loads.
installTabCycle()
