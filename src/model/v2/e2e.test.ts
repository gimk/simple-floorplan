// End-to-end test of the v2 model through the STORE (docs/walls-plan.md, phase 5c steps 3 + 4).
//
// This is the test the whole switch stands on: the demo apartment (a v1 document) is loaded, and
// then every tool operation goes through the real path (`useDoc.update` -> doc rules). After each
// operation three things must hold:
//   - the wall graph and the room polygons agree (no face without wall, no wall without face, every
//     cycle closed, one wall where two rooms touch), and no wall is stored twice;
//   - every measured value is still somewhere (measurements or oldMeasurements): a value is never
//     lost by an edit;
//   - the operation is ONE undo step that gives the previous document back exactly, and redo gives
//     the new one back.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../../core/commands'
import { demoRooms } from '../../features/measure/demo'
import { deleteRoom, insertVertex, makeRoom, rectPoints, removeVertex, sliceDoc, cutDoc } from '../../features/rooms/ops'
import { moveCornerNode, moveGraphRooms, moveStoredWall } from '../../features/rooms/interaction'
import { installMeasureRules } from '../../features/rooms/measureRules'
import { makeRoomAt } from '../../features/rooms/makeRoom'
import { ensureStoredGraph } from '../graphRule'
import { dist } from '../geometry'
import { beginDrag, emptyDoc, endDrag, useDoc } from '../store'
import { allSurveyIds } from '../survey'
import type { Measurement, PlanDoc, StoredNode, StoredWall, TraceWall, Vec } from '../types'
import { ensureV2 } from './ensure'

const AT = '2026-11-24T09:00:00.000Z'

/**
 * The walls stored twice of the loaded demo plan. The demo drawing has one wall of the plan 7 cm
 * over another one (two room walls that are not exactly on one line), so the baseline is not empty;
 * an edit must not add a new one.
 */
let baseline: string[] = []

// ---------- the plan and its checks ----------

/** The demo apartment as a v1 document (the demo button, before the load step converts it). */
const demoV1 = (): PlanDoc => {
  const rooms = demoRooms()
  const base: PlanDoc = { ...emptyDoc(), title: 'Demo', rooms }
  return { ...base, measurements: measuredValues(base) }
}

/** One value per survey label of the plan, all different: a lost value is easy to see. */
function measuredValues(doc: PlanDoc): Record<string, Measurement> {
  const out: Record<string, Measurement> = {}
  allSurveyIds(doc).forEach((s, i) => { out[s.label] = { label: s.label, actualCm: 100 + i, updatedAt: AT } })
  // Heights are not wall faces: they are kept as they are by every edit.
  return out
}

const roomOf = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)

/**
 * Walls stored twice: two walls on one line whose spans overlap (the wall between two rooms is ONE
 * wall). Walls that only touch at their ends, or that cross, are normal.
 * The key is the place of the overlap, not the wall ids: an edit must not ADD one of these.
 */
function duplicateWalls(doc: PlanDoc): string[] {
  const out: string[] = []
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  const walls = doc.walls ?? []
  for (let i = 0; i < walls.length; i++) {
    const si = ends(walls[i], nodes)
    if (!si) continue
    const li = dist(si.a, si.b)
    if (li < 1) continue
    const di = { x: (si.b.x - si.a.x) / li, y: (si.b.y - si.a.y) / li }
    for (let j = i + 1; j < walls.length; j++) {
      const sj = ends(walls[j], nodes)
      if (!sj) continue
      // The second wall must be on the same line, at both of its ends.
      const offJ = (p: Vec) => Math.abs((p.x - si.a.x) * di.y - (p.y - si.a.y) * di.x)
      if (offJ(sj.a) > 0.5 || offJ(sj.b) > 0.5) continue
      const along = (p: Vec) => (p.x - si.a.x) * di.x + (p.y - si.a.y) * di.y
      const lo = Math.max(0, Math.min(along(sj.a), along(sj.b)))
      const hi = Math.min(li, Math.max(along(sj.a), along(sj.b)))
      if (hi - lo <= 1) continue
      const at = (t: number) => ({ x: si.a.x + di.x * t, y: si.a.y + di.y * t })
      const p0 = at(lo), p1 = at(hi)
      const r = (n: number) => Math.round(n * 2) / 2
      out.push(`${r(p0.x)},${r(p0.y)} -> ${r(p1.x)},${r(p1.y)}`)
    }
  }
  return out.sort()
}

