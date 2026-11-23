// No measured value may ever be lost: migration, room delete, wall split / removed, rename.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parsePlan } from '../../core/schema'
import { demoRooms } from '../measure/demo'
import { ensureStoredGraph } from '../../model/graphRule'
import { removeOld } from '../../model/oldMeasurements'
import { emptyDoc, useDoc } from '../../model/store'
import { allSurveyIds, thicknessIds } from '../../model/survey'
import type { Measurement, PlanDoc } from '../../model/types'
import { deleteRoom, insertVertex, removeVertex, setRoomCode } from './ops'
import { installMeasureRules, measureAgainText } from './measureRules'

const AT = '2026-11-01T10:00:00.000Z'

/** The demo apartment with a value on EVERY label: walls, thicknesses CODE-n-T, diagonals CODE-D, heights CODE-H. */
function measuredDemo(): PlanDoc {
  const base: PlanDoc = { ...emptyDoc(), projectId: 'p1', title: 'Demo apartment', rooms: demoRooms() }
  const labels = [...allSurveyIds(base), ...base.rooms.flatMap((r) => thicknessIds(base, r))].map((s) => s.label)
  // Every wall also gets a thickness value, even when the wall is owned by another room.
  for (const r of base.rooms) r.vertices.forEach((_, i) => labels.push(`${r.code}-${i + 1}-T`))
  const measurements: Record<string, Measurement> = {}
  ;[...new Set(labels)].forEach((label, i) => {
    measurements[label] = { label, actualCm: 100 + i + (i % 7) * 0.5, updatedAt: AT, ...(i % 3 === 0 ? { source: 'laser' as const } : {}) }
  })
  return { ...base, measurements }
}

/** Every value before must be in measurements (under any label) or in oldMeasurements. The test values are all different. */
const lostValues = (before: PlanDoc, after: PlanDoc) => {
  const kept = [...Object.values(after.measurements), ...(after.oldMeasurements ?? [])]
  return Object.values(before.measurements).filter((m) => !kept.some((k) => k.actualCm === m.actualCm))
}

beforeAll(() => installMeasureRules())
beforeEach(() => {
  useDoc.getState().replace(emptyDoc())
  useDoc.temporal.getState().clear()
})

describe('migration of an old document', () => {
  it('gives it nodes and walls; rooms, measurements and labels are identical', () => {
    const old = measuredDemo()
    expect(Object.keys(old.measurements).length).toBeGreaterThan(60)
    // An old document as JSON: no nodes, no walls, no oldMeasurements.
    const json = JSON.parse(JSON.stringify(old))
    const parsed = parsePlan(json)
    expect(parsed.walls).toBeUndefined()
    const before = JSON.stringify({ rooms: parsed.rooms, measurements: parsed.measurements, notes: parsed.roomNotes })
    const migrated = ensureStoredGraph(parsed)
    expect(migrated.walls!.length).toBeGreaterThan(20)
    expect(migrated.nodes!.length).toBeGreaterThan(20)
    expect(migrated.oldMeasurements).toBeUndefined()
    // Byte-identical, and the same references (nothing was rebuilt).
    expect(JSON.stringify({ rooms: migrated.rooms, measurements: migrated.measurements, notes: migrated.roomNotes })).toBe(before)
    expect(migrated.rooms).toEqual(old.rooms)
    expect(migrated.measurements).toEqual(old.measurements)
    expect(migrated.rooms).toBe(parsed.rooms)
    expect(migrated.measurements).toBe(parsed.measurements)
    // Running it again changes nothing.
    expect(ensureStoredGraph(migrated)).toBe(migrated)
  })

  it('the load path of the store (replace) migrates too', () => {
    const old = measuredDemo()
    useDoc.getState().replace(old)
    const d = useDoc.getState().doc
    expect(d.walls!.length).toBeGreaterThan(20)
    expect(d.rooms).toEqual(old.rooms)
    expect(d.measurements).toEqual(old.measurements)
  })

  it('the stored graph survives a JSON round trip through parsePlan', () => {
    const d = ensureStoredGraph(measuredDemo())
    const back = parsePlan(JSON.parse(JSON.stringify(d)))
    expect(back.walls).toEqual(d.walls)
    expect(back.nodes).toEqual(d.nodes)
  })

  it('a doc with empty walls gets them; a doc with no rooms stays as it is', () => {
    const d = { ...measuredDemo(), walls: [] }
    expect(ensureStoredGraph(d).walls!.length).toBeGreaterThan(20)
    const e = emptyDoc()
    expect(ensureStoredGraph(e)).toBe(e)
  })
})

