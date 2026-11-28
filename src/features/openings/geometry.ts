// Pure geometry for doors, windows and openings (no React, no store). Units: cm, degrees, y points down.
// Axis of an opening: d = (cos a, sin a). Normal: n = (-sin a, cos a).
// Hinge 'left' = the start end (centre - d*w/2); 'right' = the end (centre + d*w/2).
// Swing 'in' = towards +n (the inside of a room with clockwise vertices on screen); 'out' = towards -n.
import { add, dist, dot, mul, projectOnSegment, sub } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import type { Opening, OpeningKind, OpeningVariant, Room } from '../../model/types'

export const DEFAULT_OPENING_WIDTH_CM: Record<OpeningKind, number> = { door: 85, window: 120, opening: 100 }
export const MIN_OPENING_WIDTH_CM = 30
export const MAX_OPENING_WIDTH_CM = 400

/** One door leaf: its hinge, its closed tip, its open tip and the quarter-circle swing arc. */
export type DoorLeaf = { hingePt: Vec; closedTipPt: Vec; openTipPt: Vec; radius: number; sweepFlag: 0 | 1 }

export type WallSnap = {
  xCm: number
  yCm: number
  angleDeg: number
  roomId: string
  edgeIndex: number
  /** Position of the centre along the wall: 0 = start vertex, 1 = end vertex. */
  t: number
  wallLengthCm: number
  a: Vec
  b: Vec
}

const RAD = Math.PI / 180
const axis = (angleDeg: number): Vec => ({ x: Math.cos(angleDeg * RAD), y: Math.sin(angleDeg * RAD) })
const normal = (angleDeg: number): Vec => ({ x: -Math.sin(angleDeg * RAD), y: Math.cos(angleDeg * RAD) })
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Nearest wall (all rooms) within thresholdCm of pt. The centre is kept so the opening of widthCm
 * stays inside the wall; a wall shorter than widthCm gets the opening at its middle.
 * Null when no wall is near enough.
 */
export function snapToWall(pt: Vec, rooms: Room[], widthCm: number = DEFAULT_OPENING_WIDTH_CM.door, thresholdCm = 35): WallSnap | null {
  let best: { d: number; roomId: string; edgeIndex: number; a: Vec; b: Vec; t: number; length: number } | null = null
  for (const room of rooms) {
    const v = room.vertices
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length]
      const length = dist(a, b)
      if (length < 1e-6) continue
      const p = projectOnSegment(pt, a, b)
      if (p.distance <= thresholdCm && (!best || p.distance < best.d)) {
        best = { d: p.distance, roomId: room.id, edgeIndex: i, a, b, t: p.t, length }
      }
    }
  }
  if (!best) return null
  const { a, b, length } = best
  const pos = length >= widthCm ? clamp(best.t * length, widthCm / 2, length - widthCm / 2) : length / 2
  const dir = mul(sub(b, a), 1 / length)
  const c = add(a, mul(dir, pos))
  return {
    xCm: c.x,
    yCm: c.y,
    angleDeg: Math.atan2(b.y - a.y, b.x - a.x) / RAD,
    roomId: best.roomId,
    edgeIndex: best.edgeIndex,
    t: pos / length,
    wallLengthCm: length,
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
  }
}

/**
 * Keep an existing opening on its current side of the wall: a wall can be seen from either end, and
 * the two directions differ by 180 degrees, which swaps the hinge end and the swing side (a door
 * would be mirrored). Two rooms drawn side by side share a wall, and the two coincident edges point
 * in opposite directions: without this, dragging a door along that wall can flip it.
 * Perpendicular walls (dot = 0) keep the wall angle as it is. Result is normalized to (-180, 180].
 */