/** The two ends of a wall, or null when a node is missing. */
const ends = (w: StoredWall, nodes: Map<string, StoredNode>): { a: Vec; b: Vec } | null => {
  const a = nodes.get(w.a), b = nodes.get(w.b)
  return a && b ? { a, b } : null
}

/** True when a point lies on the line of a segment, within 1 cm of it and of its ends. */
function onLine(p: Vec, s: { a: Vec; b: Vec }): boolean {
  const length = dist(s.a, s.b)
  if (length < 1e-6) return false
  const d = { x: (s.b.x - s.a.x) / length, y: (s.b.y - s.a.y) / length }
  const off = Math.abs((p.x - s.a.x) * d.y - (p.y - s.a.y) * d.x)
  const t = (p.x - s.a.x) * d.x + (p.y - s.a.y) * d.y
  return off <= 1 && t >= -1 && t <= length + 1
}

/** True when two walls meet: a shared node, a wall that ends on the other, or a crossing. */
function meet(wa: StoredWall, wb: StoredWall, nodes: Map<string, StoredNode>): boolean {
  const ids = new Set([wa.a, wa.b])
  if (ids.has(wb.a) || ids.has(wb.b)) return true
  const sa = ends(wa, nodes), sb = ends(wb, nodes)
  if (!sa || !sb) return false
  return onLine(sa.a, sb) || onLine(sa.b, sb) || onLine(sb.a, sa) || onLine(sb.b, sa)
}

/** Structural problems of the wall graph of a v2 document (empty = walls and rooms agree). */
function graphProblems(doc: PlanDoc): string[] {
  const out: string[] = []
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  const walls = new Map((doc.walls ?? []).map((w) => [w.id, w]))
  for (const w of doc.walls ?? []) {
    if (!nodes.has(w.a) || !nodes.has(w.b)) out.push(`wall ${w.id}: node missing`)
    if (!w.faces.length) out.push(`wall ${w.id}: no face`)
    if (w.thicknessCm === undefined) out.push(`wall ${w.id}: no thickness`)
    for (const f of w.faces) {
      if (f.to < f.from) out.push(`wall ${w.id}: face ${f.from}..${f.to}`)
      if (f.roomId !== undefined && !doc.rooms.some((r) => r.id === f.roomId)) out.push(`wall ${w.id}: face of a room that is gone`)
    }
  }
  for (const r of doc.rooms) {
    const cycle = r.cycle ?? []
    if (!cycle.length) { out.push(`room ${r.code}: no cycle`); continue }
    if (cycle.length !== r.vertices.length) out.push(`room ${r.code}: ${cycle.length} faces, ${r.vertices.length} corners`)
    cycle.forEach((f, k) => {
      const wall = walls.get(f.wallId)
      if (!wall) { out.push(`room ${r.code}: face of wall ${f.wallId} that is gone`); return }
      if (!wall.faces.some((x) => x.roomId === r.id && x.side === f.side)) out.push(`room ${r.code}: ${f.wallId} has no face for it`)
      if (Math.abs(f.to - f.from) < 0.5) out.push(`room ${r.code}: empty face on ${f.wallId}`)
      // A closed cycle: the wall of a face and the wall of the face before it meet where the corner
      // is (at a shared node, or where one wall ends on the other).
      const before = cycle[(k + cycle.length - 1) % cycle.length]
      const other = walls.get(before.wallId)
      if (!other || other.id === wall.id) return
      if (!meet(wall, other, nodes)) out.push(`room ${r.code}: corner ${k} (${before.wallId} -> ${wall.id}) is not closed`)
    })
  }
  return out
}

