// Pure helpers for wall-attached elements. Units: cm.
import type { ElementKind, ElementVariant, Room, Vec, WallElement } from '../../model/types'
import { projectOnSegment, roomWalls, type Wall } from '../../model/geometry'

export const VARIANTS: Record<ElementKind, ElementVariant[]> = {
  door: ['single', 'double', 'sliding', 'pocket'],
  window: ['standard', 'french', 'fixed'],
  opening: [],
  cupboard: ['wall-cabinet', 'recessed', 'wardrobe'],
  radiator: [],
  other: [],
}

export const KIND_LABEL: Record<ElementKind, string> = {
  door: 'Door', window: 'Window', opening: 'Opening', cupboard: 'Cupboard', radiator: 'Radiator', other: 'Other',
}

export const VARIANT_LABEL: Record<ElementVariant, string> = {
  single: 'Single swing',
  double: 'Double swing',
  sliding: 'Sliding',
  pocket: 'Pocket',
  standard: 'Standard',
  french: 'French window',
  fixed: 'Fixed',
  'wall-cabinet': 'Wall cabinet',
  recessed: 'Recessed',
  wardrobe: 'Wardrobe',
}

export const defaultVariant = (kind: ElementKind): ElementVariant | undefined => VARIANTS[kind][0]

/** Wall thickness: explicit value, else by wall type (bearing 25, exterior 30, partition 10). */
export function wallThickness(room: Room, wallStart: string): number {
  const p = room.walls[wallStart]
  if (!p) return 10
  if (typeof p.thicknessCm === 'number' && p.thicknessCm > 0) return p.thicknessCm
  return p.type === 'bearing' ? 25 : p.type === 'exterior' ? 30 : 10
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Clamp the near-edge offset so the element stays inside the wall (0..wallLength-width). */
export const clampOffset = (offset: number, widthCm: number, wallLength: number) =>
  clamp(offset, 0, Math.max(0, wallLength - widthCm))

/** Snap to a grid step (step <= 0 = no snap). */
export const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v)

/** Offset for an element of width w centered at distance `along` from the wall start. */
export function placeOffset(along: number, widthCm: number, wallLength: number, step = 0): number {
  return clampOffset(snapTo(along - widthCm / 2, step), widthCm, wallLength)
}

export const offsetFromEnd = (el: Pick<WallElement, 'offsetCm' | 'widthCm'>, wallLength: number) =>
  wallLength - el.offsetCm - el.widthCm

/** Offset (from start) for a requested distance between the element's far edge and the wall end. */
export const offsetFromEndToStart = (fromEnd: number, widthCm: number, wallLength: number) =>
  wallLength - fromEnd - widthCm

/** True when the element does not fit inside its wall. */
export const overflows = (el: Pick<WallElement, 'offsetCm' | 'widthCm'>, wallLength: number) =>
  el.offsetCm < -0.01 || el.offsetCm + el.widthCm > wallLength + 0.01

/** Element frame: start and end points on the wall line, plus wall direction and inward normal. */
export function elementFrame(wall: Wall, el: Pick<WallElement, 'offsetCm' | 'widthCm'>) {
  const a: Vec = { x: wall.start.x + wall.dir.x * el.offsetCm, y: wall.start.y + wall.dir.y * el.offsetCm }
  const b: Vec = { x: a.x + wall.dir.x * el.widthCm, y: a.y + wall.dir.y * el.widthCm }
  return { a, b, dir: wall.dir, inward: wall.inward }
}

export type WallHit = { room: Room; wall: Wall; along: number; distance: number; point: Vec }

/** Nearest wall of any room to p within maxDist (cm), or null. */
export function nearestWall(rooms: Room[], p: Vec, maxDist: number): WallHit | null {
  let best: WallHit | null = null
  for (const room of rooms) {
    for (const wall of roomWalls(room)) {
      const pr = projectOnSegment(p, wall.start, wall.end)
      if (pr.distance <= maxDist && (!best || pr.distance < best.distance)) {
        best = { room, wall, along: pr.t * wall.length, distance: pr.distance, point: pr.point }
      }
    }
  }
  return best
}

export type NewElementSpec = Pick<WallElement, 'kind' | 'variant' | 'widthCm' | 'heightCm' | 'sillCm' | 'depthCm' | 'hinge' | 'swing'>

export function defaultElement(kind: ElementKind, variant?: ElementVariant): NewElementSpec {
  const v = variant && VARIANTS[kind].includes(variant) ? variant : defaultVariant(kind)
  switch (kind) {
    case 'door': return { kind, variant: v, widthCm: v === 'double' ? 140 : 80, heightCm: 204, hinge: 'start', swing: 'in' }
    case 'window': return { kind, variant: v, widthCm: 120, heightCm: 135, sillCm: 90 }
    case 'opening': return { kind, widthCm: 90, heightCm: 204 }
    case 'cupboard': return { kind, variant: v, widthCm: 100, depthCm: 60 }
    case 'radiator': return { kind, widthCm: 80, heightCm: 60, depthCm: 10 }
    default: return { kind: 'other', widthCm: 50 }
  }
}
