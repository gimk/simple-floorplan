import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../model/schema'
import type { ProjectDoc } from '../model/types'
import { applyCommand, applyCommands, computeOpeningOnWall, isSelfIntersecting, summarizeProject, validateProject } from './index'
import type { AgentCommand } from './index'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Apply a command and expect success. */
function ok(doc: ProjectDoc, cmd: AgentCommand) {
  const r = applyCommand(doc, cmd)
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`)
  return r
}

/** Doc with a 400x300 room at (0,0) named "Room 1". */
function withRoom() {
  const doc = createDefaultProject()
  const r = ok(doc, { type: 'add_room_rect', xCm: 0, yCm: 0, widthCm: 400, heightCm: 300 })
  return { doc: r.doc, roomId: r.result.roomId as string, abId: doc.artboards[0].id }
}

describe('validateProject', () => {
  it('accepts a default project', () => {
    const r = validateProject(createDefaultProject())
    expect(r.ok).toBe(true)
    expect(r.doc).toBeDefined()
    expect(r.issues).toEqual([])
  })

  it('returns all schema issues, not only the first', () => {
    const r = validateProject({ schemaVersion: 2, id: '', title: 5, refImages: [], artboards: [] })
    expect(r.ok).toBe(false)
    expect(r.doc).toBeUndefined()
    expect(r.issues.length).toBeGreaterThanOrEqual(4)
    expect(r.issues.every((i) => i.severity === 'error')).toBe(true)
    expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['schemaVersion', 'id', 'title', 'artboards']))
  })

  it('formats nested schema paths', () => {
    const { doc } = withRoom()
    const bad = clone(doc) as unknown as { artboards: { rooms: { vertices: { x: unknown }[] }[] }[] }
    bad.artboards[0].rooms[0].vertices[1].x = 'a'
    const r = validateProject(bad)
    expect(r.ok).toBe(false)
    expect(r.issues[0].path).toBe('artboards[0].rooms[0].vertices[1].x')
  })

  it('does not throw on garbage', () => {
    expect(validateProject(null).ok).toBe(false)
    expect(validateProject('x').ok).toBe(false)
    expect(validateProject(undefined).issues.length).toBeGreaterThan(0)
  })

  it('errors on a room with fewer than 3 vertices', () => {
    const doc = createDefaultProject()
    doc.artboards[0].rooms.push({ id: 'r', name: 'Bad', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    const r = validateProject(doc)
    expect(r.ok).toBe(false)
    expect(r.doc).toBeDefined()
    expect(r.issues.find((i) => i.code === 'room.too_few_vertices')?.severity).toBe('error')
  })

  it('warns on a zero-length wall edge', () => {
    const doc = createDefaultProject()
    doc.artboards[0].rooms.push({ id: 'r', name: 'Z', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0.01 }, { x: 100, y: 100 }, { x: 0, y: 100 }] })
    const r = validateProject(doc)
    expect(r.ok).toBe(true)
    expect(r.issues.find((i) => i.code === 'room.zero_length_wall')?.severity).toBe('warning')
  })

  it('errors on a self-intersecting (bow-tie) room', () => {
    const doc = createDefaultProject()
    doc.artboards[0].rooms.push({ id: 'r', name: 'Bow', vertices: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] })
    const r = validateProject(doc)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'room.self_intersecting')).toBe(true)
  })

  it('warns (but does not error) on a rectangle with a duplicate vertex mid-ring', () => {
    const doc = createDefaultProject()
    doc.artboards[0].rooms.push({
      id: 'r',
      name: 'Dup',
      vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
    })
    const r = validateProject(doc)
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.code === 'room.zero_length_wall')).toBe(true)
    expect(r.issues.find((i) => i.code === 'room.zero_length_wall')?.severity).toBe('warning')
    expect(r.issues.some((i) => i.code === 'room.self_intersecting')).toBe(false)
  })

  it('does not flag a simple L-shaped room', () => {
    const doc = createDefaultProject()
    doc.artboards[0].rooms.push({ id: 'r', name: 'L', vertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }] })
    expect(validateProject(doc).issues).toEqual([])
  })

  it('warns on an orphan opening roomId', () => {
    const { doc } = withRoom()
    doc.artboards[0].openings.push({ id: 'o', kind: 'door', roomId: 'ghost', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 85 })
    const r = validateProject(doc)
    expect(r.ok).toBe(true)
    expect(r.issues.find((i) => i.code === 'opening.orphan_room')?.severity).toBe('warning')
  })

  it('warns on an opening wider than its wall', () => {
    const doc = createDefaultProject()
    doc.artboards[0].rooms.push({ id: 'r', name: 'S', vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 300 }, { x: 0, y: 300 }] })
    doc.artboards[0].openings.push({ id: 'o', kind: 'window', roomId: 'r', xCm: 25, yCm: 0, angleDeg: 0, widthCm: 120 })
    const r = validateProject(doc)
    expect(r.issues.find((i) => i.code === 'opening.wider_than_wall')?.severity).toBe('warning')
  })

  it('warns on an opening far from any wall', () => {
    const { doc } = withRoom()
    doc.artboards[0].openings.push({ id: 'o', kind: 'door', xCm: 200, yCm: 150, angleDeg: 0, widthCm: 85 })
    const r = validateProject(doc)
    expect(r.ok).toBe(true)
    expect(r.issues.find((i) => i.code === 'opening.not_on_wall')?.severity).toBe('warning')
  })

  it('does not warn on an opening within 25 cm of a wall', () => {
    const { doc } = withRoom()
    doc.artboards[0].openings.push({ id: 'o', kind: 'door', xCm: 200, yCm: 20, angleDeg: 0, widthCm: 85 })
    expect(validateProject(doc).issues).toEqual([])
  })
})

describe('isSelfIntersecting', () => {
  it('is false for a simple rectangle', () => {
    expect(isSelfIntersecting([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])).toBe(false)
  })

  it('is false when a duplicate vertex sits mid-ring', () => {
    // Edge 1 is zero-length; edges 0 and 2 touch only at one shared vertex.
    expect(isSelfIntersecting([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])).toBe(false)
  })

  it('is false when the last vertex duplicates the first vertex', () => {
    // Wrap-around edge (last -> first) is zero-length.
    expect(isSelfIntersecting([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }, { x: 0, y: 0 }])).toBe(false)
  })

  it('is false for a collapsed triangle whose wrap-around pair is near-duplicate', () => {
    expect(isSelfIntersecting([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0.01 }])).toBe(false)
  })

  it('is true for a bow-tie, also when it has a duplicate vertex', () => {
    expect(isSelfIntersecting([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }])).toBe(true)
    expect(isSelfIntersecting([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }])).toBe(true)
  })

  it('is false below four vertices', () => {
    expect(isSelfIntersecting([])).toBe(false)
    expect(isSelfIntersecting([{ x: 0, y: 0 }])).toBe(false)
    expect(isSelfIntersecting([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false)
  })
})

describe('computeOpeningOnWall', () => {
  const room = { id: 'r', name: 'R', vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] }

  it('places the centre along a horizontal wall', () => {
    expect(computeOpeningOnWall(room, 0, 100, 80)).toEqual({ xCm: 100, yCm: 0, angleDeg: 0 })
  })

  it('places the centre along a vertical wall', () => {
    expect(computeOpeningOnWall(room, 1, 50, 80)).toEqual({ xCm: 400, yCm: 50, angleDeg: 90 })
  })

  it('uses the wall direction on the closing wall', () => {
    const r = computeOpeningOnWall(room, 2, 200, 80)
    expect(r.xCm).toBeCloseTo(200)
    expect(r.yCm).toBeCloseTo(300)
    expect(Math.abs(r.angleDeg)).toBeCloseTo(180)
  })

  it('clamps the offset so the opening stays on the wall', () => {
    expect(computeOpeningOnWall(room, 0, 0, 80).xCm).toBe(40)
    expect(computeOpeningOnWall(room, 0, 999, 80).xCm).toBe(360)
    expect(computeOpeningOnWall(room, 0, -5, 80).xCm).toBe(40)
  })

  it('centres an opening on a wall shorter than it', () => {
    expect(computeOpeningOnWall(room, 0, 10, 500).xCm).toBe(200)
  })

  it('works on a diagonal wall', () => {
    const tri = { id: 't', name: 'T', vertices: [{ x: 0, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 }] }
    const r = computeOpeningOnWall(tri, 0, 250, 50)
    expect(r.xCm).toBeCloseTo(150)
    expect(r.yCm).toBeCloseTo(200)
    expect(r.angleDeg).toBeCloseTo(53.1301, 3)
  })

  it('throws on a bad edge, a bad number and a zero-length wall', () => {
    expect(() => computeOpeningOnWall(room, 4, 10, 80)).toThrow(RangeError)
    expect(() => computeOpeningOnWall(room, -1, 10, 80)).toThrow(RangeError)
    expect(() => computeOpeningOnWall(room, 0, NaN, 80)).toThrow(RangeError)
    expect(() => computeOpeningOnWall(room, 0, 10, 0)).toThrow(RangeError)
    const z = { id: 'z', name: 'Z', vertices: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }] }
    expect(() => computeOpeningOnWall(z, 0, 1, 10)).toThrow(RangeError)
  })
})

describe('summarizeProject', () => {
  it('summarises an empty project', () => {
    const doc = createDefaultProject()
    const s = summarizeProject(doc)
    expect(s.schemaVersion).toBe(3)
    expect(s.id).toBe(doc.id)
    expect(s.title).toBe('Untitled project')
    expect(s.artboards).toHaveLength(1)
    expect(s.artboards[0]).toMatchObject({ name: 'Plan A', ceilingHeightCm: 250, wallThicknessCm: 10, precisionCm: 1, totalAreaM2: 0, rooms: [], openings: [], furniture: [] })
  })

  it('reports room geometry, walls, openings and furniture', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 100, kind: 'door' }).doc
    const d2 = ok(d1, { type: 'add_furniture', presetId: 'sofa', xCm: 200, yCm: 150 }).doc
    const d3 = ok(d2, { type: 'set_room_style', roomId, fill: '#8a6b4a', floorPattern: 'wood', wallColors: { 1: '#b85d43' } }).doc
    const s = summarizeProject(d3)
    const ab = s.artboards[0]
    expect(ab.totalAreaM2).toBeCloseTo(12)
    const room = ab.rooms[0]
    expect(room.areaM2).toBeCloseTo(12)
    expect(room.perimeterCm).toBeCloseTo(1400)
    expect(room.bounds).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300, widthCm: 400, heightCm: 300 })
    expect(room.fill).toBe('#8a6b4a')
    expect(room.floorPattern).toBe('wood')
    expect(room.walls).toHaveLength(4)
    expect(room.walls[0]).toMatchObject({ ref: `${roomId}#0`, edgeIndex: 0, start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, lengthCm: 400, angleDeg: 0, color: null })
    expect(room.walls[1].color).toBe('#b85d43')
    expect(room.walls[1].angleDeg).toBe(90)
    expect(room.walls[0].openingIds).toEqual([ab.openings[0].id])
    expect(room.walls[2].openingIds).toEqual([])
    expect(ab.openings[0]).toMatchObject({ kind: 'door', variant: 'standard', roomId, xCm: 100, yCm: 0, angleDeg: 0, widthCm: 85, hinge: 'left', swing: 'in', heightCm: null, sillCm: null })
    expect(ab.furniture[0]).toMatchObject({ name: 'Sofa', shape: 'rect', xCm: 200, yCm: 150, widthCm: 220, depthCm: 95, rotationDeg: 0, heightCm: 80, showDirection: true, cornerRadiusCm: 0 })
    // The summary always holds the 4 effective radii. The sofa preset has no radius of its own, so
    // the canvas default (4 cm) applies to every corner.
    expect(ab.furniture[0].cornerRadiiCm).toEqual([4, 4, 4, 4])
    // A per-corner radius of the document shows up as is, top-left first.
    const perCorner = summarizeProject(
      ok(d3, { type: 'update_furniture', furnitureId: ab.furniture[0].id, patch: { cornerRadiiCm: [1, 2, 3, 4] } }).doc,
    )
    expect(perCorner.artboards[0].furniture[0].cornerRadiiCm).toEqual([1, 2, 3, 4])
  })

  it('is JSON-serializable and does not change the doc', () => {
    const { doc } = withRoom()
    const before = clone(doc)
    const s = summarizeProject(doc)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    expect(doc).toEqual(before)
  })
})

