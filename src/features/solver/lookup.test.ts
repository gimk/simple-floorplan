import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import type { Measurement, PlanDoc, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { materializeRooms } from '../../model/v2/materialize'
import { solverOff, solverOn } from './engine'
import {
  hoverLabelForWall,
  isWallSolved,
  labelWallKey,
  solverChangeForLabel,
  solverChangeForWall,
  valueState,
  wallLabel,
} from './lookup'

const FIXED_NOW = '2026-11-25T12:00:00.000Z'

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: FIXED_NOW }]))

function makeRoomV2(values: Record<string, number> = {}): PlanDoc {
  const nodes: StoredNode[] = [
    { id: 'N1', x: 0, y: 0 },
    { id: 'N2', x: 400, y: 0 },
    { id: 'N3', x: 400, y: 300 },
    { id: 'N4', x: 0, y: 300 },
  ]
  const walls: StoredWall[] = [
    { id: 'W1', a: 'N1', b: 'N2', faces: [], type: 'exterior', thicknessCm: 20 },
    { id: 'W2', a: 'N2', b: 'N3', faces: [], type: 'partition', thicknessCm: 10 },
    { id: 'W3', a: 'N3', b: 'N4', faces: [], type: 'partition', thicknessCm: 10 },
    { id: 'W4', a: 'N4', b: 'N1', faces: [], type: 'exterior', thicknessCm: 20 },
  ]
  const cycle: RoomFace[] = [
    { wallId: 'W1', side: 'L', from: 0, to: 400, cornerId: 'v1' },
    { wallId: 'W2', side: 'L', from: 0, to: 300, cornerId: 'v2' },
    { wallId: 'W3', side: 'L', from: 0, to: 400, cornerId: 'v3' },
    { wallId: 'W4', side: 'L', from: 0, to: 300, cornerId: 'v4' },
  ]
  const base: PlanDoc = {
    ...emptyDoc(),
    schemaVersion: 2,
    nodes,
    walls,
    rooms: [{ id: 'R1', code: 'KI', name: 'Kitchen', vertices: [], cycle, holes: [], walls: {}, walkOrder: 1 }],
    measurements: meas(values),
  }
  return { ...base, rooms: materializeRooms(base) }
}

describe('solver lookup helpers', () => {
  it('returns undefined / false when solver is absent or Off', () => {
    const base = makeRoomV2({ 'KI-1': 405 })
    expect(solverChangeForWall(base, 'W2')).toBeUndefined()
    expect(solverChangeForLabel(base, 'KI-2')).toBeUndefined()
    expect(isWallSolved(base, 'W2')).toBe(false)
    expect(valueState(base, 'KI-1')).toBe('measured')
    expect(valueState(base, 'KI-2')).toBe('estimated')

    const off = solverOff(solverOn(base, { now: FIXED_NOW }).doc)
    expect(solverChangeForWall(off, 'W2')).toBeUndefined()
    expect(isWallSolved(off, 'W2')).toBe(false)
    expect(valueState(off, 'KI-2')).toBe('estimated')
  })

  it('maps room wall, thickness, centre, and outside labels to stored wall keys', () => {
    const doc = makeRoomV2()
    expect(labelWallKey(doc, 'KI-2')).toEqual({ wallId: 'W2', kind: 'position' })
    expect(labelWallKey(doc, 'KI-2-T')).toEqual({ wallId: 'W2', kind: 'thickness' })
    expect(labelWallKey(doc, 'W2-C')).toEqual({ wallId: 'W2', kind: 'position' })
    expect(labelWallKey(doc, 'W2-E')).toEqual({ wallId: 'W2', kind: 'position' })
    // Diagonals, ceiling heights, and unknown labels do not map to a single wall change.
    expect(labelWallKey(doc, 'KI-D')).toBeNull()
    expect(labelWallKey(doc, 'KI-H')).toBeNull()
    expect(labelWallKey(doc, 'NOPE-1')).toBeNull()
  })

  it('finds recorded position and thickness changes by wall id and by label', () => {
    const base = makeRoomV2({ 'KI-1': 405, 'KI-3': 405 })
    const { doc: solved } = solverOn(base, { now: FIXED_NOW })

    // W2 moved east when KI-1 / KI-3 widened.
    const w2Change = solverChangeForWall(solved, 'W2', 'position')
    expect(w2Change).toBeDefined()
    expect(w2Change!.wallId).toBe('W2')
    expect(isWallSolved(solved, 'W2')).toBe(true)
    expect(isWallSolved(solved, 'W2', 'thickness')).toBe(false)

    // Room wall label, centre label, and outside label all resolve to W2's position change.
    expect(solverChangeForLabel(solved, 'KI-2')).toEqual(w2Change)
    expect(solverChangeForLabel(solved, 'W2-C')).toEqual(w2Change)
    expect(solverChangeForLabel(solved, 'W2-E')).toEqual(w2Change)
    // Thickness label only matches thickness changes.
    expect(solverChangeForLabel(solved, 'KI-2-T')).toBeUndefined()

    // Add a synthetic thickness change on W2 to test thickness lookup.
    const withThick: PlanDoc = {
      ...solved,
      solver: {
        ...solved.solver!,
        changes: [
          ...solved.solver!.changes,
          { kind: 'thickness', wallId: 'W2', label: 'KI-2', fromCm: 10, toCm: 12 },
        ],
      },
    }
    expect(solverChangeForLabel(withThick, 'KI-2-T')).toEqual({
      kind: 'thickness', wallId: 'W2', label: 'KI-2', fromCm: 10, toCm: 12,
    })
    expect(valueState(withThick, 'KI-2-T')).toBe('solved')
  })

  it('reports valueState as measured, solved, or estimated', () => {
    const base = makeRoomV2({ 'KI-1': 405, 'KI-3': 405 })
    const { doc: solved } = solverOn(base, { now: FIXED_NOW })

    // KI-1 has a measurement -> measured.
    expect(valueState(solved, 'KI-1')).toBe('measured')
    // KI-2 has no measurement, and W2 moved -> solved.
    expect(valueState(solved, 'KI-2')).toBe('solved')
    // Explicit measuredCm overrides doc.measurements.
    expect(valueState(solved, 'KI-2', 290)).toBe('measured')
    expect(valueState(solved, 'KI-1', null)).toBe('estimated') // W1 did not move perpendicularly
    // Diagonal / height are never solved.
    expect(valueState(solved, 'KI-H')).toBe('estimated')
  })

  it('derives readable wall labels and plan hover labels', () => {
    const doc = makeRoomV2()
    expect(wallLabel(doc, 'W2')).toBe('KI-2')
    expect(wallLabel(doc, 'W99')).toBe('W99')
    expect(hoverLabelForWall(doc, 'W2')).toBe('W2-C')
  })
})
