import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import { roomAreaM2, roomWalls } from '../../model/geometry'
import type { Measurement, PlanDoc, Room, WallElement } from '../../model/types'
import { applyMeasured, applyMeasuredAll, isRectilinear, isRightAngledQuad, setVerifiedLocked, verifiedAllLocked, verifiedWalls } from './apply'
import { newEdgeCrosses, selfIntersects } from './crossing'
import {
  cutDoc, insertVertex, linkedVertices, makeRoom, movableLinked, moveHoleVertex, moveVertices, rectPoints, removeHole,
  removeHoleVertex, sliceDoc,
} from './ops'

const P = (x: number, y: number) => ({ x, y })
const meas = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '' })
const withRoom = (pts = rectPoints(P(0, 0), P(400, 300))) => {
  const d = emptyDoc()
  const room = makeRoom(d, pts)
  return { doc: { ...d, rooms: [room] } as PlanDoc, room }
}
const len = (r: Room) => roomWalls(r).map((w) => w.length)

describe('selfIntersects', () => {
  it('accepts simple polygons', () => {
    expect(selfIntersects(rectPoints(P(0, 0), P(10, 10)))).toBe(false)
    expect(selfIntersects([P(0, 0), P(10, 0), P(10, 10), P(5, 5), P(0, 10)])).toBe(false)
  })
  it('detects a bow tie', () => {
    expect(selfIntersects([P(0, 0), P(10, 10), P(10, 0), P(0, 10)])).toBe(true)
  })
  it('detects a vertex touching another edge', () => {
    expect(selfIntersects([P(0, 0), P(10, 0), P(10, 10), P(5, 0), P(0, 10)])).toBe(true)
  })
  it('detects a fold back', () => {
    expect(selfIntersects([P(0, 0), P(10, 0), P(5, 0), P(5, 5)])).toBe(true)
  })
  it('allows collinear vertices', () => {
    expect(selfIntersects([P(0, 0), P(5, 0), P(10, 0), P(10, 10), P(0, 10)])).toBe(false)
  })
})

describe('newEdgeCrosses', () => {
  const path = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)]
  it('refuses a point whose edge crosses an earlier edge', () => {
    expect(newEdgeCrosses(path, P(50, -50))).toBe(true)
  })
  it('accepts a harmless point', () => {
    expect(newEdgeCrosses(path, P(-50, 50))).toBe(false)
    expect(newEdgeCrosses(path, P(-20, 100))).toBe(false)
  })
  it('refuses a fold back on the last edge', () => {
    expect(newEdgeCrosses(path, P(50, 100))).toBe(true)
  })
})

describe('shared corners', () => {
  const two = () => {
    const d = emptyDoc()
    const a = makeRoom(d, rectPoints(P(0, 0), P(400, 300)))
    const b = makeRoom({ ...d, rooms: [a] }, rectPoints(P(400, 0), P(700, 300)))
    return { doc: { ...d, rooms: [a, b] } as PlanDoc, a, b }
  }
  it('finds vertices of other rooms at the same position', () => {
    const { doc, a, b } = two()
    expect(linkedVertices(doc, a.id, a.vertices[1].id)).toEqual([{ roomId: b.id, vertexId: b.vertices[0].id }])
    expect(linkedVertices(doc, a.id, a.vertices[0].id)).toEqual([])
  })
  it('uses the 0.5 cm tolerance', () => {
    const { doc, a, b } = two()
    const near = { ...doc, rooms: [a, { ...b, vertices: b.vertices.map((v, i) => (i === 0 ? { ...v, x: 400.4 } : v)) }] }
    expect(linkedVertices(near, a.id, a.vertices[1].id)).toHaveLength(1)
    const far = { ...doc, rooms: [a, { ...b, vertices: b.vertices.map((v, i) => (i === 0 ? { ...v, x: 401 } : v)) }] }
    expect(linkedVertices(far, a.id, a.vertices[1].id)).toHaveLength(0)
  })
  it('moves linked vertices together', () => {
    const { doc, a } = two()
    const moves = [
      { roomId: a.id, vertexId: a.vertices[1].id, x: 420, y: -10 },
      ...movableLinked(doc, a.id, a.vertices[1].id).map((l) => ({ ...l, x: 420, y: -10 })),
    ]
    const next = moveVertices(doc, moves)
    expect(next.rooms[0].vertices[1]).toMatchObject({ x: 420, y: -10 })
    expect(next.rooms[1].vertices[0]).toMatchObject({ x: 420, y: -10 })
    expect(next.rooms[1].vertices[1]).toMatchObject({ x: 700, y: 0 })
  })
  it('does not move a corner of a room whose wall is locked', () => {
    const { doc, a, b } = two()
    const locked = { ...doc, rooms: [a, { ...b, walls: { [b.vertices[0].id]: { type: 'partition' as const, thicknessCm: 10, locked: true } } }] }
    expect(movableLinked(locked, a.id, a.vertices[1].id)).toEqual([])
  })
})