/** Values of `before` that are in neither `measurements` nor `oldMeasurements` of `after`. */
function lostValues(before: PlanDoc, after: PlanDoc): string[] {
  const kept = [...Object.values(after.measurements), ...(after.oldMeasurements ?? [])]
  return Object.values(before.measurements).filter((m) => !kept.some((k) => k.actualCm === m.actualCm)).map((m) => m.label)
}

/**
 * Every check of one edit: the graph, the values, and the undo / redo of that one step.
 * `wallsOnce` is false for a "this room only" (Shift) drag: it COPIES the walls that another room
 * also uses, so a copy of a wall that runs the same way as the move lies on the wall it copies
 * (the v1 model did the same).
 */
function expectGoodEdit(before: PlanDoc, wallsOnce = true) {
  const after = useDoc.getState().doc
  expect(after).not.toBe(before)
  expect(graphProblems(after)).toEqual([])
  if (wallsOnce) expect(duplicateWalls(after).filter((k) => !baseline.includes(k))).toEqual([])
  expect(lostValues(before, after)).toEqual([])
  // One undo step: the previous document comes back exactly, then the new one.
  const temporal = useDoc.temporal.getState()
  temporal.undo()
  expect(useDoc.getState().doc).toEqual(before)
  temporal.redo()
  expect(useDoc.getState().doc).toEqual(after)
}

/** Load the demo apartment the way the app does (the demo button), and measure every wall. */
function loadDemo() {
  useDoc.getState().replace(emptyDoc())
  useDoc.temporal.getState().clear()
  // The demo button: one update that also runs the load step (model/v2/ensure.ts).
  useDoc.getState().update((d) => ensureV2({ ...d, title: 'Demo', rooms: demoRooms() }))
  // On-site values, as typed in Measuring Mode.
  useDoc.getState().update((d) => ({ ...d, measurements: measuredValues(d) }))
  baseline = duplicateWalls(useDoc.getState().doc)
}

/** A wall of the graph that holds a face of both rooms. */
const wallBetween = (doc: PlanDoc, a: string, b: string) =>
  (doc.walls ?? []).find((w) => w.faces.some((f) => f.roomId === a) && w.faces.some((f) => f.roomId === b))

beforeAll(() => installMeasureRules())

