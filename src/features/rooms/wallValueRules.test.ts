// Doc rules for the values of stored walls (docs/walls-plan.md phase 5b):
// a wall that keeps its id keeps its values, and a wall that is gone sends them to the old values.
// No measured value may ever be lost.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { syncStoredGraph } from '../../model/storedGraph'
import { emptyDoc, useDoc } from '../../model/store'
import type { Measurement, PlanDoc, Room } from '../../model/types'
import { wallSurveyIds } from '../../model/survey'
import { parseWallValueLabel } from '../../model/wallValues'
import { deleteRoom } from './ops'
import { installMeasureRules } from './measureRules'

const AT = '2026-11-01T10:00:00.000Z'

const room = (id: string, pts: [number, number][], thicknessOf: Record<number, number> = {}): Room => ({
  id, code: id, name: id, holes: [], walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  walls: Object.fromEntries(
    pts.map((_, i) => [`${id}v${i}`, { type: 'partition' as const, thicknessCm: thicknessOf[i] ?? 20 }]),
  ),
})

/** A = x 0..300, C = x 300..600, y 0..400. The wall between them is 10 cm. */
const rooms = (): Room[] => [
  room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], { 1: 10 }),
  room('C', [[300, 0], [600, 0], [600, 400], [300, 400]], { 3: 10 }),
]

/** The plan with its stored graph, and a value on every wall value label (centre and outside). */
function measuredPlan(): PlanDoc {
  const rs = rooms()
  const g = syncStoredGraph(undefined, rs)
  const base: PlanDoc = {
    ...emptyDoc(), projectId: 'walls', title: 'Walls', rooms: rs, nodes: g.nodes, walls: g.walls,
  }
  const measurements: Record<string, Measurement> = {}
  // All values are different, so a lost value is easy to see.
  wallSurveyIds(base).forEach((s, i) => {
    measurements[s.label] = { label: s.label, actualCm: 100 + i, updatedAt: AT }
  })
  return { ...base, measurements }
}

/** Values before that are in neither `measurements` (any label) nor `oldMeasurements`. */
const lostValues = (before: PlanDoc, after: PlanDoc) => {
  const kept = [...Object.values(after.measurements), ...(after.oldMeasurements ?? [])]
  return Object.values(before.measurements).filter((m) => !kept.some((k) => k.actualCm === m.actualCm))
}

beforeAll(() => installMeasureRules())
beforeEach(() => {
  useDoc.getState().replace(emptyDoc())
  useDoc.temporal.getState().clear()
})

describe('values of stored walls through the doc rules', () => {
  it('keeps the values of a wall that keeps its id when a vertex moves', () => {
    useDoc.getState().replace(measuredPlan())
    const before = useDoc.getState().doc
    useDoc.getState().update((d) => ({
      ...d,
      rooms: d.rooms.map((r) => (r.id === 'A' ? { ...r, vertices: r.vertices.map((v, i) => (i === 0 ? { ...v, y: v.y - 3 } : v)) } : r)),
    }))
    const after = useDoc.getState().doc
    const centre = wallSurveyIds(before).find((s) => s.kind === 'centre')!
    expect(after.measurements[centre.label]?.actualCm).toBe(before.measurements[centre.label].actualCm)
    expect(lostValues(before, after)).toEqual([])
  })

  it('moves the values of a removed wall to the old values, with no room code', () => {
    useDoc.getState().replace(measuredPlan())
    const before = useDoc.getState().doc
    // The wall values of the walls that C holds only.
    const onlyC = (before.walls ?? []).filter(
      (w) => w.faces.some((f) => f.roomId === 'C') && !w.faces.some((f) => f.roomId === 'A'),
    )
    expect(onlyC.length).toBeGreaterThan(0)
    const gone = onlyC.flatMap((w) => [`${w.id}-C`, `${w.id}-E`]).filter((l) => before.measurements[l])
    expect(gone.length).toBeGreaterThan(0)

    useDoc.getState().update((d) => deleteRoom(d, 'C'))
    const after = useDoc.getState().doc

    for (const label of gone) {
      expect(after.measurements[label]).toBeUndefined()
      const old = (after.oldMeasurements ?? []).filter((e) => e.label === label)
      expect(old).toHaveLength(1)
      expect(old[0].reason).toBe('wall-removed')
      expect(old[0].roomCode).toBe('')
      expect(old[0].actualCm).toBe(before.measurements[label].actualCm)
    }
    // No value is lost.
    expect(lostValues(before, after)).toEqual([])
  })

  it('keeps every wall value of the remaining plan', () => {
    useDoc.getState().replace(measuredPlan())
    const before = useDoc.getState().doc
    useDoc.getState().update((d) => deleteRoom(d, 'C'))
    const after = useDoc.getState().doc
    const kept = new Set((after.walls ?? []).map((w) => w.id))
    for (const [label, m] of Object.entries(before.measurements)) {
      const parsed = parseWallValueLabel(label)
      if (!parsed) continue
      if (kept.has(parsed.wallId)) expect(after.measurements[label]?.actualCm).toBe(m.actualCm)
    }
  })

  it('keeps a wall value when nothing changes in the outline', () => {
    useDoc.getState().replace(measuredPlan())
    const before = useDoc.getState().doc
    useDoc.getState().update((d) => ({ ...d, title: 'Same plan' }))
    const after = useDoc.getState().doc
    expect(after.measurements).toBe(before.measurements)
    expect(after.oldMeasurements).toBeUndefined()
  })
})