export function keepOpeningOrientation(wallAngleDeg: number, currentAngleDeg: number): number {
  // A tiny negative dot is floating-point noise on a perpendicular wall: treat it as perpendicular.
  const deg = dot(axis(wallAngleDeg), axis(currentAngleDeg)) < -1e-9 ? wallAngleDeg + 180 : wallAngleDeg
  const wrapped = ((deg % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

/** Hinge side (along the wall) and swing side (across the wall) from the cursor position relative to the centre. */
export function computeDoorFlip(center: Vec, angleDeg: number, cursorPt: Vec): { hinge: 'left' | 'right'; swing: 'in' | 'out' } {
  const rel = sub(cursorPt, center)
  return {
    hinge: dot(rel, axis(angleDeg)) < 0 ? 'left' : 'right',
    swing: dot(rel, normal(angleDeg)) >= 0 ? 'in' : 'out',
  }
}

export function openingEndpoints(op: Pick<Opening, 'xCm' | 'yCm' | 'angleDeg' | 'widthCm'>): { start: Vec; end: Vec } {
  const h = mul(axis(op.angleDeg), op.widthCm / 2)
  const c = { x: op.xCm, y: op.yCm }
  return { start: sub(c, h), end: add(c, h) }
}

/** Drag one end to the cursor (projected on the opening axis). The other end stays fixed; width is clamped. */
export function resizeOpeningFromEnd(op: Opening, end: 'start' | 'end', cursorPt: Vec): { xCm: number; yCm: number; widthCm: number } {
  const d = axis(op.angleDeg)
  const s = dot(sub(cursorPt, { x: op.xCm, y: op.yCm }), d) // cursor position along the axis, 0 = centre
  const ends = openingEndpoints(op)
  if (end === 'end') {
    const widthCm = clamp(s + op.widthCm / 2, MIN_OPENING_WIDTH_CM, MAX_OPENING_WIDTH_CM)
    const c = add(ends.start, mul(d, widthCm / 2))
    return { xCm: c.x, yCm: c.y, widthCm }
  }
  const widthCm = clamp(op.widthCm / 2 - s, MIN_OPENING_WIDTH_CM, MAX_OPENING_WIDTH_CM)
  const c = sub(ends.end, mul(d, widthCm / 2))
  return { xCm: c.x, yCm: c.y, widthCm }
}

/**
 * Door leaf and swing arc. The leaf is fixed at the hinge; closedTipPt is the other end of the opening,
 * openTipPt is the leaf tip when open at 90 degrees (on the swing side). The arc has radius = width,
 * centre = hingePt and goes from closedTipPt to openTipPt: SVG `A r r 0 0 sweepFlag x y`.
 * Defaults when missing: hinge 'left', swing 'in'.
 */
export function doorArcGeometry(op: Opening): DoorLeaf {
  const { start, end } = openingEndpoints(op)
  const left = (op.hinge ?? 'left') === 'left'
  const hingePt = left ? start : end
  const closedTipPt = left ? end : start
  const sign = (op.swing ?? 'in') === 'in' ? 1 : -1
  const openTipPt = add(hingePt, mul(normal(op.angleDeg), sign * op.widthCm))
  const u = sub(closedTipPt, hingePt), w = sub(openTipPt, hingePt)
  const crossUW = u.x * w.y - u.y * w.x
  return { hingePt, closedTipPt, openTipPt, radius: op.widthCm, sweepFlag: crossUW > 0 ? 1 : 0 }
}

/**
 * French (double) door: two symmetric leaves of half the width, hinged at the two ends and both
 * swinging to the same side. Each arc runs from the middle of the opening to its own open tip, so
 * the two arcs meet at the centre. The hinge field is ignored (the pair is symmetric) and only the
 * swing side is used.
 */
export function frenchDoorGeometry(op: Opening): [DoorLeaf, DoorLeaf] {
  const { start, end } = openingEndpoints(op)
  const halfWidth = op.widthCm / 2
  const half = { ...op, widthCm: halfWidth }
  // Left leaf: hinge at the start end, its closed tip is the middle of the opening.
  const leftOp: Opening = { ...half, xCm: (start.x + op.xCm) / 2, yCm: (start.y + op.yCm) / 2, hinge: 'left' }
  // Right leaf: hinge at the end, its closed tip is the middle too.
  const rightOp: Opening = { ...half, xCm: (op.xCm + end.x) / 2, yCm: (op.yCm + end.y) / 2, hinge: 'right' }
  return [doorArcGeometry(leftOp), doorArcGeometry(rightOp)]
}

/** Style of an opening: a missing variant is the 'standard' one (old documents). */
export function openingVariant(op: Pick<Opening, 'variant'>): OpeningVariant {
  return op.variant ?? 'standard'
}

/** One 1px stroke of an opening symbol, in artboard-local cm. */
export type OpeningSymbolPath = {
  /** Polyline points; the last point joins the first when `closed`. */
  pts: Vec[]
  closed?: boolean
  /** Stroke width as a multiple of 1px on the screen: 1 = thin symbol line, 1.2 = door leaf. */
  weight?: number
  opacity?: number
  dashed?: boolean
}

/** Quarter-circle door swing arc: `M from A radius radius 0 0 sweepFlag to`. */
export type OpeningSymbolArc = {
  center: Vec
  radius: number
  from: Vec
  to: Vec
  sweepFlag: 0 | 1
}

/** 1px symbol of one opening, in artboard-local cm. Shared by the canvas and the SVG export. */
export type OpeningSymbol = {
  /** Draw the 1px line of the gap through the wall (pocket, bypass and sliding styles). */
  wallLine: boolean
  paths: OpeningSymbolPath[]
  arcs: OpeningSymbolArc[]
}

/** Stroke width of a door leaf, in px. */
export const LEAF_WEIGHT = 1.2
/** Stroke width of a window frame centre line, in px. */
export const FRAME_WEIGHT = 1.5

/**
 * 1px symbol of one opening, in artboard-local cm, so the canvas and the SVG export draw exactly
 * the same picture. `u` converts px to cm (the canvas passes its viewport scale, the export its
 * sheet scale), so the small offsets (panels, panes) keep the same look at any size.
 * A missing variant is 'standard'; the 'opening' kind stays a plain gap (ticks only).
 */
export function openingSymbol(op: Opening, u: (px: number) => number): OpeningSymbol {
  const w = op.widthCm
  const half = w / 2
  const rad = op.angleDeg * RAD
  const c: Vec = { x: op.xCm, y: op.yCm }
  const d: Vec = { x: Math.cos(rad), y: Math.sin(rad) }
  const n: Vec = { x: -Math.sin(rad), y: Math.cos(rad) }
  /** Point at `t` along the wall (0 = centre) and `s` across it (+n = the inside). */
  const at = (t: number, s: number): Vec => ({ x: c.x + d.x * t + n.x * s, y: c.y + d.y * t + n.y * s })
  const seg = (t0: number, s0: number, t1: number, s1: number, extra: Partial<OpeningSymbolPath> = {}): OpeningSymbolPath =>
    ({ pts: [at(t0, s0), at(t1, s1)], ...extra })
  const box = (t0: number, t1: number, s0: number, s1: number, extra: Partial<OpeningSymbolPath> = {}): OpeningSymbolPath =>
    ({ pts: [at(t0, s0), at(t1, s0), at(t1, s1), at(t0, s1)], closed: true, ...extra })
  const arcOf = (g: DoorLeaf): OpeningSymbolArc =>
    ({ center: g.hingePt, radius: g.radius, from: g.closedTipPt, to: g.openTipPt, sweepFlag: g.sweepFlag })
  const variant = openingVariant(op)

  if (op.kind === 'door') {
    if (variant === 'french' || variant === 'french-glass') {
      const leaves = frenchDoorGeometry(op)
      return {
        wallLine: false,
        paths: leaves.map((g) => ({ pts: [g.hingePt, g.openTipPt], weight: LEAF_WEIGHT })),
        arcs: leaves.map(arcOf),
      }
    }
    if (variant === 'pocket') {
      // One leaf partially slid into a dashed receiver box that sits along the wall on the hinge side.
      const side = (op.hinge ?? 'left') === 'left' ? -1 : 1
      const thickness = u(3)
      const offset = u(2.5)
      const panelLen = w * 0.55
      const pocketLen = w * 0.3
      const edge = side * half
      const inner = side * (half - panelLen)
      const outer = side * (half + pocketLen)
      const mid = offset + thickness / 2
      return {
        wallLine: true,
        paths: [
          box(edge, inner, offset, offset + thickness),
          box(edge, outer, offset - thickness * 0.2, offset + thickness * 1.2, { dashed: true, opacity: 0.75 }),
          seg(side * (half + pocketLen * 0.12), mid, side * (half + pocketLen * 0.72), mid, { opacity: 0.85 }),
        ],
        arcs: [],
      }
    }
    if (variant === 'bypass' || variant === 'bypass-glass') {
      // Two parallel panels that overlap in the middle, each on its own track across the wall line.
      const thickness = u(3)
      const offset = u(1.5)
      const panelLen = w * 0.55
      return {
        wallLine: true,
        paths: [
          box(-half, -half + panelLen, offset, offset + thickness),
          box(half - panelLen, half, -offset - thickness, -offset),
        ],
        arcs: [],
      }
    }
    const g = doorArcGeometry(op)
    return { wallLine: false, paths: [{ pts: [g.hingePt, g.openTipPt], weight: LEAF_WEIGHT }], arcs: [arcOf(g)] }
  }

  if (op.kind === 'window') {
    if (variant === 'sliding') {
      // Two staggered glass sashes that overlap a little in the middle, on either side of the wall line.
      const thickness = u(3)
      const offset = u(2)
      const paneLen = w * 0.62
      return {
        wallLine: true,
        paths: [
          box(-half, -half + paneLen, offset, offset + thickness),
          box(half - paneLen, half, -offset - thickness, -offset),
        ],
        arcs: [],
      }
    }
    // Standard frame: centre line plus one thinner line on each side.
    const o = u(2.5)
    const frame: OpeningSymbolPath[] = [
      { pts: [at(-half, 0), at(half, 0)], weight: FRAME_WEIGHT },
      { pts: [at(-half, o), at(half, o)], weight: 1, opacity: 0.6 },
      { pts: [at(-half, -o), at(half, -o)], weight: 1, opacity: 0.6 },
    ]
    // Casement windows keep the frame and add the swinging sash leaves with their quarter-circle
    // arcs, exactly like a door leaf: one leaf hinged on one side, or two half-width leaves that
    // meet in the middle. Defaults when missing: hinge 'left', swing 'in'.
    if (variant === 'casement' || variant === 'double-casement') {
      const leaves = variant === 'casement' ? [doorArcGeometry(op)] : frenchDoorGeometry(op)
      return {
        wallLine: false,
        paths: [...frame, ...leaves.map((g): OpeningSymbolPath => ({ pts: [g.hingePt, g.openTipPt], weight: LEAF_WEIGHT }))],
        arcs: leaves.map(arcOf),
      }
    }
    return { wallLine: false, paths: frame, arcs: [] }
  }

  // 'opening': the plain wall gap, made visible by the end ticks the renderers add.
  return { wallLine: false, paths: [], arcs: [] }
}

/** New opening at a wall snap. Doors get hinge/swing (default 'left'/'in'); other kinds get none. */
export function createOpening(kind: OpeningKind, snap: WallSnap, hinge: 'left' | 'right' = 'left', swing: 'in' | 'out' = 'in'): Opening {
  const widthCm = Math.min(DEFAULT_OPENING_WIDTH_CM[kind], Math.max(MIN_OPENING_WIDTH_CM, snap.wallLengthCm))
  // `roomId` records which wall hosts the opening: a flush wall of a neighbouring room is at the same
  // distance and must not take the opening over later.
  const op: Opening = { id: newId(), kind, roomId: snap.roomId, xCm: snap.xCm, yCm: snap.yCm, angleDeg: snap.angleDeg, widthCm }
  if (kind === 'door') { op.hinge = hinge; op.swing = swing }
  return op
}
