// Pure calibration math for the background image. World units: cm, y points down.
import { dist } from '../../model/geometry'
import type { Vec } from '../../model/types'

export type BgGeom = {
  xCm: number
  yCm: number
  naturalWidth: number
  naturalHeight: number
  cmPerPx: number
  rotationDeg: number
}

/** Displayed size of the image in world cm. */
export const imageSizeCm = (bg: BgGeom) => ({
  w: bg.naturalWidth * bg.cmPerPx,
  h: bg.naturalHeight * bg.cmPerPx,
})

/** Center of the image in world cm. Rotation happens around this point. */
export const imageCenter = (bg: BgGeom): Vec => {
  const { w, h } = imageSizeCm(bg)
  return { x: bg.xCm + w / 2, y: bg.yCm + h / 2 }
}

/** World position of an image pixel (p in px from the top-left), honoring rotation. */
export const worldOfPixel = (bg: BgGeom, p: Vec): Vec => {
  const c = imageCenter(bg)
  const u = { x: bg.xCm + p.x * bg.cmPerPx, y: bg.yCm + p.y * bg.cmPerPx }
  const rad = (bg.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = u.x - c.x, dy = u.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** Image pixel (px from top-left) under a world point — inverse of worldOfPixel. */
export const pixelAtWorld = (bg: BgGeom, w: Vec): Vec => {
  const c = imageCenter(bg)
  const rad = (-bg.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = w.x - c.x, dy = w.y - c.y
  const u = { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
  return { x: (u.x - bg.xCm) / bg.cmPerPx, y: (u.y - bg.yCm) / bg.cmPerPx }
}

/**
 * Re-scale the image about world point `a` so the world distance a–b becomes
 * `realCm`. Point `a` stays fixed in world space; rotation is preserved.
 * Returns the new cmPerPx / xCm / yCm.
 */
export const calibrateScale = (bg: BgGeom, a: Vec, b: Vec, realCm: number) => {
  const s = realCm / (dist(a, b) || 1)
  const c = imageCenter(bg)
  const newCmPerPx = bg.cmPerPx * s
  const newCenter = { x: a.x + s * (c.x - a.x), y: a.y + s * (c.y - a.y) }
  return {
    cmPerPx: newCmPerPx,
    xCm: newCenter.x - (bg.naturalWidth * newCmPerPx) / 2,
    yCm: newCenter.y - (bg.naturalHeight * newCmPerPx) / 2,
  }
}
