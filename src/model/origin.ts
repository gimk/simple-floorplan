// The plan origin: the top-left corner of the rooms' bounding box is always (0, 0).
// Pure, cm. No store or DOM imports.
import type { PlanDoc, Vec } from './types'

/** Offset that moves the rooms' top-left corner to (0, 0). Zero when there are no rooms. */
export function originOffset(doc: Pick<PlanDoc, 'rooms'>): Vec {
  let x = Infinity, y = Infinity
  for (const r of doc.rooms) for (const v of r.vertices) { if (v.x < x) x = v.x; if (v.y < y) y = v.y }
  return Number.isFinite(x) && Number.isFinite(y) ? { x: -x, y: -y } : { x: 0, y: 0 }
}

/** Unplaced Measuring Mode tapes use a = b = (0, 0); they stay as they are. */
const unplaced = (t: { a: Vec; b: Vec }) => t.a.x === 0 && t.a.y === 0 && t.b.x === 0 && t.b.y === 0

/**
 * Move everything with a world position by d: rooms, holes, pins, placed tapes, background.
 * In a v2 document the nodes of the wall graph move too (docs/walls-plan.md phase 5c): the walls
 * keep their ids, so a value keeps its target, and the room polygons stay on their walls.
 */
export function translateDoc(doc: PlanDoc, d: Vec): PlanDoc {
  if (d.x === 0 && d.y === 0) return doc
  const mv = <T extends Vec>(p: T): T => ({ ...p, x: p.x + d.x, y: p.y + d.y })
  return {
    ...doc,
    rooms: doc.rooms.map((r) => ({ ...r, vertices: r.vertices.map(mv), holes: r.holes.map((h) => h.map(mv)) })),
    ...(doc.nodes ? { nodes: doc.nodes.map(mv) } : {}),
    tapes: doc.tapes.map((t) => (unplaced(t) ? t : { ...t, a: mv(t.a), b: mv(t.b) })),
    ...(doc.pins ? { pins: doc.pins.map((p) => ({ ...p, at: mv(p.at) })) } : {}),
    ...(doc.background ? { background: { ...doc.background, xCm: doc.background.xCm + d.x, yCm: doc.background.yCm + d.y } } : {}),
  }
}

/** The doc with its rooms' top-left corner at (0, 0), and the offset that was applied. */
export function normalizeOrigin(doc: PlanDoc): { doc: PlanDoc; offset: Vec } {
  const offset = originOffset(doc)
  return { doc: translateDoc(doc, offset), offset }
}