describe('applyCommand: purity and dry run', () => {
  it('never mutates the input doc', () => {
    const { doc, roomId } = withRoom()
    const before = clone(doc)
    ok(doc, { type: 'move_room', roomId, dxCm: 50 })
    ok(doc, { type: 'set_title', title: 'X' })
    ok(doc, { type: 'delete_rooms', roomIds: [roomId] })
    expect(doc).toEqual(before)
  })

  it('returns a doc that shares no objects with the input', () => {
    const { doc } = withRoom()
    const r = ok(doc, { type: 'set_title', title: 'X' })
    expect(r.doc.artboards[0].rooms[0]).not.toBe(doc.artboards[0].rooms[0])
    expect(r.doc.artboards[0].rooms[0].vertices[0]).not.toBe(doc.artboards[0].rooms[0].vertices[0])
  })

  it('dryRun returns the computed doc, flags it, and leaves the input alone', () => {
    const { doc } = withRoom()
    const before = clone(doc)
    const r = applyCommand(doc, { type: 'set_title', title: 'Dry' }, { dryRun: true })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.dryRun).toBe(true)
      expect(r.doc.title).toBe('Dry')
    }
    expect(doc).toEqual(before)
    const real = applyCommand(doc, { type: 'set_title', title: 'Real' })
    expect(real.ok && real.dryRun).toBe(false)
  })

  it('dryRun still reports failures', () => {
    const { doc } = withRoom()
    const r = applyCommand(doc, { type: 'rename_room', roomId: 'nope', name: 'x' }, { dryRun: true })
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown command type', () => {
    const r = applyCommand(createDefaultProject(), { type: 'explode' } as unknown as AgentCommand)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Unknown command type')
  })

  it('output doc always passes validateProject', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 1, offsetCm: 150, kind: 'window' })
    expect(validateProject(r.doc).ok).toBe(true)
  })
})

