// Flat top-down plan symbol of a furniture item: the parts of its 3D model
// (src/features/view3d/furnitureSolids.ts) seen from above. Pure: no React, no DOM.
// Item-local cm: x along widthCm, y along depthCm (local -Y is the front, the 3D -z).
// The 'box' model (plain shape) gives no parts: the canvas draws only the item outline.
import { furnitureHeightCm } from '../../model/defaults'
import type { FurnitureItem } from '../../model/types'
import { furnitureArchetype, furnitureParts } from '../view3d/furnitureSolids'
import { furnitureCornerRadiiCm } from './geometry'

export type PlanPart = {
  kind: 'rect' | 'ellipse'
  /** Centre, item-local cm. */
  x: number
  y: number
  /** Footprint along x and y, cm. */
  w: number
  h: number
  /** rect only: [top-left, top-right, bottom-right, bottom-left] radii, cm. */
  radii?: [number, number, number, number]
  /** Turn of the part in the plan, degrees clockwise (SVG rotate). */
  rotationDeg?: number
  color: string
  /** Glass (shower screen): drawn faint. */
  translucent?: boolean
}

/** Parts smaller than this on both axes are dropped (no visible detail). */
const MIN_PART_CM = 1

/**
 * The plan parts of one item, lowest top first (so higher parts cover lower ones).
 * `mirror` false gives the unflipped parts (the caller mirrors the whole group); true applies
 * flipX / flipY of the item to the parts.
 */
export function planSymbolParts(item: FurnitureItem, opts: { mirror?: boolean } = {}): PlanPart[] {
  const H = furnitureHeightCm(item)
  if (furnitureArchetype(item, H) === 'box') return []
  const src = opts.mirror ? item : { ...item, flipX: false, flipY: false }
  const parts = furnitureParts(src, H, furnitureCornerRadiiCm(item))
  return parts
    .map((p) => {
      // A lying cylinder (washing machine door) shows its length (sy) along y from above.
      const lying = !!p.rotationX && Math.abs(Math.sin(p.rotationX)) > 0.5
      const h = lying ? p.sy : p.sz
      const top = p.cy + (lying ? p.sz : p.sy) / 2
      const part: PlanPart = {
        kind: p.kind === 'cylinder' && !lying ? 'ellipse' : 'rect',
        x: p.cx,
        y: p.cz,
        w: p.sx,
        h,
        color: p.color,
      }
      if (p.kind === 'roundedBox' && p.cornerRadiiCm) part.radii = p.cornerRadiiCm
      if (p.translucent) part.translucent = true
      // three.js rotateY(a) turns +x towards -z; in the plan (z down the screen) that is rotate(-a).
      if (p.rotationY) part.rotationDeg = (-p.rotationY * 180) / Math.PI
      return { part, top }
    })
    .filter(({ part }) => part.w >= MIN_PART_CM || part.h >= MIN_PART_CM)
    .sort((a, b) => a.top - b.top)
    .map(({ part }) => part)
}

/** Cache of the unflipped parts, per item object (the store replaces an item when it changes). */
const cache = new WeakMap<FurnitureItem, PlanPart[]>()

/** planSymbolParts(item) with a cache, for the canvas (re-renders on every drag frame). */
export function cachedPlanSymbolParts(item: FurnitureItem): PlanPart[] {
  let parts = cache.get(item)
  if (!parts) {
    parts = planSymbolParts(item)
    cache.set(item, parts)
  }
  return parts
}