describe('holes', () => {
  const holed = () => {
    const { doc, room } = withRoom()
    const hole = [P(100, 100), P(200, 100), P(200, 200), P(100, 200)].map((p, i) => ({ id: 'h' + i, ...p }))
    return { doc: { ...doc, rooms: [{ ...room, holes: [hole] }] } as PlanDoc, room }
  }
  it('moves, removes a vertex (min 3) and removes the hole', () => {
    const { doc, room } = holed()
    const moved = moveHoleVertex(doc, room.id, 'h2', P(250, 250))
    expect(moved.rooms[0].holes[0][2]).toMatchObject({ x: 250, y: 250 })
    const four = removeHoleVertex(doc, room.id, 'h2')
    expect(four.rooms[0].holes[0]).toHaveLength(3)
    expect(removeHoleVertex(four, room.id, 'h1')).toBe(four)
    expect(removeHole(four, room.id, 0).rooms[0].holes).toHaveLength(0)
    expect(removeHole(doc, room.id, 5)).toBe(doc)
  })
})

describe('collinear vertices survive slice and cutout', () => {
  const withMid = () => {
    const { doc, room } = withRoom()
    const r = insertVertex(doc, room.id, room.vertices[0].id, P(200, 0))!
    return { doc: r.doc, room, mid: r.vertexId }
  }
  it('keeps the mid vertex (and the wall props around it) after a slice elsewhere', () => {
    const { doc, room, mid } = withMid()
    const topProps = { type: 'exterior' as const, thicknessCm: 30 }
    const d1: PlanDoc = {
      ...doc,
      rooms: doc.rooms.map((r) => ({ ...r, walls: { [room.vertices[0].id]: topProps, [mid]: topProps } })),
    }
    const r = sliceDoc(d1, P(300, -50), P(300, 350))!
    const left = r.doc.rooms.find((x) => x.vertices.some((v) => v.id === mid))!
    expect(left).toBeTruthy()
    expect(left.vertices.map((v) => v.id)).toContain(room.vertices[0].id)
    // both halves of the top wall keep their props
    const i = left.vertices.findIndex((v) => v.id === room.vertices[0].id)
    expect(left.walls[left.vertices[i].id]).toEqual(topProps)
    expect(left.walls[mid]).toEqual(topProps)
    expect(left.vertices).toHaveLength(5)
  })
  it('keeps element hosts on the second half of a split wall', () => {
    const { doc, mid } = withMid()
    const room = doc.rooms[0]
    const e: WallElement = { id: 'e1', roomId: room.id, wallStart: mid, kind: 'window', offsetCm: 20, widthCm: 80, createdAt: '', updatedAt: '' }
    const r = sliceDoc({ ...doc, elements: [e] }, P(300, -50), P(300, 350))!
    expect(r.doc.elements).toHaveLength(1)
    expect(r.doc.elements[0].wallStart).toBe(mid)
    expect(r.doc.elements[0].offsetCm).toBeCloseTo(20)
  })
  it('keeps the mid vertex after a cutout in another corner', () => {
    const { doc, mid } = withMid()
    const r = cutDoc(doc, rectPoints(P(300, 200), P(450, 350)))!
    expect(r.doc.rooms[0].vertices.map((v) => v.id)).toContain(mid)
    expect(roomAreaM2(r.doc.rooms[0])).toBeCloseTo(12 - 1 * 1, 5) // 100 x 100 cm removed
  })
})

