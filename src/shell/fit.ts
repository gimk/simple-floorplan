// Fit the viewport to all rooms + background. DOM-dependent, so kept out of viewMath.
//
// The margins are NOT the same on the four sides (visual review V-5): the canvas carries the hint
// bar and the zoom pill over its bottom edge, so a plan fitted with the same margin everywhere had
// its bottom facade dimensions under the bar right after `0` (Fit). The bottom margin is therefore
// larger, and the plan is centred in the box that is left. The rule is pure and tested here, the
// DOM part is `canvasSize` + `fitToDoc`.
import { useDoc, useUi } from '../model/store'
import { clampZoom, docBounds, type Bounds, type View } from './viewMath'

/** Margin around the plan, screen px (top, right and left). */
export const FIT_PAD = 16
/** Margin under the plan, screen px: the floating tool bar and the one-line hint bar sit there (V-5). */
export const FIT_BOTTOM_PAD = 112

/** Screen margins of a fitted plan, px. */
export type Insets = { top: number; right: number; bottom: number; left: number }

/** The margins `fitToDoc` uses: 16 px on three sides, 56 px under the plan. */
export const FIT_INSETS: Insets = { top: FIT_PAD, right: FIT_PAD, bottom: FIT_BOTTOM_PAD, left: FIT_PAD }

/**
 * View (world point at the screen origin + zoom) that puts the bounds in the FREE box of a viewport
 * of wPx × hPx, that is the viewport minus the margins (cm = world, y points down).
 * The largest zoom that fits both directions wins, and the plan is centred in that free box, so the
 * margins are the minimums of `insets`: a side with room to spare gets more.
 */
export function fitInsetView(b: Bounds, wPx: number, hPx: number, insets: Insets = FIT_INSETS): View {
  const bw = Math.max(b.maxX - b.minX, 1)
  const bh = Math.max(b.maxY - b.minY, 1)
  // Never negative with a tiny canvas: 1 px of free box keeps the zoom finite.
  const freeW = Math.max(wPx - insets.left - insets.right, 1)
  const freeH = Math.max(hPx - insets.top - insets.bottom, 1)
  const zoom = clampZoom(Math.min(freeW / bw, freeH / bh))
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  // The centre of the plan goes to the centre of the free box.
  return { zoom, x: cx - (insets.left + freeW / 2) / zoom, y: cy - (insets.top + freeH / 2) / zoom }
}

/** Current size of the floorplan canvas in screen px (falls back to the window). */
export function canvasSize(): { w: number; h: number } {
  const svg = document.querySelector('svg[data-testid="floorplan-canvas"]')
  const r = svg?.getBoundingClientRect()
  return { w: r?.width || window.innerWidth, h: r?.height || window.innerHeight }
}

/** Set the view so all rooms + the background fit on screen, above the bottom bar. */
export function fitToDoc(): void {
  const { w, h } = canvasSize()
  useUi.getState().set({ view: fitInsetView(docBounds(useDoc.getState().doc), w, h) })
}