describe('the demo apartment, loaded through the store', () => {
  it('is a v2 document with the conversion report, and the rooms are unchanged', () => {
    useDoc.getState().replace(emptyDoc())
    useDoc.temporal.getState().clear()
    const v1 = demoV1()
    useDoc.getState().replace(v1)
    expect(useDoc.getState().doc.schemaVersion).toBeUndefined()
    const before = useDoc.getState().doc
    // The load step (model/v2/ensure.ts) is what hydrate, openDoc, connect and the demo call.
    useDoc.getState().replace(ensureV2(before, { now: AT }))
    const doc = useDoc.getState().doc
    expect(doc.schemaVersion).toBe(2)
    expect(doc.conversion?.at).toBe(AT)
    expect(doc.conversion?.report.counts.rooms).toBe(12)
    expect(doc.conversion?.report.counts.walls).toBeGreaterThan(20)
    // Same rooms: same ids, codes, names, walk order, corner ids and corner places (within 0.5 cm).
    expect(doc.rooms.length).toBe(before.rooms.length)
    doc.rooms.forEach((r, i) => {
      const o = before.rooms[i]
      expect(r.id).toBe(o.id)
      expect(r.code).toBe(o.code)
      expect(r.name).toBe(o.name)
      expect(r.walkOrder).toBe(o.walkOrder)
      expect(r.vertices.length).toBe(o.vertices.length)
      r.vertices.forEach((v, k) => {
        expect(v.id).toBe(o.vertices[k].id)
        expect(dist(v, o.vertices[k])).toBeLessThanOrEqual(0.5)
      })
    })
    // Same values (a target is added, no value moves).
    expect(Object.keys(doc.measurements).sort()).toEqual(Object.keys(before.measurements).sort())
    for (const [label, m] of Object.entries(before.measurements)) expect(doc.measurements[label].actualCm).toBe(m.actualCm)
    expect(graphProblems(doc)).toEqual([])
    // The conversion adds no wall: the walls stored twice are the two of the v1 graph of the demo.
    expect(duplicateWalls(doc)).toEqual(duplicateWalls(ensureStoredGraph(before)))
  })

  it('drags a corner of a room on the graph (one node, its walls follow)', () => {
    loadDemo()
    const before = useDoc.getState().doc
    const room = roomOf(before, 'demo-SE')!
    const node = (before.nodes ?? []).find((n) => dist(n, room.vertices[0]) < 0.5)!
    const to = { x: node.x + 20, y: node.y + 20 }
    // The same call as the corner drag of the select tool (features/rooms/interaction.ts).
    useDoc.getState().update((d) => moveCornerNode(d, node.id, to))
    const after = useDoc.getState().doc
    const moved = (after.nodes ?? []).find((n) => n.id === node.id)!
    expect(moved.x).toBe(to.x)
    // The polygons follow the graph, and the rooms that another wall cuts on the moved wall keep
    // their corners closed (the T junctions follow the wall).
    expect(dist(roomOf(after, 'demo-SE')!.vertices[0], room.vertices[0])).toBeGreaterThan(1)
    expectGoodEdit(before)
  })

  it('is ONE undo step for a whole drag (beginDrag / endDrag)', () => {
    loadDemo()
    useDoc.temporal.getState().clear()
    const before = useDoc.getState().doc
    const room = roomOf(before, 'demo-SE')!
    const node = (before.nodes ?? []).find((n) => dist(n, room.vertices[0]) < 0.5)!
    // The pointer moves of a drag: previews without an undo step, then the drag ends.
    const start = beginDrag()
    for (let k = 1; k <= 5; k++) {
      useDoc.getState().updateSilent((d) => moveCornerNode(d, node.id, { x: node.x + k * 5, y: node.y + k * 3 }))
    }
    endDrag(start)
    const after = useDoc.getState().doc
    expect(after).not.toBe(before)
    expect(graphProblems(after)).toEqual([])
    // One step only: undo gives the document of the pointerdown, redo the finished drag.
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc).toEqual(before)
    useDoc.temporal.getState().redo()
    expect(useDoc.getState().doc).toEqual(after)
  })

  it('drags a wall of a room on the graph (both rooms follow)', () => {
    loadDemo()
    const before = useDoc.getState().doc
    const wall = wallBetween(before, 'demo-DG', 'demo-SD')!
    const nodes = new Map((before.nodes ?? []).map((n) => [n.id, n]))
    const a0 = nodes.get(wall.a)!, b0 = nodes.get(wall.b)!
    useDoc.getState().update((d) => moveStoredWall(d, wall.id, { x: 0, y: 25 }))
    const after = useDoc.getState().doc
    // ONE wall (same id), moved by 25 cm: both of its ends moved, and both rooms followed.
    const moved = (after.walls ?? []).find((w) => w.id === wall.id)!
    expect(moved.id).toBe(wall.id)
    const nodesAfter = new Map((after.nodes ?? []).map((n) => [n.id, n]))
    expect(nodesAfter.get(moved.a)!.y).toBe(a0.y + 25)
    expect(nodesAfter.get(moved.b)!.y).toBe(b0.y + 25)
    // The two rooms still see the same wall.
    expect(wallBetween(after, 'demo-DG', 'demo-SD')).toBeDefined()
    expectGoodEdit(before)
  })

  it('drags a whole room on the graph, and with Shift this room only', () => {
    loadDemo()
    const before = useDoc.getState().doc
    useDoc.getState().update((d) => moveGraphRooms(d, ['demo-SB'], { x: 40, y: 0 }, false))
    const neighbourFollowed = useDoc.getState().doc
    expectGoodEdit(before)
    // Shift = this room only: the walls shared with the neighbours stay, and the room gets its own
    // copies of them (a move across its own walls, so no copy lies on the wall it copies).
    useDoc.getState().update((d) => moveGraphRooms(d, ['demo-SB'], { x: 0, y: 40 }, true))
    const after = useDoc.getState().doc
    expect(after.rooms.length).toBe(neighbourFollowed.rooms.length)
    expectGoodEdit(neighbourFollowed, false)
  })
})

