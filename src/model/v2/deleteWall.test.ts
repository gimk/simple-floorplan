// Tests of `deleteWall` (pure): the locked wall, two rooms that merge, one room whose neighbours
// are extended, parallel neighbours, a door on the wall, a wall that no room uses.
import { describe, expect, it } from 'vitest'
import type { Measurement, PlanDoc, Room, WallElement } from '../types'
import { apply } from '../../core/commands'
import { convertToV2 } from './convert'
import { deleteWall } from './deleteWall'
import { attachElements } from './elements'
import { removeRoom } from './write'

const room = (id: string, pts: [number, number][], walkOrder = 1): Room => ({
  id, code: id, name: id, holes: [], walls: {}, walkOrder,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
})
const plan = (rooms: Room[], elements: WallElement[] = [], measurements: Record<string, Measurement> = {}): PlanDoc => ({
  projectId: 'p', title: 't', rooms, elements, measurements, roomNotes: {}, tapes: [],
})
const door = (roomId: string, wallStart: string, offsetCm: number): WallElement => ({
  id: 'D1', roomId, wallStart, kind: 'door', offsetCm, widthCm: 80, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})
const value = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '2026-01-01T00:00:00Z' })

/** The wall of room `id` whose corners are near the two points. */
function wallNear(doc: PlanDoc, p: [number, number], q: [number, number]): string {
  const pos = new Map(doc.nodes!.map((n) => [n.id, n]))
  const near = (n: { x: number; y: number } | undefined, c: [number, number]) => !!n && Math.hypot(n.x - c[0], n.y - c[1]) < 0.5
  const w = doc.walls!.find((x) => (near(pos.get(x.a), p) && near(pos.get(x.b), q)) || (near(pos.get(x.a), q) && near(pos.get(x.b), p)))
  if (!w) throw new Error('no wall')
  return w.id
}
const corners = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)!.vertices.map((v) => [Math.round(v.x), Math.round(v.y)])

// Slanted sides: the lines of the left and right walls meet at (200, 600).
const TRAPEZOID: [number, number][] = [[0, 0], [400, 0], [300, 300], [100, 300]]

