// Pure viewport math for the app shell. World units = cm, zoom = screen px per cm.
// Kept free of React/DOM so it can be unit-tested.
import type { BackgroundImage, PlanDoc, Vec } from '../model/types'

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 40

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 }

/** Bounds of all rooms plus the background image (when visible). */
export function docBounds(doc: PlanDoc): Bounds {
  const pts: Vec[] = doc.rooms.flatMap((r) => r.vertices)
  const bg: BackgroundImage | undefined = doc.background
  if (bg && bg.visible) {
    const w = bg.naturalWidth * bg.cmPerPx
    const h = bg.naturalHeight * bg.cmPerPx
    pts.push({ x: bg.xCm, y: bg.yCm }, { x: bg.xCm + w, y: bg.yCm + h })
  }
  if (!pts.length) return { ...EMPTY_BOUNDS }
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
}

export type View = { x: number; y: number; zoom: number }

/**
 * View (world point at screen origin + zoom) that centers `b` in a viewport of
 * wPx × hPx screen pixels with padPx of margin on every side.
 */
export function fitView(b: Bounds, wPx: number, hPx: number, padPx = 48): View {
  const bw = Math.max(b.maxX - b.minX, 1)
  const bh = Math.max(b.maxY - b.minY, 1)
  const zoom = clampZoom(Math.min((wPx - 2 * padPx) / bw, (hPx - 2 * padPx) / bh))
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  return { zoom, x: cx - wPx / (2 * zoom), y: cy - hPx / (2 * zoom) }
}

/** "Nice" metric steps (cm) for the scale bar and the canvas grid. */
export const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]

/**
 * Pick a scale-bar length in cm whose on-screen width (step * zoom px) is closest
 * to targetPx, staying inside [minPx, maxPx] when possible.
 */
export function scaleBarStep(zoom: number, targetPx = 110, minPx = 60, maxPx = 170): number {
  const candidates = NICE_STEPS.map((s) => ({ s, px: s * zoom }))
  const inRange = candidates.filter((c) => c.px >= minPx && c.px <= maxPx)
  const pool = inRange.length ? inRange : candidates
  let best = pool[0]
  for (const c of pool) if (Math.abs(c.px - targetPx) < Math.abs(best.px - targetPx)) best = c
  return best.s
}

/** Pick a grid spacing in cm so lines land roughly every targetPx screen pixels. */
export function gridStep(zoom: number, targetPx = 32, minPx = 18, maxPx = 90): number {
  const candidates = NICE_STEPS.map((s) => ({ s, px: s * zoom }))
  const inRange = candidates.filter((c) => c.px >= minPx && c.px <= maxPx)
  const pool = inRange.length ? inRange : candidates
  let best = pool[0]
  for (const c of pool) if (Math.abs(c.px - targetPx) < Math.abs(best.px - targetPx)) best = c
  return best.s
}

/** Format a scale-bar length: "50 cm", "2,5 m". */
export function fmtScale(cm: number): string {
  if (cm >= 100) {
    const m = Math.round(cm * 10) / 1000
    return `${String(m).replace('.', ',')} m`
  }
  return `${cm} cm`
}