describe('a tool operation on the demo apartment', () => {
  beforeEach(() => loadDemo())

  it('adds a rectangle room against a wall of another room (one wall, not two)', () => {
    const before = useDoc.getState().doc
    const se = roomOf(before, 'demo-SE')!
    // The right side of SE (x = max) is a wall: the new room's left wall lies on it.
    const x1 = Math.max(...se.vertices.map((v) => v.x))
    const y0 = Math.min(...se.vertices.map((v) => v.y))
    const pts = rectPoints({ x: x1, y: y0 + 50 }, { x: x1 + 200, y: y0 + 250 })
    let id = ''
    useDoc.getState().update((d) => {
      const r = makeRoom(d, pts)
      id = r.id
      return { ...d, rooms: [...d.rooms, r] }
    })
    const after = useDoc.getState().doc
    const added = roomOf(after, id)!
    expect(added.code).toBeTruthy()
    // ONE wall between the new room and SE (a shared wall, not a copy).
    expect(wallBetween(after, 'demo-SE', id)).toBeDefined()
    expectGoodEdit(before)
  })

  it('adds a polygon room', () => {
    const before = useDoc.getState().doc
    const pts: Vec[] = [{ x: 4000, y: 4000 }, { x: 4500, y: 4000 }, { x: 4500, y: 4300 }, { x: 4200, y: 4600 }, { x: 4000, y: 4600 }]
    useDoc.getState().update((d) => {
      const r = makeRoom(d, pts)
      return { ...d, rooms: [...d.rooms, r] }
    })
    const after = useDoc.getState().doc
    expect(after.rooms.length).toBe(before.rooms.length + 1)
    const added = after.rooms[after.rooms.length - 1]
    expect(added.cycle?.length).toBe(5)
    expectGoodEdit(before)
  })

  it('slices a room in two', () => {
    const before = useDoc.getState().doc
    const c2 = roomOf(before, 'demo-C2')!
    const xs = c2.vertices.map((v) => v.x), ys = c2.vertices.map((v) => v.y)
    const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) }
    const r = sliceDoc(before, { x: mid.x, y: mid.y - 50 }, { x: mid.x, y: Math.max(...ys) + 50 })
    expect(r).not.toBeNull()
    useDoc.getState().update(() => r!.doc)
    expect(useDoc.getState().doc.rooms.length).toBe(before.rooms.length + 1)
    expectGoodEdit(before)
  })

  it('cuts a hole out of a room (cutout)', () => {
    const before = useDoc.getState().doc
    const se = roomOf(before, 'demo-SE')!
    const xs = se.vertices.map((v) => v.x), ys = se.vertices.map((v) => v.y)
    const ring = rectPoints(
      { x: Math.min(...xs) + 30, y: Math.min(...ys) + 30 },
      { x: Math.min(...xs) + 130, y: Math.min(...ys) + 130 },
    )
    const r = cutDoc(before, ring)
    expect(r).not.toBeNull()
    useDoc.getState().update(() => r!.doc)
    const after = useDoc.getState().doc
    expect(roomOf(after, 'demo-SE')!.holes.length).toBe(1)
    expectGoodEdit(before)
  })

  it('merges two rooms (the merge_rooms command, through the store)', () => {
    const before = useDoc.getState().doc
    const dg = roomOf(before, 'demo-DG')!, sd = roomOf(before, 'demo-SD')!
    const out = apply(before, { type: 'merge_rooms', roomIds: [dg.id, sd.id] })
    expect(out.doc.rooms.length).toBe(before.rooms.length - 1)
    useDoc.getState().update(() => out.doc)
    const after = useDoc.getState().doc
    // The command keeps the identity of the first room and drops the other one.
    expect(roomOf(after, dg.id)).toBeDefined()
    expect(roomOf(after, sd.id)).toBeUndefined()
    expect(roomOf(after, dg.id)!.vertices.length).toBeGreaterThan(dg.vertices.length)
    expectGoodEdit(before)
  })

  it('adds a corner on a wall, then removes it', () => {
    const before = useDoc.getState().doc
    const en = roomOf(before, 'demo-EN')!
    const a = en.vertices[0], b = en.vertices[1]
    const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const r = insertVertex(before, 'demo-EN', a.id, at)!
    useDoc.getState().update(() => r.doc)
    const withCorner = useDoc.getState().doc
    expect(roomOf(withCorner, 'demo-EN')!.vertices.length).toBe(en.vertices.length + 1)
    expectGoodEdit(before)

    // Then remove that corner again: one undo step, and the plan is back to the previous one.
    const beforeRemove = withCorner
    useDoc.getState().update((d) => removeVertex(d, 'demo-EN', r.vertexId))
    expect(roomOf(useDoc.getState().doc, 'demo-EN')!.vertices.length).toBe(en.vertices.length)
    expectGoodEdit(beforeRemove)
  })

  it('deletes a room', () => {
    const before = useDoc.getState().doc
    useDoc.getState().update((d) => deleteRoom(d, 'demo-WC'))
    expect(roomOf(useDoc.getState().doc, 'demo-WC')).toBeUndefined()
    expectGoodEdit(before)
  })

  it('changes the thickness of a shared wall in the wall card (both rooms see it)', () => {
    const before = useDoc.getState().doc
    const wall = wallBetween(before, 'demo-DG', 'demo-SD')!
    const dg = roomOf(before, 'demo-DG')!
    const wallStart = dg.cycle!.find((f) => f.wallId === wall.id)!.cornerId
    useDoc.getState().update((d) => ({
      ...d,
      rooms: d.rooms.map((r) => (r.id === 'demo-DG'
        ? { ...r, walls: { ...r.walls, [wallStart]: { ...r.walls[wallStart], thicknessCm: 18 } } }
        : r)),
    }))
    const after = useDoc.getState().doc
    expect((after.walls ?? []).find((w) => w.id === wall.id)!.thicknessCm).toBe(18)
    // ONE wall: both rooms read the same thickness.
    const sd = roomOf(after, 'demo-SD')!
    const sdCorner = sd.cycle!.find((f) => f.wallId === wall.id)!.cornerId
    expect(sd.walls[sdCorner].thicknessCm).toBe(18)
    expect(wallBetween(after, 'demo-DG', 'demo-SD')!.id).toBe(wall.id)
    expectGoodEdit(before)
  })

  it('makes a room from traced walls', () => {
    const before = useDoc.getState().doc
    const p = (x: number, y: number) => ({ x, y })
    const traces: TraceWall[] = [
      { id: 'tr1', a: p(6000, 6000), b: p(6400, 6000), thicknessCm: 10, type: 'partition' },
      { id: 'tr2', a: p(6400, 6000), b: p(6400, 6400), thicknessCm: 30, type: 'exterior' },
      { id: 'tr3', a: p(6400, 6400), b: p(6000, 6400), thicknessCm: 10, type: 'partition' },
      { id: 'tr4', a: p(6000, 6400), b: p(6000, 6000), thicknessCm: 10, type: 'partition' },
    ]
    const withTraces: PlanDoc = { ...before, traces }
    useDoc.getState().update(() => withTraces)
    const beforeMake = useDoc.getState().doc
    const out = makeRoomAt(beforeMake, p(6200, 6200), 2)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    useDoc.getState().update(() => out.doc)
    const after = useDoc.getState().doc
    const made = roomOf(after, out.roomId)!
    expect(made.cycle?.length).toBe(4)
    expect(after.rooms.length).toBe(beforeMake.rooms.length + 1)
    // The traced walls that the new room walls cover are gone with it (one undo step).
    expect((after.traces ?? []).length).toBe(0)
    expectGoodEdit(beforeMake)
  })
})