describe('verifiedWalls / lock', () => {
  it('reads CODE-n measurements and locks them', () => {
    const { doc, room } = withRoom()
    const d: PlanDoc = { ...doc, measurements: { 'R1-1': meas('R1-1', 410), 'R1-3': meas('R1-3', 412), 'R1-D': meas('R1-D', 500) } }
    const v = verifiedWalls(d, room)
    expect(v.map((x) => x.label)).toEqual(['R1-1', 'R1-3'])
    expect(verifiedAllLocked(d, room)).toBe(false)
    const locked = setVerifiedLocked(d, room.id, true)
    expect(locked.rooms[0].walls[room.vertices[0].id].locked).toBe(true)
    expect(locked.rooms[0].walls[room.vertices[1].id]?.locked).toBeFalsy()
    expect(verifiedAllLocked(locked, locked.rooms[0])).toBe(true)
    expect(verifiedAllLocked(setVerifiedLocked(locked, room.id, false), room)).toBe(false)
  })
})

describe('applyMeasured', () => {
  it('detects right-angled quads', () => {
    expect(isRightAngledQuad(withRoom().room)).toBe(true)
    expect(isRightAngledQuad(withRoom([P(0, 0), P(400, 0), P(450, 300), P(0, 300)]).room)).toBe(false)
  })
  it('rectangle: fit meets opposite walls in the middle, only the exact wall is locked', () => {
    const { doc, room } = withRoom()
    const d: PlanDoc = { ...doc, measurements: { 'R1-1': meas('R1-1', 410), 'R1-3': meas('R1-3', 414), 'R1-2': meas('R1-2', 305) } }
    const r = applyMeasured(d, room.id)
    expect(r.report.mode).toBe('lsq')
    expect(r.report.residuals.find((x) => x.index === 0)?.diffCm).toBeCloseTo(-2, 0)
    expect(r.report.residuals.find((x) => x.index === 2)?.diffCm).toBeCloseTo(2, 0)
    expect(r.report.rmsCm).toBeCloseTo(Math.sqrt((4 + 4 + 0) / 3), 1)
    const out = r.doc.rooms[0]
    expect(len(out)[0]).toBeCloseTo(412, 0)
    expect(len(out)[2]).toBeCloseTo(412, 0)
    expect(len(out)[1]).toBeCloseTo(305)
    expect(len(out)[3]).toBeCloseTo(305)
    expect(isRightAngledQuad(out)).toBe(true)
    expect(out.vertices[0]).toMatchObject({ x: 0, y: 0 })
    // |residual| 2 > 0.5: wall 1 is not locked. Wall 2 (305) fits exactly and is locked.
    expect(out.walls[room.vertices[0].id]?.locked).toBeFalsy()
    expect(out.walls[room.vertices[1].id].locked).toBe(true)
    expect(out.walls[room.vertices[3].id]?.locked).toBeFalsy()
  })
  it('rectangle: diagonal is a constraint and its residual is reported', () => {
    const { doc, room } = withRoom()
    const d: PlanDoc = { ...doc, measurements: { 'R1-1': meas('R1-1', 400), 'R1-2': meas('R1-2', 300), 'R1-D': meas('R1-D', 510) } }
    const r = applyMeasured(d, room.id)
    expect(r.report.residuals.find((x) => x.index === 'D')?.diffCm).toBeGreaterThan(3)
    expect(r.report.diagonal?.diffCm).toBeGreaterThan(3)
    // The diagonal is a weight-1 constraint, like the walls: wall 0 gives way by a few cm.
    expect(Math.abs(len(r.doc.rooms[0])[0] - 400)).toBeLessThan(5)
  })
  it('rectangle: unmeasured pair keeps its size', () => {
    const { doc, room } = withRoom()
    const r = applyMeasured({ ...doc, measurements: { 'R1-2': meas('R1-2', 320) } }, room.id)
    const out = r.doc.rooms[0]
    expect(len(out)[0]).toBeCloseTo(400)
    expect(len(out)[1]).toBeCloseTo(320)
  })
  it('does nothing without verified values', () => {
    const { doc, room } = withRoom()
    const r = applyMeasured(doc, room.id)
    expect(r.report.mode).toBe('none')
    expect(r.doc).toBe(doc)
  })
  // One slanted wall (index 2), so this room is not rectilinear: free polygon solver.
  const slanted = [P(0, 0), P(400, 0), P(400, 150), P(200, 300), P(0, 300)]
  it('polygon: measured walls keep their length, polygon closes, error is reported', () => {
    const { doc, room } = withRoom(slanted)
    const d: PlanDoc = { ...doc, measurements: { 'R1-1': meas('R1-1', 410), 'R1-5': meas('R1-5', 304) } }
    const r = applyMeasured(d, room.id)
    expect(r.report.mode).toBe('lsq')
    // Right angles at v0, v1 and v4 fix both measured walls at once: no fit error.
    expect(r.report.closingErrorCm).toBeCloseTo(0, 1)
    const out = r.doc.rooms[0]
    const l = len(out)
    expect(l[0]).toBeCloseTo(410, 2)
    expect(l[4]).toBeCloseTo(304, 2)
    // closed: polygon still has its 5 vertices and v0 did not move
    expect(out.vertices).toHaveLength(5)
    expect(out.vertices[0]).toMatchObject({ x: 0, y: 0 })
    expect(out.walls[room.vertices[0].id].locked).toBe(true)
    expect(out.walls[room.vertices[4].id].locked).toBe(true)
  })
  it('polygon: all walls measured, the fit spreads the error and locks only walls within 0.5 cm', () => {
    const { doc, room } = withRoom(slanted)
    const m: Record<string, Measurement> = {}
    ;[400, 150, 250, 200, 300].forEach((v, i) => { m[`R1-${i + 1}`] = meas(`R1-${i + 1}`, v) })
    m['R1-1'] = meas('R1-1', 420)
    const r = applyMeasured({ ...doc, measurements: m }, room.id)
    expect(r.report.mode).toBe('lsq')
    expect(r.report.residuals).toHaveLength(5)
    expect(r.report.closingErrorCm).toBeGreaterThan(1)
    expect(r.report.closingErrorCm).toBeLessThan(20)
    const out = r.doc.rooms[0]
    expect(out.vertices).toHaveLength(5)
    expect(out.vertices[0]).toMatchObject({ x: 0, y: 0 })
    // Wall 1 (420) is pulled by the right angles: not locked.
    expect(out.walls[room.vertices[0].id]?.locked).toBeFalsy()
  })

  const lShape = [P(0, 0), P(400, 0), P(400, 150), P(200, 150), P(200, 300), P(0, 300)]
  it('L shape: right angles are kept, unmeasured walls take the gap', () => {
    const { doc, room } = withRoom(lShape)
    expect(isRectilinear(room)).toBe(true)
    const d: PlanDoc = { ...doc, measurements: { 'R1-1': meas('R1-1', 410), 'R1-6': meas('R1-6', 304) } }
    const r = applyMeasured(d, room.id)
    expect(r.report.mode).toBe('lsq')
    const out = r.doc.rooms[0]
    expect(isRectilinear(out)).toBe(true)
    const l = len(out)
    expect(l[0]).toBeCloseTo(410, 1)
    expect(l[5]).toBeCloseTo(304, 1)
    // x: 410 = wall 3 + wall 5 (were 200 + 200); y: 304 = wall 2 + wall 4 (were 150 + 150)
    expect(l[2] + l[4]).toBeCloseTo(410, 1)
    expect(l[1] + l[3]).toBeCloseTo(304, 1)
    expect(out.vertices[0]).toMatchObject({ x: 0, y: 0 })
  })
  it('L shape: all walls measured, the gap is spread and right angles are kept', () => {
    const { doc, room } = withRoom(lShape)
    const m: Record<string, Measurement> = {}
    ;[403, 150, 200, 150, 200, 300].forEach((v, i) => { m[`R1-${i + 1}`] = meas(`R1-${i + 1}`, v) })
    const r = applyMeasured({ ...doc, measurements: m }, room.id)
    expect(r.report.mode).toBe('lsq')
    // Six residuals, three of 1 cm: rms = sqrt(3 / 6)
    expect(r.report.closingErrorCm).toBeCloseTo(Math.sqrt(0.5), 1)
    const out = r.doc.rooms[0]
    expect(isRectilinear(out)).toBe(true)
    const l = len(out)
    // 3 cm over the 3 x walls: 403 -> 402, 200 -> 201, 200 -> 201
    expect(l[0]).toBeCloseTo(402, 1)
    expect(l[2]).toBeCloseTo(201, 1)
    expect(l[4]).toBeCloseTo(201, 1)
    expect(l[5]).toBeCloseTo(300, 1)
  })
  it('a neighbour with its own measured walls is not bent, both stay rectangles', () => {
    const d0 = emptyDoc()
    const a = makeRoom(d0, rectPoints(P(0, 0), P(400, 300)))
    const b = makeRoom({ ...d0, rooms: [a] }, rectPoints(P(400, 0), P(700, 300)))
    const doc: PlanDoc = {
      ...d0, rooms: [a, b],
      measurements: { 'R1-1': meas('R1-1', 380), 'R1-2': meas('R1-2', 280), 'R2-1': meas('R2-1', 290), 'R2-2': meas('R2-2', 270) },
    }
    const r = applyMeasuredAll(doc)
    expect(r.reports.map((x) => x.mode)).toEqual(['lsq', 'lsq'])
    const [aOut, bOut] = r.doc.rooms
    expect(isRightAngledQuad(aOut)).toBe(true)
    expect(isRightAngledQuad(bOut)).toBe(true)
    expect(len(aOut)).toEqual([380, 280, 380, 280].map((x) => expect.closeTo(x)))
    expect(len(bOut)).toEqual([290, 270, 290, 270].map((x) => expect.closeTo(x)))
  })
  it('moves shared corners of a neighbour room, and applyMeasuredAll is one doc', () => {
    const d0 = emptyDoc()
    const a = makeRoom(d0, rectPoints(P(0, 0), P(400, 300)))
    const b = makeRoom({ ...d0, rooms: [a] }, rectPoints(P(400, 0), P(700, 300)))
    const doc: PlanDoc = { ...d0, rooms: [a, b], measurements: { 'R1-1': meas('R1-1', 420) } }
    const r = applyMeasuredAll(doc)
    expect(r.reports.map((x) => x.mode)).toEqual(['lsq', 'none'])
    const bOut = r.doc.rooms[1]
    expect(bOut.vertices[0].x).toBeCloseTo(420, 1)
    expect(bOut.vertices[0].y).toBeCloseTo(0, 5)
    expect(bOut.vertices[3].x).toBeCloseTo(420, 1)
    expect(bOut.vertices[3].y).toBeCloseTo(300, 5)
    expect(bOut.vertices[1]).toMatchObject({ x: 700, y: 0 })
  })
})
