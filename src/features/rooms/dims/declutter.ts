// One declutter pass for the room wall dimension TEXTS (visual review V-1, V-2, V-3, V-6, V-7).
//
// The plan used to write a value that does not fit between its ticks PAST the end of its
// dimension line. On a phone at Fit zoom, and in a small room, that put values on other walls, on
// other rooms and on the room tag ("33525", "39801220"). The rule now is:
//
// 1. A value that does not fit between the ticks of its line is not drawn at all: the line and its
//    ticks stay, and only when the line is at least px(24) on screen (RoomsOverlay asks dimLine
//    for that minimum, and draws nothing under it). A wall being dragged keeps the old behaviour.
// 2. Text boxes against text boxes: measured values first, then the longer walls; a text whose box
//    hits a kept text box, a room tag box or an outside row text box is dropped.
// 3. Text boxes against the wall bands: a text whose box centre is not inside the inner ring of
//    its room, or whose box crosses that ring by more than px(2), is dropped.
// 4. Small rooms: no wall dimensions at all in a room whose inner box is under px(60) in BOTH
//    directions (the tag keeps its code and its name, as the small-room rule of the tag does).
//
// Pure: no store, no React. Units are cm, y points down. Every screen size comes as px and is
// divided by the zoom here, so the callers only give the zoom.

import { pointInPolygon, projectOnSegment } from '../../../model/geometry'
import type { Vec } from '../../../model/types'
import type { Box } from './dimBoxes'
import { boxHit } from './dimBoxes'
import { worldPx } from './dimLine'

/** Sizes of the declutter pass, in screen px. */
export const DECLUTTER = {
  /** A room wall dimension line shorter than this draws nothing, and so does its text (V-1). */
  minLinePx: 24,
  /** A room whose inside box is under this in BOTH directions shows no wall dimensions (V-2). */
  smallRoomPx: 60,
  /** How far a text box may cross the inner ring edge of its room, px (V-3, V-6). */
  ringSlackPx: 2,
}

/** One room wall dimension text, before the pass. */
export type DimTextCandidate = {
  /** Key of the value, e.g. 'd' + room id + wall start id. */
  key: string
  /** Box of the text, cm (the axis aligned box of the turned text, as dimBoxes gives it). */
  box: Box
  /** Corners of the turned text box, cm: they say how deep the text crosses a wall band. */
  quad: Vec[]
  /** A value measured on site: it keeps its text before a calculated one. */
  measured: boolean
  /** Length of the wall on the plan, cm: a longer wall keeps its text first. */
  wallCm: number
  /** Inner ring of the room of the text: the box must stay inside it. */
  ring: Vec[]
  /** A wall being dragged: its text is always shown (7.2 #22). */
  forced?: boolean
}

/**
 * True when a room is too small on screen for wall dimensions (V-2): its inner box is under
 * px(60) in BOTH directions. `innerBox` is the box of the inner ring, cm.
 */
export function smallRoomDims(innerBox: Box, zoom: number): boolean {
  const w = (innerBox.x1 - innerBox.x0) * zoom
  const h = (innerBox.y1 - innerBox.y0) * zoom
  return w < DECLUTTER.smallRoomPx && h < DECLUTTER.smallRoomPx
}

/** The corners of a quad and the middle of each of its edges: the points of the ring test. */
function ringSample(points: Vec[]): Vec[] {
  const out: Vec[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    out.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  }
  return out
}

/** Distance (cm) from p to the nearest edge of the ring. */
function edgeDistance(p: Vec, ring: Vec[]): number {
  let d = Infinity
  for (let i = 0; i < ring.length; i++) {
    d = Math.min(d, projectOnSegment(p, ring[i], ring[(i + 1) % ring.length]).distance)
  }
  return d
}

/**
 * How deep (cm) the points of a text cross the edge of the ring: 0 when all of them are inside,
 * the distance to the nearest ring edge of the deepest point that is outside.
 */
export function ringCrossDepth(points: Vec[], ring: Vec[]): number {
  if (ring.length < 3 || !points.length) return 0
  let depth = 0
  for (const p of points) {
    if (pointInPolygon(p, ring)) continue
    depth = Math.max(depth, edgeDistance(p, ring))
  }
  return depth
}

/**
 * True when a text box sits in its room (V-3, V-6): its centre inside the inner ring, and its box
 * crossing the edge of that ring by no more than px(2). `quad` is the turned box of the text, so a
 * value written along a slanted wall is not lost because of the corners of its axis aligned box.
 */
export function textInRoom(box: Box, quad: Vec[], ring: Vec[], zoom: number): boolean {
  if (ring.length < 3) return false
  const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }
  if (!pointInPolygon(centre, ring)) return false
  return ringCrossDepth(ringSample(quad), ring) <= worldPx(DECLUTTER.ringSlackPx, zoom) + 1e-9
}

export type DimTextKeepInput = {
  /** Every room wall dimension text of the plan, of every room. */
  candidates: DimTextCandidate[]
  /** Boxes that no text may touch: the room tags, and the texts of the outside rows. */
  blockers: Box[]
  /** Screen px per cm. */
  zoom: number
}

export type DimTextKeepResult = {
  /** Keys of the texts that are drawn. */
  kept: Set<string>
  /** Boxes of those texts, cm: the wall number badges keep off them. */
  boxes: Box[]
}

/**
 * The texts to draw (rule 2): a wall being dragged first, then the measured values, then the
 * longer walls; a text whose box touches a kept text, a room tag or an outside row text is
 * dropped, and so is a text that fails the wall band test (rule 3).
 */
export function keepDimTexts({ candidates, blockers, zoom }: DimTextKeepInput): DimTextKeepResult {
  const kept = new Set<string>()
  const boxes: Box[] = []
  const order = [...candidates].sort((a, b) =>
    (Number(!!b.forced) - Number(!!a.forced)) ||
    (Number(b.measured) - Number(a.measured)) ||
    (b.wallCm - a.wallCm) ||
    a.key.localeCompare(b.key))
  for (const c of order) {
    // A wall being dragged keeps its value whatever this pass says (7.2 #22).
    const blocked = !c.forced && (
      !textInRoom(c.box, c.quad, c.ring, zoom) ||
      blockers.some((b) => boxHit(c.box, b)) ||
      boxes.some((b) => boxHit(c.box, b))
    )
    if (blocked) continue
    kept.add(c.key)
    boxes.push(c.box)
  }
  return { kept, boxes }
}