describe('deleteWall', () => {
  it('refuses a locked wall', () => {
    const doc = convertToV2(plan([room('A', TRAPEZOID)])).doc
    const id = wallNear(doc, [300, 300], [100, 300])
    const locked = { ...doc, walls: doc.walls!.map((w) => (w.id === id ? { ...w, locked: true } : w)) }
    expect(deleteWall(locked, id)).toEqual({ error: 'This wall is locked' })
  })

  it('refuses when a wall next to it is locked', () => {
    const doc = convertToV2(plan([room('A', TRAPEZOID)])).doc
    const id = wallNear(doc, [300, 300], [100, 300])
    const left = wallNear(doc, [100, 300], [0, 0])
    const locked = { ...doc, walls: doc.walls!.map((w) => (w.id === left ? { ...w, locked: true } : w)) }
    expect(deleteWall(locked, id)).toEqual({ error: 'A wall next to it is locked' })
  })

  it('extends the two neighbours to their crossing (trapezoid -> triangle)', () => {
    const doc = convertToV2(plan([room('A', TRAPEZOID)])).doc
    const id = wallNear(doc, [300, 300], [100, 300])
    const res = deleteWall(doc, id)
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(corners(res.doc, 'A')).toEqual([[0, 0], [400, 0], [200, 600]])
    expect(res.doc.walls!.some((w) => w.id === id)).toBe(false)
    expect(res.doc.walls).toHaveLength(3)
    expect(res.doc.nodes).toHaveLength(3)
    expect(res.doc).not.toBe(doc)
    // Pure: the input is not changed.
    expect(doc.walls).toHaveLength(4)
  })

  it('refuses parallel neighbours (a rectangle)', () => {
    const doc = convertToV2(plan([room('A', [[0, 0], [400, 0], [400, 300], [0, 300]])])).doc
    const res = deleteWall(doc, doc.walls![0].id)
    expect(res).toEqual({ error: 'Cannot delete: the walls next to it are parallel. Move the wall or delete the room.' })
  })

  it('refuses a room that would have fewer than 3 corners (a triangle)', () => {
    const doc = convertToV2(plan([room('A', [[0, 0], [400, 0], [200, 300]])])).doc
    const res = deleteWall(doc, doc.walls![0].id)
    expect('error' in res).toBe(true)
  })

  it('deletes the doors on the wall and says so', () => {
    const doc = convertToV2(plan([room('A', TRAPEZOID, 1)], [door('A', 'A-v2', 50)])).doc
    expect(doc.elements).toHaveLength(1)
    const id = wallNear(doc, [300, 300], [100, 300])
    const res = deleteWall(doc, id)
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.doc.elements).toHaveLength(0)
    expect(res.message).toBe('Deleted wall and 1 door/window')
  })

  it('keeps the world place of a door on a neighbour', () => {
    // Door on the right wall (400,0)-(300,300), 100 cm from its start.
    const doc = attachElements(convertToV2(plan([room('A', TRAPEZOID)], [door('A', 'A-v1', 100)])).doc)
    const id = wallNear(doc, [300, 300], [100, 300])
    const before = doc.elements[0]
    const wallBefore = doc.walls!.find((w) => w.id === before.wallId)!
    const pos = (d: PlanDoc, w: typeof wallBefore, along: number) => {
      const a = d.nodes!.find((n) => n.id === w.a)!
      const b = d.nodes!.find((n) => n.id === w.b)!
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      return { x: a.x + ((b.x - a.x) / len) * along, y: a.y + ((b.y - a.y) / len) * along }
    }
    const p0 = pos(doc, wallBefore, before.alongCm!)
    const res = deleteWall(doc, id)
    if ('error' in res) throw new Error(res.error)
    const after = res.doc.elements[0]
    const wallAfter = res.doc.walls!.find((w) => w.id === after.wallId)!
    const p1 = pos(res.doc, wallAfter, after.alongCm!)
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeLessThan(0.5)
  })

  it('moves the measured length of a neighbour to the old values', () => {
    const doc = convertToV2(plan([room('A', TRAPEZOID)], [], { 'A-2': value('A-2', 316) })).doc
    const id = wallNear(doc, [300, 300], [100, 300])
    const res = deleteWall(doc, id)
    if ('error' in res) throw new Error(res.error)
    expect(res.message).toContain('measured lengths changed: A-2')
    expect(res.doc.measurements['A-2']).toBeUndefined()
    expect(res.doc.oldMeasurements?.some((o) => o.actualCm === 316)).toBe(true)
  })

  it('merges two rooms that share the wall', () => {
    const doc = convertToV2(plan([
      room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      room('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
    ])).doc
    const shared = wallNear(doc, [300, 0], [300, 400])
    const res = deleteWall(doc, shared)
    if ('error' in res) throw new Error(res.error)
    expect(res.doc.rooms).toHaveLength(1)
    expect(res.doc.walls!.some((w) => w.id === shared)).toBe(false)
  })

  it('removes a wall that no room uses, with its nodes', () => {
    const base = convertToV2(plan([room('A', TRAPEZOID)])).doc
    const standalone = removeRoom(base, 'A')
    expect(standalone.walls).toHaveLength(4)
    const id = standalone.walls![0].id
    const res = deleteWall(standalone, id)
    if ('error' in res) throw new Error(res.error)
    expect(res.doc.walls).toHaveLength(3)
  })

  it('does not change a v1 document', () => {
    expect(deleteWall(plan([room('A', TRAPEZOID)]), 'W1')).toHaveProperty('error')
  })

  it('the delete_wall command does the same on a v1 plan', () => {
    const out = apply(plan([room('A', TRAPEZOID)]), { type: 'delete_wall', wall: 'A-3' })
    expect(corners(out.doc, 'A')).toEqual([[0, 0], [400, 0], [200, 600]])
    expect(() => apply(plan([room('A', [[0, 0], [400, 0], [400, 300], [0, 300]])]), { type: 'delete_wall', wall: 'A-1' })).toThrow(/parallel/)
  })
})
