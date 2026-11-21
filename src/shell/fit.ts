// Fit the viewport to all rooms + background. DOM-dependent, so kept out of viewMath.
import { useDoc, useUi } from '../model/store'
import { docBounds, fitView } from './viewMath'

/** Current size of the floorplan canvas in screen px (falls back to the window). */
export function canvasSize(): { w: number; h: number } {
  const svg = document.querySelector('svg[data-testid="floorplan-canvas"]')
  const r = svg?.getBoundingClientRect()
  return { w: r?.width || window.innerWidth, h: r?.height || window.innerHeight }
}

/** Set the view so all rooms + the background fit on screen. */
export function fitToDoc(): void {
  const { w, h } = canvasSize()
  useUi.getState().set({ view: fitView(docBounds(useDoc.getState().doc), w, h) })
}
