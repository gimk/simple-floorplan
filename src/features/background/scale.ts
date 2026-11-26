// Pure helpers for resizing a reference image from a corner handle and for 2-point calibration input.
import { dist, type Vec } from '../../model/geometry'
import { worldOfPixel, type BgGeom } from './calibrate'

/** Corner index 0..3 = TL, TR, BR, BL. Pixel position of a corner. */
export const cornerPx = (bg: BgGeom, i: number): Vec => ({
  x: i === 1 || i === 2 ? bg.naturalWidth : 0,
  y: i >= 2 ? bg.naturalHeight : 0,
})

/**
 * Proportional resize by dragging corner `i` to world point `p`. The opposite corner stays
 * fixed in world space and rotation is kept. Returns the new cmPerPx / xCm / yCm.
 */
export const resizeFromCorner = (bg: BgGeom, i: number, p: Vec, minCmPerPx = 1e-4) => {
  const opp = cornerPx(bg, (i + 2) % 4)
  const oppW = worldOfPixel(bg, opp)
  const diagPx = Math.hypot(bg.naturalWidth, bg.naturalHeight)
  const cmPerPx = Math.max(minCmPerPx, dist(oppW, p) / (diagPx || 1))
  // Vector opposite corner -> center in the unrotated frame, then rotated into world.
  const vx = (bg.naturalWidth / 2 - opp.x) * cmPerPx
  const vy = (bg.naturalHeight / 2 - opp.y) * cmPerPx
  const rad = (bg.rotationDeg * Math.PI) / 180
  const c = { x: oppW.x + vx * Math.cos(rad) - vy * Math.sin(rad), y: oppW.y + vx * Math.sin(rad) + vy * Math.cos(rad) }
  return { cmPerPx, xCm: c.x - (bg.naturalWidth * cmPerPx) / 2, yCm: c.y - (bg.naturalHeight * cmPerPx) / 2 }
}

/** Scale factor for 2-point calibration: realCm / measured world distance. null when invalid. */
export const computeCmPerPx = (bg: BgGeom, a: Vec, b: Vec, realCm: number): number | null => {
  const d = dist(a, b)
  if (!(d > 0) || !(realCm > 0)) return null
  return bg.cmPerPx * (realCm / d)
}
