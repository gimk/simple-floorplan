// Pure group transform math for furniture multi-selection (no React, no store). Units: cm, degrees, y points down.
import type { Vec } from '../../model/geometry'
import type { FurnitureItem } from '../../model/types'
import {
  MAX_FURNITURE_CM,
  MIN_FURNITURE_CM,
  furnitureAxisBounds,
  normalizeAngle,
  roundSize,
} from './geometry'
import type { ItemBounds, ResizeHandle } from './geometry'

const RAD = Math.PI / 180

/** Start state of one item for group resize or group rotate, in artboard-local cm and degrees. */
export type FurnitureTransformStart = {
  xCm: number
  yCm: number
  widthCm: number
  depthCm: number
  rotationDeg: number
}

export type GroupResizeItemResult = {
  xCm: number
  yCm: number
  widthCm: number
  depthCm: number
}

export type GroupRotateItemResult = {
  xCm: number
  yCm: number
  rotationDeg: number
}

const clampSize = (v: number): number => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))

/** Axis-aligned bounding box around all given items, using each item's rotated footprint. */
export function groupBounds(
  items: readonly Pick<FurnitureItem, 'xCm' | 'yCm' | 'widthCm' | 'depthCm' | 'rotationDeg' | 'shape'>[],
): ItemBounds | null {
  if (items.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of items) {
    const b = furnitureAxisBounds(item)
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Scale a group of furniture items from the opposite side/corner (anchor) of `startBounds` when
 * `handle` is dragged to `p` (artboard-local cm). Pure: computes every frame from `starts`.
 *
 * Edge handles scale one axis; corner handles scale both axes; `opts.shift` keeps the box ratio
 * (corners: bigger factor wins; edges: dragged axis gives the factor). Each item's rotation stays
 * unchanged, and its local width/depth scale according to its rotation angle.
 */
export function resizeGroupFromHandle(
  starts: ReadonlyMap<string, FurnitureTransformStart>,
  startBounds: ItemBounds,
  handle: ResizeHandle,
  p: Vec,
  opts: { shift: boolean; precisionCm?: number },
): Map<string, GroupResizeItemResult> {
  const out = new Map<string, GroupResizeItemResult>()
  if (starts.size === 0) return out

  const w0 = startBounds.maxX - startBounds.minX
  const h0 = startBounds.maxY - startBounds.minY
  if ((handle.sx === 0 && handle.sy === 0) || !(w0 > 0) || !(h0 > 0)) {
    for (const [id, s] of starts) {
      out.set(id, { xCm: s.xCm, yCm: s.yCm, widthCm: s.widthCm, depthCm: s.depthCm })
    }
    return out
  }

  const anchor: Vec = {
    x: handle.sx === -1 ? startBounds.maxX : handle.sx === 1 ? startBounds.minX : (startBounds.minX + startBounds.maxX) / 2,
    y: handle.sy === -1 ? startBounds.maxY : handle.sy === 1 ? startBounds.minY : (startBounds.minY + startBounds.maxY) / 2,
  }

  const rawW = handle.sx === 0 ? w0 : (p.x - anchor.x) * handle.sx
  const rawH = handle.sy === 0 ? h0 : (p.y - anchor.y) * handle.sy

  let sx: number
  let sy: number
  if (opts.shift) {
    const s =
      handle.sx !== 0 && handle.sy !== 0
        ? Math.max(rawW / w0, rawH / h0)
        : handle.sx !== 0
          ? rawW / w0
          : rawH / h0
    const lo = Math.max(MIN_FURNITURE_CM / w0, MIN_FURNITURE_CM / h0)
    const k = Math.max(lo, s)
    sx = k
    sy = k
  } else {
    sx = handle.sx === 0 ? 1 : Math.max(MIN_FURNITURE_CM, rawW) / w0
    sy = handle.sy === 0 ? 1 : Math.max(MIN_FURNITURE_CM, rawH) / h0
  }

  const precision = opts.precisionCm ?? 0
  for (const [id, s] of starts) {
    const rad = s.rotationDeg * RAD
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const widthScale = Math.hypot(sx * cos, sy * sin)
    const depthScale = Math.hypot(sx * sin, sy * cos)
    out.set(id, {
      xCm: anchor.x + (s.xCm - anchor.x) * sx,
      yCm: anchor.y + (s.yCm - anchor.y) * sy,
      widthCm: clampSize(roundSize(s.widthCm * widthScale, precision)),
      depthCm: clampSize(roundSize(s.depthCm * depthScale, precision)),
    })
  }
  return out
}

/**
 * Rotate a group of furniture items by `deltaDeg` around `center` (artboard-local cm), computing
 * every item from its start state.
 */
export function rotateGroupByDelta(
  starts: ReadonlyMap<string, FurnitureTransformStart>,
  center: Vec,
  deltaDeg: number,
): Map<string, GroupRotateItemResult> {
  const out = new Map<string, GroupRotateItemResult>()
  if (starts.size === 0) return out

  const rad = deltaDeg * RAD
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  for (const [id, s] of starts) {
    const dx = s.xCm - center.x
    const dy = s.yCm - center.y
    out.set(id, {
      xCm: center.x + dx * cos - dy * sin,
      yCm: center.y + dx * sin + dy * cos,
      rotationDeg: normalizeAngle(s.rotationDeg + deltaDeg),
    })
  }
  return out
}
