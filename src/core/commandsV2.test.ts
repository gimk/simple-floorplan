// Server commands on a v2 document (docs/walls-plan.md, phase 5c step 4): the API, the MCP tools
// and the CLI write a room polygon as before, and the walls stay the source, so one wall between
// two rooms stays ONE wall with its two faces. A v1 document stays a v1 document here: the client
// converts it when it loads it.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../features/measure/demo'
import { dist } from '../model/geometry'
import { allSurveyIds } from '../model/survey'
import { emptyDoc } from '../model/store'
import type { Measurement, PlanDoc, StoredNode, StoredWall, Vec } from '../model/types'
import { ensureV2 } from '../model/v2/ensure'
import { apply } from './commands'

const AT = '2026-11-24T09:00:00.000Z'

/** The demo apartment with one value per survey label, as a v1 document. */
function demoV1(): PlanDoc {
  const rooms = demoRooms()
  const base: PlanDoc = { ...emptyDoc(), title: 'Demo', rooms }
  const measurements: Record<string, Measurement> = {}
  allSurveyIds(base).forEach((s, i) => { measurements[s.label] = { label: s.label, actualCm: 100 + i, updatedAt: AT } })
  return { ...base, measurements }
}

/** The demo apartment in the v2 state (what the client holds after a load). */
const demoV2 = () => ensureV2(demoV1(), { now: AT })

const roomOf = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)
const wallsBetween = (doc: PlanDoc, a: string, b: string) =>
  (doc.walls ?? []).filter((w) => w.faces.some((f) => f.roomId === a) && w.faces.some((f) => f.roomId === b))
const ends = (w: StoredWall, nodes: Map<string, StoredNode>): { a: Vec; b: Vec } | null => {
  const a = nodes.get(w.a), b = nodes.get(w.b)
  return a && b ? { a, b } : null
}

/** Walls stored twice on one line (the demo has one; a command must not add one). */
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
      const offJ = (p: Vec) => Math.abs((p.x - si.a.x) * di.y - (p.y - si.a.y) * di.x)
      if (offJ(sj.a) > 0.5 || offJ(sj.b) > 0.5) continue
      const along = (p: Vec) => (p.x - si.a.x) * di.x + (p.y - si.a.y) * di.y
      const lo = Math.max(0, Math.min(along(sj.a), along(sj.b)))
      const hi = Math.min(li, Math.max(along(sj.a), along(sj.b)))
      if (hi - lo <= 1) continue
      const r = (n: number) => Math.round(n * 2) / 2
      out.push(`${r(si.a.x + di.x * lo)},${r(si.a.y + di.y * lo)} -> ${r(si.a.x + di.x * hi)},${r(si.a.y + di.y * hi)}`)
    }
  }
  return out.sort()
}

/** The walls and the room cycles agree (no face without wall, no wall without face, cycles closed). */
function graphProblems(doc: PlanDoc): string[] {
  const out: string[] = []
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  const walls = new Map((doc.walls ?? []).map((w) => [w.id, w]))
  for (const w of doc.walls ?? []) {
    if (!nodes.has(w.a) || !nodes.has(w.b)) out.push(`wall ${w.id}: node missing`)
    if (!w.faces.length) out.push(`wall ${w.id}: no face`)
    if (w.thicknessCm === undefined) out.push(`wall ${w.id}: no thickness`)
    for (const f of w.faces) if (f.roomId !== undefined && !doc.rooms.some((r) => r.id === f.roomId)) out.push(`wall ${w.id}: face of a room that is gone`)
  }
  for (const r of doc.rooms) {
    const cycle = r.cycle ?? []
    if (!cycle.length) { out.push(`room ${r.code}: no cycle`); continue }
    if (cycle.length !== r.vertices.length) out.push(`room ${r.code}: ${cycle.length} faces, ${r.vertices.length} corners`)
    for (const f of cycle) {
      const w = walls.get(f.wallId)
      if (!w) { out.push(`room ${r.code}: wall ${f.wallId} is gone`); continue }
      if (!w.faces.some((x) => x.roomId === r.id && x.side === f.side)) out.push(`room ${r.code}: ${f.wallId} has no face for it`)
      if (Math.abs(f.to - f.from) < 0.5) out.push(`room ${r.code}: empty face on ${f.wallId}`)
    }
  }
  return out
}

/** Values of `before` that are in neither `measurements` nor `oldMeasurements` of `after`. */
function lostValues(before: PlanDoc, after: PlanDoc): string[] {
  const kept = [...Object.values(after.measurements), ...(after.oldMeasurements ?? [])]
  return Object.values(before.measurements).filter((m) => !kept.some((k) => k.actualCm === m.actualCm)).map((m) => m.label)
}