describe('applyCommand: title and artboards', () => {
  it('set_title', () => {
    expect(ok(createDefaultProject(), { type: 'set_title', title: 'My flat' }).doc.title).toBe('My flat')
  })

  it('add_artboard places it right of the others by default', () => {
    const doc = createDefaultProject()
    const r = ok(doc, { type: 'add_artboard' })
    expect(r.doc.artboards).toHaveLength(2)
    const added = r.doc.artboards[1]
    expect(added.id).toBe(r.result.artboardId)
    expect(added.name).toBe('Plan B')
    expect(added.xCm).toBeGreaterThan(600)
  })

  it('add_artboard honours explicit options', () => {
    const r = ok(createDefaultProject(), { type: 'add_artboard', name: 'Loft', xCm: 1000, yCm: 20, widthCm: 900, heightCm: 700, ceilingHeightCm: 300, wallThicknessCm: 15 })
    expect(r.doc.artboards[1]).toMatchObject({ name: 'Loft', xCm: 1000, yCm: 20, widthCm: 900, heightCm: 700, ceilingHeightCm: 300, wallThicknessCm: 15 })
  })

  it('add_artboard rejects bad values', () => {
    expect(applyCommand(createDefaultProject(), { type: 'add_artboard', wallThicknessCm: 80 }).ok).toBe(false)
    expect(applyCommand(createDefaultProject(), { type: 'add_artboard', ceilingHeightCm: -1 }).ok).toBe(false)
  })

  it('update_artboard patches fields and defaults to the first artboard', () => {
    const r = ok(createDefaultProject(), { type: 'update_artboard', patch: { name: 'Ground', ceilingHeightCm: 270, precisionCm: 0.5, wallThicknessCm: 0 } })
    expect(r.doc.artboards[0]).toMatchObject({ name: 'Ground', ceilingHeightCm: 270, precisionCm: 0.5, wallThicknessCm: 0 })
  })

  it('update_artboard rejects an invalid patch and an unknown artboard', () => {
    const doc = createDefaultProject()
    expect(applyCommand(doc, { type: 'update_artboard', patch: { precisionCm: 2 as unknown as 1 } }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'update_artboard', artboardId: 'nope', patch: { name: 'x' } }).ok).toBe(false)
  })

  it('duplicate_artboard copies content with new ids and re-points openings', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 100, kind: 'door' }).doc
    const d2 = ok(d1, { type: 'add_furniture', presetId: 'bed', xCm: 100, yCm: 100 }).doc
    const r = ok(d2, { type: 'duplicate_artboard', name: 'Copy' })
    expect(r.doc.artboards).toHaveLength(2)
    const [src, copy] = r.doc.artboards
    expect(copy.name).toBe('Copy')
    expect(copy.id).not.toBe(src.id)
    expect(copy.rooms[0].id).not.toBe(src.rooms[0].id)
    expect(copy.openings[0].roomId).toBe(copy.rooms[0].id)
    expect(copy.openings[0].id).not.toBe(src.openings[0].id)
    expect(copy.furniture[0].id).not.toBe(src.furniture[0].id)
    expect(copy.xCm).toBeGreaterThan(src.xCm)
  })

  it('duplicate_artboard default name', () => {
    expect(ok(createDefaultProject(), { type: 'duplicate_artboard' }).doc.artboards[1].name).toBe('Plan A (copy)')
  })

  it('delete_artboard removes one but refuses the last', () => {
    const doc = ok(createDefaultProject(), { type: 'add_artboard' }).doc
    const id = doc.artboards[0].id
    const r = ok(doc, { type: 'delete_artboard', artboardId: id })
    expect(r.doc.artboards).toHaveLength(1)
    expect(r.doc.artboards[0].id).not.toBe(id)
    const last = applyCommand(r.doc, { type: 'delete_artboard', artboardId: r.doc.artboards[0].id })
    expect(last.ok).toBe(false)
    if (!last.ok) expect(last.error).toContain('last artboard')
  })

  it('delete_artboard on an unknown id fails', () => {
    const doc = ok(createDefaultProject(), { type: 'add_artboard' }).doc
    expect(applyCommand(doc, { type: 'delete_artboard', artboardId: 'nope' }).ok).toBe(false)
  })

  it('explicit artboardId targets the right artboard', () => {
    const doc = ok(createDefaultProject(), { type: 'add_artboard' }).doc
    const second = doc.artboards[1].id
    const r = ok(doc, { type: 'add_room_rect', artboardId: second, xCm: 0, yCm: 0, widthCm: 200, heightCm: 200 })
    expect(r.doc.artboards[0].rooms).toHaveLength(0)
    expect(r.doc.artboards[1].rooms).toHaveLength(1)
  })
})

