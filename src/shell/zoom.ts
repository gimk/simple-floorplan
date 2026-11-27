// Zoom and fit actions shared by the zoom pill, the keyboard shortcuts and the menus.
// Kept out of ZoomControls.tsx so that file only exports components (fast refresh).
import { docBounds, useDoc } from '../model/store'
import { useUi } from './uiStore'
import { clampZoom, fitView } from './viewMath'

/** Zoom to `targetZoom` centered on the canvas, keeping the world point at the center fixed. */
function zoomTo(targetZoom: number) {
  const svg = document.querySelector('svg[data-testid="floorplan-canvas"]')
  const r = svg?.getBoundingClientRect()
  const cx = (r?.left ?? 0) + (r?.width ?? window.innerWidth) / 2
  const cy = (r?.top ?? 0) + (r?.height ?? window.innerHeight) / 2
  const v = useUi.getState().view
  const z = clampZoom(targetZoom)
  const wx = v.x + (cx - (r?.left ?? 0)) / v.zoom
  const wy = v.y + (cy - (r?.top ?? 0)) / v.zoom
  useUi.getState().set({ view: { zoom: z, x: wx - (cx - (r?.left ?? 0)) / z, y: wy - (cy - (r?.top ?? 0)) / z } })
}

/** Fit the view to all artboards, rooms and reference images. */
export function fitAll() {
  const svg = document.querySelector('svg[data-testid="floorplan-canvas"]')
  const r = svg?.getBoundingClientRect()
  const w = r?.width || window.innerWidth
  const h = r?.height || window.innerHeight
  useUi.getState().set({ view: fitView(docBounds(useDoc.getState().doc), w, h) })
}

/** Fit the view to one world box (cm): the "zoom to fit the selection" shortcut (Shift+2). */
export function fitBounds(b: { minX: number; minY: number; maxX: number; maxY: number }) {
  const svg = document.querySelector('svg[data-testid="floorplan-canvas"]')
  const r = svg?.getBoundingClientRect()
  const w = r?.width || window.innerWidth
  const h = r?.height || window.innerHeight
  useUi.getState().set({ view: fitView(b, w, h) })
}

const zoomBy = (factor: number) => zoomTo(useUi.getState().view.zoom * factor)

/** Zoom step of the buttons and of the + / - keys. */
export const ZOOM_STEP = 1.25
export const zoomIn = () => zoomBy(ZOOM_STEP)
export const zoomOut = () => zoomBy(1 / ZOOM_STEP)
export const zoomReset = () => zoomTo(1)

/** World point (cm) at the centre of the visible canvas. */
export function canvasCenterWorld(): { x: number; y: number } {
  const svg = document.querySelector<SVGSVGElement>('svg[data-testid="floorplan-canvas"]')
  const v = useUi.getState().view
  const w = svg?.clientWidth || window.innerWidth || 800
  const h = svg?.clientHeight || window.innerHeight || 600
  return { x: v.x + w / 2 / v.zoom, y: v.y + h / 2 / v.zoom }
}
