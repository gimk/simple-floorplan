// Zoom and fit actions shared by the zoom pill, the keyboard shortcuts and the menus.
// Kept out of ZoomControls.tsx so that file only exports components (fast refresh).
//
// Every action reads the 2D canvas element. In Views mode (or while the shell is hidden) that
// element is not mounted: the actions then do nothing instead of moving a view nobody sees.
import { docBounds, useDoc } from '../model/store'
import { useUi } from './uiStore'
import { clampZoom, fitView } from './viewMath'

/** The 2D SVG canvas, or null when it is not mounted (Views mode, hidden UI, tests). */
function canvasEl(): SVGSVGElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<SVGSVGElement>('svg[data-testid="floorplan-canvas"]')
}

/** Zoom to `targetZoom` centered on the canvas, keeping the world point at the center fixed. */
function zoomTo(targetZoom: number): void {
  const svg = canvasEl()
  if (!svg) return
  const r = svg.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const v = useUi.getState().view
  const z = clampZoom(targetZoom)
  const wx = v.x + (cx - r.left) / v.zoom
  const wy = v.y + (cy - r.top) / v.zoom
  useUi.getState().set({ view: { zoom: z, x: wx - (cx - r.left) / z, y: wy - (cy - r.top) / z } })
}

/** Fit the view to all artboards, rooms and reference images. */
export function fitAll(): void {
  const r = canvasEl()?.getBoundingClientRect()
  if (!r) return
  useUi.getState().set({ view: fitView(docBounds(useDoc.getState().doc), r.width, r.height) })
}

/** Fit the view to one world box (cm): the "zoom to fit the selection" shortcut (Shift+2). */
export function fitBounds(b: { minX: number; minY: number; maxX: number; maxY: number }): void {
  const r = canvasEl()?.getBoundingClientRect()
  if (!r) return
  useUi.getState().set({ view: fitView(b, r.width, r.height) })
}

const zoomBy = (factor: number) => zoomTo(useUi.getState().view.zoom * factor)

/** Zoom step of the buttons and of the + / - keys. */
export const ZOOM_STEP = 1.25
export const zoomIn = () => zoomBy(ZOOM_STEP)
export const zoomOut = () => zoomBy(1 / ZOOM_STEP)
export const zoomReset = () => zoomTo(1)

/**
 * World point (cm) at the centre of the visible 2D canvas, or null when the canvas is not mounted
 * (nothing to centre on then).
 */
export function canvasCenterWorld(): { x: number; y: number } | null {
  const svg = canvasEl()
  if (!svg) return null
  const v = useUi.getState().view
  const w = svg.clientWidth || 800
  const h = svg.clientHeight || 600
  return { x: v.x + w / 2 / v.zoom, y: v.y + h / 2 / v.zoom }
}