describe('applyCommand: rooms', () => {
  it('add_room_rect creates a clockwise rectangle with a default name', () => {
    const { doc } = withRoom()
    const room = doc.artboards[0].rooms[0]
    expect(room.name).toBe('Room 1')
    expect(room.vertices).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])
  })

  it('add_room_rect: name, fill, next default name', () => {
    const { doc } = withRoom()
    const r = ok(doc, { type: 'add_room_rect', name: 'Kitchen', xCm: 500, yCm: 0, widthCm: 200, heightCm: 200, fill: '#fff' })
    expect(r.doc.artboards[0].rooms[1]).toMatchObject({ name: 'Kitchen', fill: '#fff' })
    expect(ok(r.doc, { type: 'add_room_rect', xCm: 0, yCm: 400, widthCm: 100, heightCm: 100 }).doc.artboards[0].rooms[2].name).toBe('Room 2')
  })

  it('add_room_rect rejects bad sizes', () => {
    const doc = createDefaultProject()
    expect(applyCommand(doc, { type: 'add_room_rect', xCm: 0, yCm: 0, widthCm: 0, heightCm: 100 }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_room_rect', xCm: 0, yCm: 0, widthCm: 5, heightCm: 100 }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_room_rect', xCm: NaN, yCm: 0, widthCm: 100, heightCm: 100 }).ok).toBe(false)
  })

  it('add_room_polygon keeps clockwise order and reverses counter-clockwise input', () => {
    const doc = createDefaultProject()
    const cw = ok(doc, { type: 'add_room_polygon', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] })
    expect(cw.doc.artboards[0].rooms[0].vertices[1]).toEqual({ x: 100, y: 0 })
    const ccw = ok(doc, { type: 'add_room_polygon', vertices: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 0 }] })
    expect(ccw.doc.artboards[0].rooms[0].vertices).toEqual([{ x: 100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }])
  })

  it('add_room_polygon rejects too few points, no area, and a self-intersecting outline', () => {
    const doc = createDefaultProject()
    expect(applyCommand(doc, { type: 'add_room_polygon', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_room_polygon', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] }).ok).toBe(false)
    const bow = applyCommand(doc, { type: 'add_room_polygon', vertices: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 0 }, { x: 0, y: 100 }] })
    expect(bow.ok).toBe(false)
    if (!bow.ok) expect(bow.issues?.[0].code).toBe('room.self_intersecting')
  })

  it('rename_room', () => {
    const { doc, roomId } = withRoom()
    expect(ok(doc, { type: 'rename_room', roomId, name: 'Lounge' }).doc.artboards[0].rooms[0].name).toBe('Lounge')
    expect(applyCommand(doc, { type: 'rename_room', roomId: 'nope', name: 'x' }).ok).toBe(false)
  })

  it('move_room by delta moves the room and its openings', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 100, kind: 'door' }).doc
    const r = ok(d1, { type: 'move_room', roomId, dxCm: 50, dyCm: -20 })
    expect(r.doc.artboards[0].rooms[0].vertices[0]).toEqual({ x: 50, y: -20 })
    expect(r.doc.artboards[0].openings[0]).toMatchObject({ xCm: 150, yCm: -20 })
  })

  it('move_room to an absolute position uses the bounds corner', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'move_room', roomId, xCm: 1000, yCm: 500 })
    expect(r.doc.artboards[0].rooms[0].vertices[0]).toEqual({ x: 1000, y: 500 })
    expect(r.doc.artboards[0].rooms[0].vertices[2]).toEqual({ x: 1400, y: 800 })
    const onlyX = ok(doc, { type: 'move_room', roomId, xCm: -100 })
    expect(onlyX.doc.artboards[0].rooms[0].vertices[0]).toEqual({ x: -100, y: 0 })
  })

  it('move_room needs a target', () => {
    const { doc, roomId } = withRoom()
    expect(applyCommand(doc, { type: 'move_room', roomId }).ok).toBe(false)
  })

  it('set_wall_length resizes a rectangle and keeps it a rectangle', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'set_wall_length', roomId, edgeIndex: 0, lengthCm: 500 })
    expect(r.doc.artboards[0].rooms[0].vertices).toEqual([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }, { x: 0, y: 300 }])
  })

  it('set_wall_length keeps openings on the wall', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 200, kind: 'window' }).doc
    const r = ok(d1, { type: 'set_wall_length', roomId, edgeIndex: 0, lengthCm: 800 })
    expect(r.doc.artboards[0].openings[0].xCm).toBeCloseTo(400)
  })

  it('set_wall_length rejects bad input', () => {
    const { doc, roomId } = withRoom()
    expect(applyCommand(doc, { type: 'set_wall_length', roomId, edgeIndex: 0, lengthCm: 0 }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'set_wall_length', roomId, edgeIndex: 9, lengthCm: 100 }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'set_wall_length', roomId, edgeIndex: 0, lengthCm: NaN }).ok).toBe(false)
  })

  it('move_vertex', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'move_vertex', roomId, vertexIndex: 2, xCm: 450, yCm: 350 })
    expect(r.doc.artboards[0].rooms[0].vertices[2]).toEqual({ x: 450, y: 350 })
    expect(applyCommand(doc, { type: 'move_vertex', roomId, vertexIndex: 7, xCm: 0, yCm: 0 }).ok).toBe(false)
  })

  it('move_vertex that makes the room self-intersect is rejected', () => {
    const { doc, roomId } = withRoom()
    const r = applyCommand(doc, { type: 'move_vertex', roomId, vertexIndex: 1, xCm: 0, yCm: 300 })
    expect(r.ok).toBe(false)
  })

  it('insert_vertex adds a vertex after the edge start', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'insert_vertex', roomId, edgeIndex: 0, xCm: 200, yCm: -50 })
    const v = r.doc.artboards[0].rooms[0].vertices
    expect(v).toHaveLength(5)
    expect(v[1]).toEqual({ x: 200, y: -50 })
    expect(r.result.vertexIndex).toBe(1)
  })

  it('delete_vertex removes one, but never below 3', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'delete_vertex', roomId, vertexIndex: 3 })
    expect(r.doc.artboards[0].rooms[0].vertices).toHaveLength(3)
    const tri = applyCommand(r.doc, { type: 'delete_vertex', roomId, vertexIndex: 0 })
    expect(tri.ok).toBe(false)
  })

  it('delete_rooms removes rooms and the openings that lived on them', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 100, kind: 'door' }).doc
    const r = ok(d1, { type: 'delete_rooms', roomIds: [roomId] })
    expect(r.doc.artboards[0].rooms).toHaveLength(0)
    expect(r.doc.artboards[0].openings).toHaveLength(0)
  })

  it('delete_rooms fails on unknown or empty ids', () => {
    const { doc, roomId } = withRoom()
    expect(applyCommand(doc, { type: 'delete_rooms', roomIds: [roomId, 'nope'] }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'delete_rooms', roomIds: [] }).ok).toBe(false)
  })

  it('cutout_rooms removes a corner', () => {
    const { doc } = withRoom()
    const r = ok(doc, { type: 'cutout_rooms', cutter: [{ x: 200, y: 150 }, { x: 500, y: 150 }, { x: 500, y: 400 }, { x: 200, y: 400 }] })
    expect(r.result.changed).toBe(true)
    const rooms = r.doc.artboards[0].rooms
    expect(rooms).toHaveLength(1)
    expect(rooms[0].vertices).toHaveLength(6)
    const s = summarizeProject(r.doc)
    expect(s.artboards[0].rooms[0].areaM2).toBeCloseTo(12 - 200 * 150 / 10000)
  })

  it('cutout_rooms can split a room in two', () => {
    const { doc } = withRoom()
    const r = ok(doc, { type: 'cutout_rooms', cutter: [{ x: 180, y: -10 }, { x: 220, y: -10 }, { x: 220, y: 310 }, { x: 180, y: 310 }] })
    expect(r.doc.artboards[0].rooms).toHaveLength(2)
    expect(r.doc.artboards[0].rooms[1].name).toBe('Room 1 2')
  })

  it('cutout_rooms with a cutter that misses everything is a no-op', () => {
    const { doc } = withRoom()
    const r = ok(doc, { type: 'cutout_rooms', cutter: [{ x: 900, y: 900 }, { x: 950, y: 900 }, { x: 950, y: 950 }] })
    expect(r.result.changed).toBe(false)
    expect(r.doc.artboards[0].rooms[0].vertices).toHaveLength(4)
  })

  it('cutout_rooms rejects a cutter with fewer than 3 points', () => {
    const { doc } = withRoom()
    expect(applyCommand(doc, { type: 'cutout_rooms', cutter: [{ x: 0, y: 0 }] }).ok).toBe(false)
  })

  it('merge_rooms unions touching rooms and keeps the first id', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'add_room_rect', xCm: 400, yCm: 0, widthCm: 200, heightCm: 300 })
    const second = d1.result.roomId as string
    const r = ok(d1.doc, { type: 'merge_rooms', roomIds: [roomId, second] })
    const rooms = r.doc.artboards[0].rooms
    expect(rooms).toHaveLength(1)
    expect(rooms[0].id).toBe(roomId)
    expect(summarizeProject(r.doc).artboards[0].rooms[0].areaM2).toBeCloseTo(18)
  })

  it('merge_rooms merges rooms that share a wall (wall thickness gap) and syncs openings', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'add_room_rect', xCm: 410, yCm: 0, widthCm: 200, heightCm: 300 })
    const second = d1.result.roomId as string
    const base = { kind: 'door' as const, widthCm: 90, heightCm: 210, angleDeg: 0 }
    const d2 = clone(d1.doc)
    d2.artboards[0].openings.push(
      { ...base, id: 'outer', roomId: second, xCm: 500, yCm: 0 },
      { ...base, id: 'inner', roomId, xCm: 400, yCm: 150, angleDeg: 90 },
    )
    const r = ok(d2, { type: 'merge_rooms', roomIds: [roomId, second] })
    const ab = r.doc.artboards[0]
    expect(ab.rooms).toHaveLength(1)
    expect(ab.rooms[0].vertices).toHaveLength(4)
    expect(summarizeProject(r.doc).artboards[0].rooms[0].areaM2).toBeCloseTo(18.3)
    expect(ab.openings.map((o) => o.id)).toEqual(['outer'])
    expect(ab.openings[0]).toMatchObject({ xCm: 500, yCm: 0, roomId })
  })

  it('merge_rooms fails for disjoint rooms, one id, and unknown ids', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'add_room_rect', xCm: 1000, yCm: 0, widthCm: 200, heightCm: 300 })
    const second = d1.result.roomId as string
    expect(applyCommand(d1.doc, { type: 'merge_rooms', roomIds: [roomId, second] }).ok).toBe(false)
    expect(applyCommand(d1.doc, { type: 'merge_rooms', roomIds: [roomId] }).ok).toBe(false)
    expect(applyCommand(d1.doc, { type: 'merge_rooms', roomIds: [roomId, 'nope'] }).ok).toBe(false)
  })

  it('set_room_style sets, then clears, fill, pattern and wall colours', () => {
    const { doc, roomId } = withRoom()
    const a = ok(doc, { type: 'set_room_style', roomId, fill: '#111111', floorPattern: 'tile', wallColors: { 0: '#aaaaaa', 2: '#bbbbbb' } }).doc.artboards[0].rooms[0]
    expect(a).toMatchObject({ fill: '#111111', floorPattern: 'tile', wallColors: { '0': '#aaaaaa', '2': '#bbbbbb' } })
    const d1 = ok(doc, { type: 'set_room_style', roomId, fill: '#111111', floorPattern: 'tile', wallColors: { 0: '#aaaaaa' } }).doc
    const b = ok(d1, { type: 'set_room_style', roomId, fill: null, floorPattern: null, wallColors: { 0: null } }).doc.artboards[0].rooms[0]
    expect(b.fill).toBeUndefined()
    expect(b.floorPattern).toBeUndefined()
    expect(b.wallColors).toBeUndefined()
    expect('fill' in b).toBe(false)
  })

  it("set_room_style: 'solid' clears the pattern; untouched fields stay", () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'set_room_style', roomId, fill: '#222222', floorPattern: 'wood' }).doc
    const r = ok(d1, { type: 'set_room_style', roomId, floorPattern: 'solid' }).doc.artboards[0].rooms[0]
    expect(r.floorPattern).toBeUndefined()
    expect(r.fill).toBe('#222222')
  })

  it('set_room_style rejects a bad pattern and a bad wall index', () => {
    const { doc, roomId } = withRoom()
    expect(applyCommand(doc, { type: 'set_room_style', roomId, floorPattern: 'lava' as unknown as 'wood' }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'set_room_style', roomId, wallColors: { 9: '#fff' } }).ok).toBe(false)
  })
})