describe('a v2 document through the commands', () => {
  it('adds a room against a wall: one wall between the two rooms, values kept', () => {
    const doc = demoV2()
    const se = roomOf(doc, 'demo-SE')!
    const x1 = Math.max(...se.vertices.map((v) => v.x))
    const y0 = Math.min(...se.vertices.map((v) => v.y))
    const out = apply(doc, { type: 'add_room', code: 'ZZ', rect: { x: x1, y: y0 + 40, w: 250, h: 200 } })
    const after = out.doc
    expect(after.schemaVersion).toBe(2)
    const added = after.rooms.find((r) => r.code === 'ZZ')!
    expect(added.cycle?.length).toBe(4)
    expect(wallsBetween(after, 'demo-SE', added.id).length).toBe(1)
    expect(graphProblems(after)).toEqual([])
    expect(duplicateWalls(after)).toEqual(duplicateWalls(doc))
    expect(lostValues(doc, after)).toEqual([])
  })

  it('deletes a room: the walls that no other room uses go away', () => {
    const doc = demoV2()
    const out = apply(doc, { type: 'delete_room', roomCode: 'WC' })
    const after = out.doc
    expect(after.schemaVersion).toBe(2)
    expect(roomOf(after, 'demo-WC')).toBeUndefined()
    // No wall holds a face of the room that is gone.
    expect((after.walls ?? []).some((w) => w.faces.some((f) => f.roomId === 'demo-WC'))).toBe(false)
    expect(graphProblems(after)).toEqual([])
  })

  it('changes the thickness of a shared wall: both rooms see it, one wall', () => {
    const doc = demoV2()
    const wall = wallsBetween(doc, 'demo-DG', 'demo-SD')[0]
    const out = apply(doc, { type: 'set_wall_props', wall: { roomId: 'demo-DG', wallStart: roomOf(doc, 'demo-DG')!.cycle!.find((f) => f.wallId === wall.id)!.cornerId }, thicknessCm: 18 })
    const after = out.doc
    expect(after.schemaVersion).toBe(2)
    expect((after.walls ?? []).find((w) => w.id === wall.id)!.thicknessCm).toBe(18)
    // The two rooms still see the same wall, with the same thickness.
    const sd = roomOf(after, 'demo-SD')!
    const corner = sd.cycle!.find((f) => f.wallId === wall.id)!.cornerId
    expect(sd.walls[corner].thicknessCm).toBe(18)
    // No new wall between the two rooms (the demo shares more than one: the inner wall and the
    // outer wall that both rooms touch).
    expect(wallsBetween(after, 'demo-DG', 'demo-SD').length).toBe(wallsBetween(doc, 'demo-DG', 'demo-SD').length)
    expect(graphProblems(after)).toEqual([])
  })

  it('moves a corner: the graph follows and the values follow their target', () => {
    const doc = demoV2()
    const room = roomOf(doc, 'demo-C1')!
    const corner = room.vertices[0]
    const out = apply(doc, { type: 'move_vertex', roomId: 'demo-C1', vertexId: corner.id, x: corner.x + 30, y: corner.y })
    const after = out.doc
    expect(after.schemaVersion).toBe(2)
    expect(graphProblems(after)).toEqual([])
    expect(dist(roomOf(after, 'demo-C1')!.vertices[0], corner)).toBeGreaterThan(20)
    expect(lostValues(doc, after)).toEqual([])
  })

  it('keeps the conversion report of the document', () => {
    const doc = demoV2()
    const out = apply(doc, { type: 'delete_room', roomCode: 'WC' })
    expect(out.doc.conversion?.at).toBe(AT)
    expect(out.doc.conversion?.report.counts.rooms).toBe(12)
  })

  it('slices and cuts a room of the graph', () => {
    const doc = demoV2()
    const c2 = roomOf(doc, 'demo-C2')!
    const xs = c2.vertices.map((v) => v.x), ys = c2.vertices.map((v) => v.y)
    const sliced = apply(doc, { type: 'slice_room', roomId: 'demo-C2', a: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) - 20 }, b: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) + 20 } }).doc
    expect(sliced.rooms.length).toBe(doc.rooms.length + 1)
    expect(graphProblems(sliced)).toEqual([])
    expect(lostValues(doc, sliced)).toEqual([])
    const cut = apply(sliced, { type: 'cutout_room', roomId: 'demo-SE', rect: { x: 600, y: 400, w: 60, h: 60 } }).doc
    expect(graphProblems(cut)).toEqual([])
    expect(lostValues(sliced, cut)).toEqual([])
  })
})

describe('a v1 document through the commands', () => {
  it('stays a v1 document (the client converts it on load)', () => {
    const doc = ensureV1()
    const out = apply(doc, { type: 'add_room', code: 'ZZ', rect: { x: 3000, y: 3000, w: 200, h: 200 } })
    expect(out.doc.schemaVersion).toBe(1)
    expect(out.doc.rooms.some((r) => r.code === 'ZZ')).toBe(true)
    // No cycle is written by a command on a v1 document.
    expect(out.doc.rooms.every((r) => r.cycle === undefined)).toBe(true)
  })
})

/** The demo apartment as a v1 document with its stored graph (phase 5a), as an old client sends it. */
function ensureV1(): PlanDoc {
  const doc = demoV1()
  const v2 = demoV2()
  return { ...doc, nodes: v2.nodes, walls: v2.walls, schemaVersion: 1 }
}