describe('no measured value is lost', () => {
  const load = () => {
    useDoc.getState().replace(measuredDemo())
    useDoc.temporal.getState().clear()
    return useDoc.getState().doc
  }

  it('a local edit keeps the stored ids (stable) and adds no old value when nothing is dropped', () => {
    const d0 = load()
    useDoc.getState().update((d) => ({ ...d, title: 'x' }))
    expect(useDoc.getState().doc.walls).toBe(d0.walls)
    const se = d0.rooms.find((r) => r.code === 'SE')!
    useDoc.getState().update((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === se.id ? { ...r, name: 'Living' } : r)) }))
    expect(useDoc.getState().doc.walls).toBe(d0.walls)
    expect(useDoc.getState().doc.oldMeasurements).toBeUndefined()
  })

  it('deleting a room moves ALL its CODE-* values to oldMeasurements (room-deleted)', () => {
    const d0 = load()
    const room = d0.rooms.find((r) => r.code === 'CU')!
    const mine = Object.values(d0.measurements).filter((m) => m.label.startsWith('CU-'))
    expect(mine.length).toBeGreaterThanOrEqual(6) // 4 walls + D + H + thicknesses
    useDoc.getState().update((d) => deleteRoom(d, room.id))
    const d1 = useDoc.getState().doc
    expect(Object.keys(d1.measurements).some((l) => l.startsWith('CU-'))).toBe(false)
    const old = d1.oldMeasurements!
    expect(old).toHaveLength(mine.length)
    for (const m of mine) {
      const e = old.find((o) => o.label === m.label)!
      expect(e).toMatchObject({ actualCm: m.actualCm, updatedAt: m.updatedAt, roomCode: 'CU', reason: 'room-deleted' })
      expect(typeof e.droppedAt).toBe('string')
    }
    // The values of the other rooms are untouched.
    expect(d1.measurements['SE-1']).toBe(d0.measurements['SE-1'])
    expect(lostValues(d0, d1)).toEqual([])
    // The stored graph follows the rooms.
    expect(d1.walls).not.toBe(d0.walls)
    // Undo gives the room and its values back, and takes the old values away (one step).
    useDoc.temporal.getState().undo()
    const d2 = useDoc.getState().doc
    expect(d2.rooms).toHaveLength(d0.rooms.length)
    expect(d2.measurements['CU-1']).toEqual(d0.measurements['CU-1'])
    expect(d2.oldMeasurements ?? []).toHaveLength(0)
  })

  it('a corner added on a wall: the value of that wall goes to oldMeasurements (wall-split)', () => {
    const d0 = load()
    const se = d0.rooms.find((r) => r.code === 'SE')!
    const wall2 = se.vertices[1] // wall SE-2 starts here
    const next = insertVertex(d0, se.id, wall2.id, { x: se.vertices[1].x, y: (se.vertices[1].y + se.vertices[2].y) / 2 })!
    useDoc.getState().update(() => next.doc)
    const d1 = useDoc.getState().doc
    const e = d1.oldMeasurements!.find((o) => o.label === 'SE-2')
    expect(e).toMatchObject({ actualCm: d0.measurements['SE-2'].actualCm, roomCode: 'SE', reason: 'wall-split' })
    expect(lostValues(d0, d1)).toEqual([])
    expect(d1.walls!.length).toBeGreaterThanOrEqual(d0.walls!.length)
  })

  it('a corner removed: the values of the removed walls are kept (wall-removed)', () => {
    const d0 = load()
    const sd = d0.rooms.find((r) => r.code === 'SD')!
    useDoc.getState().update((d) => removeVertex(d, sd.id, sd.vertices[1].id))
    const d1 = useDoc.getState().doc
    expect(d1.oldMeasurements!.length).toBeGreaterThan(0)
    expect(d1.oldMeasurements!.every((o) => o.roomCode === 'SD')).toBe(true)
    expect(lostValues(d0, d1)).toEqual([])
  })

  it('a renamed room: its old values follow the new code', () => {
    const d0 = load()
    const cu = d0.rooms.find((r) => r.code === 'CU')!
    useDoc.getState().update((d) => deleteRoom(d, d.rooms.find((r) => r.code === 'SD')!.id))
    useDoc.getState().update((d) => insertVertex(d, cu.id, cu.vertices[0].id, { x: (cu.vertices[0].x + cu.vertices[1].x) / 2, y: cu.vertices[0].y })!.doc)
    expect(useDoc.getState().doc.oldMeasurements!.some((o) => o.roomCode === 'CU')).toBe(true)
    useDoc.getState().update((d) => setRoomCode(d, cu.id, 'KI'))
    const d = useDoc.getState().doc
    expect(d.oldMeasurements!.filter((o) => o.roomCode === 'CU')).toHaveLength(0)
    expect(d.oldMeasurements!.some((o) => o.roomCode === 'KI' && o.label.startsWith('KI-'))).toBe(true)
  })

  it('an old value is removed only by an explicit delete (one undo step)', () => {
    const d0 = load()
    useDoc.getState().update((d) => deleteRoom(d, d.rooms.find((r) => r.code === 'WC')!.id))
    useDoc.getState().update((d) => deleteRoom(d, d.rooms.find((r) => r.code === 'SB')!.id))
    const withOld = useDoc.getState().doc
    const n = withOld.oldMeasurements!.length
    expect(n).toBeGreaterThan(8)
    // Later edits never remove entries.
    useDoc.getState().update((d) => ({ ...d, title: 'again' }))
    expect(useDoc.getState().doc.oldMeasurements).toHaveLength(n)
    const one = withOld.oldMeasurements![0]
    useDoc.getState().update((d) => ({ ...d, oldMeasurements: removeOld(d.oldMeasurements, one) }))
    expect(useDoc.getState().doc.oldMeasurements).toHaveLength(n - 1)
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc.oldMeasurements).toHaveLength(n)
    expect(lostValues(d0, useDoc.getState().doc)).toEqual([])
  })

  it('a remote change (updateSilent remote) does not run the rules', () => {
    const d0 = load()
    useDoc.getState().updateSilent((d) => ({ ...d, rooms: d.rooms.filter((r) => r.code !== 'CU') }), { remote: true })
    const d1 = useDoc.getState().doc
    expect(d1.oldMeasurements).toBeUndefined()
    expect(d1.walls).toBe(d0.walls)
    // The load step heals the graph without touching values.
    expect(ensureStoredGraph(d1).measurements).toBe(d1.measurements)
  })

  it('the toast text says why and where the old value is', () => {
    expect(measureAgainText([{ label: 'SE-2', reason: 'wall-split' }])).toBe('Measure again: SE-2 (wall split). The old value is kept in the room card.')
    expect(measureAgainText([{ label: 'SE-2', reason: 'wall-split' }, { label: 'SE-3', reason: 'wall-removed' }]))
      .toBe('Measure again: SE-2 (wall split); SE-3 (wall removed). The old values are kept in the room card.')
  })
})