describe('applyCommand: openings', () => {
  it('add_opening_on_wall places a door with defaults', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 100, kind: 'door' })
    expect(r.doc.artboards[0].openings[0]).toMatchObject({ kind: 'door', roomId, xCm: 100, yCm: 0, angleDeg: 0, widthCm: 85, hinge: 'left', swing: 'in' })
    expect(r.result.openingId).toBe(r.doc.artboards[0].openings[0].id)
  })

  it('add_opening_on_wall: window on a vertical wall with options', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 1, offsetCm: 150, kind: 'window', widthCm: 100, variant: 'sliding', heightCm: 120, sillCm: 90 })
    const o = r.doc.artboards[0].openings[0]
    expect(o).toMatchObject({ kind: 'window', xCm: 400, yCm: 150, angleDeg: 90, widthCm: 100, variant: 'sliding', heightCm: 120, sillCm: 90 })
    expect(o.hinge).toBeUndefined()
    expect(o.swing).toBeUndefined()
  })

  it('add_opening_on_wall: door hinge and swing', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 100, kind: 'door', hinge: 'right', swing: 'out', variant: 'french' })
    expect(r.doc.artboards[0].openings[0]).toMatchObject({ hinge: 'right', swing: 'out', variant: 'french' })
  })

  it('add_opening_on_wall clamps the offset to the wall', () => {
    const { doc, roomId } = withRoom()
    const r = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 9999, kind: 'door', widthCm: 100 })
    expect(r.doc.artboards[0].openings[0].xCm).toBe(350)
    expect(r.result.offsetCm).toBe(350)
  })

  it('add_opening_on_wall errors', () => {
    const { doc, roomId } = withRoom()
    expect(applyCommand(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 9, offsetCm: 10, kind: 'door' }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_opening_on_wall', roomId: 'nope', edgeIndex: 0, offsetCm: 10, kind: 'door' }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 10, kind: 'gate' as unknown as 'door' }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 10, kind: 'door', widthCm: 5 }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 10, kind: 'door', variant: 'nope' as unknown as 'standard' }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: Infinity, kind: 'door' }).ok).toBe(false)
  })

  it('update_opening patches fields and ignores id', () => {
    const { doc, roomId } = withRoom()
    const added = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 100, kind: 'door' })
    const openingId = added.result.openingId as string
    const r = ok(added.doc, { type: 'update_opening', openingId, patch: { widthCm: 90, swing: 'out', id: 'hacked' } as never })
    expect(r.doc.artboards[0].openings[0]).toMatchObject({ id: openingId, widthCm: 90, swing: 'out' })
    expect(applyCommand(added.doc, { type: 'update_opening', openingId, patch: { widthCm: -3 } }).ok).toBe(false)
    expect(applyCommand(added.doc, { type: 'update_opening', openingId: 'nope', patch: {} }).ok).toBe(false)
  })

  it('delete_opening', () => {
    const { doc, roomId } = withRoom()
    const added = ok(doc, { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 100, kind: 'door' })
    const openingId = added.result.openingId as string
    expect(ok(added.doc, { type: 'delete_opening', openingId }).doc.artboards[0].openings).toHaveLength(0)
    expect(applyCommand(added.doc, { type: 'delete_opening', openingId: 'nope' }).ok).toBe(false)
  })
})

describe('applyCommand: furniture', () => {
  it('add_furniture from a preset', () => {
    const r = ok(createDefaultProject(), { type: 'add_furniture', presetId: 'bed', xCm: 100, yCm: 120 })
    expect(r.doc.artboards[0].furniture[0]).toMatchObject({ name: 'Bed', shape: 'rect', xCm: 100, yCm: 120, widthCm: 160, depthCm: 200, rotationDeg: 0, heightCm: 50, showDirection: true })
  })

  it('add_furniture overrides preset values and works without a preset', () => {
    const r = ok(createDefaultProject(), { type: 'add_furniture', presetId: 'bed', name: 'Big bed', widthCm: 180, rotationDeg: 90, color: '#123456', xCm: 0, yCm: 0 })
    expect(r.doc.artboards[0].furniture[0]).toMatchObject({ name: 'Big bed', widthCm: 180, depthCm: 200, rotationDeg: 90, color: '#123456' })
    const plain = ok(createDefaultProject(), { type: 'add_furniture', xCm: 10, yCm: 10 }).doc.artboards[0].furniture[0]
    expect(plain).toMatchObject({ name: 'Furniture', shape: 'rect', widthCm: 100, depthCm: 100 })
    expect('heightCm' in plain).toBe(false)
  })

  it('add_furniture: circle with only a width gets an equal depth; cornerRadius is kept', () => {
    const f = ok(createDefaultProject(), { type: 'add_furniture', shape: 'circle', widthCm: 80, xCm: 0, yCm: 0 }).doc.artboards[0].furniture[0]
    expect(f).toMatchObject({ shape: 'circle', widthCm: 80, depthCm: 80 })
    const g = ok(createDefaultProject(), { type: 'add_furniture', xCm: 0, yCm: 0, cornerRadiusCm: 8 }).doc.artboards[0].furniture[0]
    expect(g.cornerRadiusCm).toBe(8)
  })

  it('add_furniture clamps sizes and puts a rug at the bottom of the stack', () => {
    const d1 = ok(createDefaultProject(), { type: 'add_furniture', xCm: 0, yCm: 0, widthCm: 5000, depthCm: 1 }).doc
    expect(d1.artboards[0].furniture[0]).toMatchObject({ widthCm: 1000, depthCm: 15 })
    const d2 = ok(d1, { type: 'add_furniture', presetId: 'rug', xCm: 0, yCm: 0 }).doc
    expect(d2.artboards[0].furniture[0].name).toBe('Rug')
  })

  it('add_furniture errors', () => {
    const doc = createDefaultProject()
    expect(applyCommand(doc, { type: 'add_furniture', presetId: 'nope', xCm: 0, yCm: 0 }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_furniture', xCm: NaN, yCm: 0 }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_furniture', xCm: 0, yCm: 0, widthCm: -5 }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'add_furniture', artboardId: 'nope', xCm: 0, yCm: 0 }).ok).toBe(false)
  })

  it('update_furniture patches fields and clamps sizes', () => {
    const added = ok(createDefaultProject(), { type: 'add_furniture', presetId: 'sofa', xCm: 0, yCm: 0 })
    const furnitureId = added.result.furnitureId as string
    const r = ok(added.doc, { type: 'update_furniture', furnitureId, patch: { xCm: 50, rotationDeg: 45, widthCm: 99999, showDirection: false } })
    expect(r.doc.artboards[0].furniture[0]).toMatchObject({ id: furnitureId, xCm: 50, rotationDeg: 45, widthCm: 1000, showDirection: false })
    expect(applyCommand(added.doc, { type: 'update_furniture', furnitureId, patch: { shape: 'triangle' as unknown as 'rect' } }).ok).toBe(false)
    expect(applyCommand(added.doc, { type: 'update_furniture', furnitureId: 'nope', patch: {} }).ok).toBe(false)
  })

  it('update_furniture writes the 4 corner radii, and collapses 4 equal radii to one', () => {
    const added = ok(createDefaultProject(), { type: 'add_furniture', xCm: 0, yCm: 0, widthCm: 100, depthCm: 60 })
    const furnitureId = added.result.furnitureId as string
    const item = (d: ProjectDoc) => d.artboards[0].furniture[0]

    // 4 different radii stay in cornerRadiiCm, in the order top-left, top-right, bottom-right, bottom-left.
    const perCorner = ok(added.doc, { type: 'update_furniture', furnitureId, patch: { cornerRadiiCm: [10, 0, 6, 12] } })
    expect(item(perCorner.doc).cornerRadiiCm).toEqual([10, 0, 6, 12])
    expect(item(perCorner.doc).cornerRadiusCm).toBeUndefined()

    // 4 equal radii collapse into the single field and drop the per-corner one.
    const equal = ok(perCorner.doc, { type: 'update_furniture', furnitureId, patch: { cornerRadiiCm: [8, 8, 8, 8] } })
    expect(item(equal.doc).cornerRadiusCm).toBe(8)
    expect('cornerRadiiCm' in item(equal.doc)).toBe(false)

    // A single radius clears the per-corner field: one radius for all 4 corners wins.
    const single = ok(perCorner.doc, { type: 'update_furniture', furnitureId, patch: { cornerRadiusCm: 5 } })
    expect(item(single.doc).cornerRadiusCm).toBe(5)
    expect('cornerRadiiCm' in item(single.doc)).toBe(false)

    // An explicit cornerRadiiCm: undefined clears it too.
    const cleared = ok(perCorner.doc, { type: 'update_furniture', furnitureId, patch: { cornerRadiiCm: undefined } })
    expect('cornerRadiiCm' in item(cleared.doc)).toBe(false)

    // Bad values are refused.
    expect(applyCommand(added.doc, { type: 'update_furniture', furnitureId, patch: { cornerRadiiCm: [1, 2, 3] as unknown as [number, number, number, number] } }).ok).toBe(false)
    expect(applyCommand(added.doc, { type: 'update_furniture', furnitureId, patch: { cornerRadiiCm: [1, 2, 3, -4] } }).ok).toBe(false)
  })

  it('add_furniture takes 4 corner radii and collapses them when they are equal', () => {
    const perCorner = ok(createDefaultProject(), { type: 'add_furniture', xCm: 0, yCm: 0, cornerRadiiCm: [2, 4, 6, 8] }).doc.artboards[0].furniture[0]
    expect(perCorner.cornerRadiiCm).toEqual([2, 4, 6, 8])
    const equal = ok(createDefaultProject(), { type: 'add_furniture', xCm: 0, yCm: 0, cornerRadiiCm: [6, 6, 6, 6] }).doc.artboards[0].furniture[0]
    expect(equal.cornerRadiusCm).toBe(6)
    expect('cornerRadiiCm' in equal).toBe(false)
    expect(applyCommand(createDefaultProject(), { type: 'add_furniture', xCm: 0, yCm: 0, cornerRadiiCm: [1, 2] as unknown as [number, number, number, number] }).ok).toBe(false)
  })

  it('reorder_furniture moves in the stack', () => {
    let doc = createDefaultProject()
    const ids: string[] = []
    for (const name of ['A', 'B', 'C']) {
      const r = ok(doc, { type: 'add_furniture', name, xCm: 0, yCm: 0 })
      doc = r.doc
      ids.push(r.result.furnitureId as string)
    }
    const names = (d: ProjectDoc) => d.artboards[0].furniture.map((f) => f.name).join('')
    expect(names(ok(doc, { type: 'reorder_furniture', furnitureId: ids[0], direction: 'front' }).doc)).toBe('BCA')
    expect(names(ok(doc, { type: 'reorder_furniture', furnitureId: ids[2], direction: 'back' }).doc)).toBe('CAB')
    expect(names(ok(doc, { type: 'reorder_furniture', furnitureId: ids[1], direction: 'forward' }).doc)).toBe('ACB')
    expect(names(ok(doc, { type: 'reorder_furniture', furnitureId: ids[1], direction: 'backward' }).doc)).toBe('BAC')
    const noop = ok(doc, { type: 'reorder_furniture', furnitureId: ids[2], direction: 'front' })
    expect(noop.result.moved).toBe(false)
    expect(names(noop.doc)).toBe('ABC')
    expect(applyCommand(doc, { type: 'reorder_furniture', furnitureId: 'nope', direction: 'front' }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'reorder_furniture', furnitureId: ids[0], direction: 'sideways' as unknown as 'front' }).ok).toBe(false)
  })

  it('duplicate_furniture offsets the copy by 20 cm and gives a new id', () => {
    const added = ok(createDefaultProject(), { type: 'add_furniture', presetId: 'desk', xCm: 100, yCm: 100 })
    const furnitureId = added.result.furnitureId as string
    const r = ok(added.doc, { type: 'duplicate_furniture', furnitureId })
    const [a, b] = r.doc.artboards[0].furniture
    expect(b.id).not.toBe(a.id)
    expect(b).toMatchObject({ name: 'Desk', xCm: 120, yCm: 120 })
    expect(applyCommand(added.doc, { type: 'duplicate_furniture', furnitureId: 'nope' }).ok).toBe(false)
  })

  it('duplicate_furniture puts the copy at index 1, directly above its source', () => {
    const d0 = ok(createDefaultProject(), { type: 'add_furniture', name: 'A', xCm: 0, yCm: 0 })
    const d1 = ok(d0.doc, { type: 'add_furniture', name: 'B', xCm: 200, yCm: 0 })
    const firstId = d1.doc.artboards[0].furniture[0].id
    const r = ok(d1.doc, { type: 'duplicate_furniture', furnitureId: firstId })
    const list = r.doc.artboards[0].furniture
    expect(list).toHaveLength(3)
    expect(list[0].id).toBe(firstId)
    expect(list[1].id).toBe(r.result.furnitureId)
    expect(list[2].name).toBe('B')
  })

  it('delete_furniture', () => {
    const added = ok(createDefaultProject(), { type: 'add_furniture', xCm: 0, yCm: 0 })
    const furnitureId = added.result.furnitureId as string
    expect(ok(added.doc, { type: 'delete_furniture', furnitureId }).doc.artboards[0].furniture).toHaveLength(0)
    expect(applyCommand(added.doc, { type: 'delete_furniture', furnitureId: 'nope' }).ok).toBe(false)
  })
})

describe('applyCommands (batch)', () => {
  it('applies commands in order and collects results', () => {
    const doc = createDefaultProject()
    const r = applyCommands(doc, [
      { type: 'set_title', title: 'Flat' },
      { type: 'add_room_rect', name: 'Hall', xCm: 0, yCm: 0, widthCm: 300, heightCm: 200 },
      { type: 'add_furniture', presetId: 'sofa', xCm: 100, yCm: 100 },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.title).toBe('Flat')
    expect(r.doc.artboards[0].rooms[0].name).toBe('Hall')
    expect(r.doc.artboards[0].furniture).toHaveLength(1)
    expect((r.result.results as unknown[]).length).toBe(3)
    expect(r.dryRun).toBe(false)
    expect(doc.title).toBe('Untitled project')
  })

  it('later commands can use ids from the doc built by earlier ones via artboardId', () => {
    const doc = createDefaultProject()
    const r = applyCommands(doc, [{ type: 'add_artboard', name: 'Two' }])
    expect(r.ok && r.doc.artboards).toHaveLength(2)
  })

  it('is atomic: a failure returns the error and no doc', () => {
    const doc = createDefaultProject()
    const before = clone(doc)
    const r = applyCommands(doc, [
      { type: 'set_title', title: 'Changed' },
      { type: 'rename_room', roomId: 'nope', name: 'x' },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('command 1')
    expect('doc' in r).toBe(false)
    expect(doc).toEqual(before)
  })

  it('dryRun is passed through', () => {
    const doc = createDefaultProject()
    const r = applyCommands(doc, [{ type: 'set_title', title: 'D' }], { dryRun: true })
    expect(r.ok && r.dryRun).toBe(true)
    expect(doc.title).toBe('Untitled project')
  })

  it('an empty batch succeeds with a copy of the doc', () => {
    const doc = createDefaultProject()
    const r = applyCommands(doc, [])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.doc).toEqual(doc)
      expect(r.doc).not.toBe(doc)
    }
  })

  it('rejects a non-array', () => {
    expect(applyCommands(createDefaultProject(), 'x' as unknown as AgentCommand[]).ok).toBe(false)
  })
})

describe("set_room_style: wallKinds (fence walls)", () => {
  it('marks edge as a fence and summarizeProject reports the kind', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'set_room_style', roomId, wallKinds: { 1: 'fence', 3: 'fence' } }).doc
    expect(d1.artboards[0].rooms[0].wallKinds).toEqual({ '1': 'fence', '3': 'fence' })
    const room = summarizeProject(d1).artboards[0].rooms[0]
    expect(room.walls.map((w) => w.kind)).toEqual(['wall', 'fence', 'wall', 'fence'])
    expect(room.walls[1]).toMatchObject({ edgeIndex: 1, kind: 'fence', lengthCm: 300 })
  })

  it("clears an edge with 'wall' or null and drops the empty map", () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'set_room_style', roomId, wallKinds: { 0: 'fence', 2: 'fence' } }).doc
    // 'wall' clears one edge and leaves the other one alone.
    const d2 = ok(d1, { type: 'set_room_style', roomId, wallKinds: { 0: 'wall' } }).doc
    expect(d2.artboards[0].rooms[0].wallKinds).toEqual({ '2': 'fence' })
    // null clears the last edge: the map itself is gone.
    const d3 = ok(d2, { type: 'set_room_style', roomId, wallKinds: { 2: null } }).doc
    expect(d3.artboards[0].rooms[0].wallKinds).toBeUndefined()
    expect('wallKinds' in d3.artboards[0].rooms[0]).toBe(false)
    expect(summarizeProject(d3).artboards[0].rooms[0].walls.every((w) => w.kind === 'wall')).toBe(true)
  })

  it('keeps the other style fields untouched', () => {
    const { doc, roomId } = withRoom()
    const d1 = ok(doc, { type: 'set_room_style', roomId, fill: '#123456', floorPattern: 'wood' }).doc
    const d2 = ok(d1, { type: 'set_room_style', roomId, wallKinds: { 0: 'fence' } }).doc
    expect(d2.artboards[0].rooms[0]).toMatchObject({ fill: '#123456', floorPattern: 'wood', wallKinds: { '0': 'fence' } })
    // No wallKinds in the command: the map is not created.
    const d3 = ok(doc, { type: 'set_room_style', roomId, fill: '#123456' }).doc
    expect(d3.artboards[0].rooms[0].wallKinds).toBeUndefined()
  })

  it('rejects an out-of-range edge index and an unknown kind', () => {
    const { doc, roomId } = withRoom()
    const out = applyCommand(doc, { type: 'set_room_style', roomId, wallKinds: { 9: 'fence' } })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('wallKinds')
    expect(applyCommand(doc, { type: 'set_room_style', roomId, wallKinds: { '-1': 'fence' } }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'set_room_style', roomId, wallKinds: { 0: 'parapet' as unknown as 'fence' } }).ok).toBe(false)
    // A rejected command leaves the doc alone.
    expect(doc.artboards[0].rooms[0].wallKinds).toBeUndefined()
  })
})
