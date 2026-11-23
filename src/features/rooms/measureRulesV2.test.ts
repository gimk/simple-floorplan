// The measurement rules of a v2 document during a change of the outline (docs/walls-plan.md 5c):
// a drag moves the plan at every pointermove, so a false "Measure again" must not show, no value
// may leave the plan in the middle of a drag, and the end of the drag must give the right result.
// Review findings 7 (false toast, value lost mid-drag) and 9 (a stretched wall keeps its span).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { beginDrag, emptyDoc, endDrag, useDoc } from '../../model/store'
import type { Measurement, PlanDoc, Room } from '../../model/types'
import { moveNode } from '../../model/v2/drag'
import { ensureV2 } from '../../model/v2/ensure'
import { useToast } from '../toast'
import { insertVertex } from './ops'
import { installMeasureRules } from './measureRules'

const AT = '2026-11-24T10:00:00.000Z'

/** A room 400 x 300 cm with one value on each wall. */
const mk = (w: number): Room => ({
  id: 'R1',
  code: 'SE',
  name: 'Séjour',
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: w, y: 0 },
    { id: 'v2', x: w, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
  holes: [],
  walls: {},
  walkOrder: 1,
})

const values = (): Record<string, Measurement> => ({
  'SE-1': { label: 'SE-1', actualCm: 401, updatedAt: AT },
  'SE-2': { label: 'SE-2', actualCm: 302, updatedAt: AT },
  'SE-3': { label: 'SE-3', actualCm: 403, updatedAt: AT },
  'SE-4': { label: 'SE-4', actualCm: 304, updatedAt: AT },
})

/** The top right corner of the room (vertex v1): the node that a corner drag moves. */
const TOP_RIGHT = { x: 400, y: 0 }

const v1 = (w: number): PlanDoc => ({ ...emptyDoc(), projectId: 'p1', rooms: [mk(w)], measurements: values() })

/**
 * The corner drag of the app (model/v2/drag.ts): the node at `at` goes to (x, y). The walls keep
 * their ids and their faces follow, so only the spans of the walls at that node change.
 */
const moveCorner = (doc: PlanDoc, at: { x: number; y: number }, x: number, y: number): PlanDoc => {
  const node = (doc.nodes ?? []).find((n) => Math.abs(n.x - at.x) < 0.01 && Math.abs(n.y - at.y) < 0.01)
  return node ? moveNode(doc, node.id, { x, y }) : doc
}

/** Let the queued toasts (queueMicrotask) appear. */
const flush = () => new Promise((r) => setTimeout(r, 0))
const toasts = () => useToast.getState().toasts.map((t) => t.message)

beforeAll(() => installMeasureRules())
beforeEach(() => {
  useDoc.setState({ doc: emptyDoc() })
  useDoc.temporal.getState().clear()
  useToast.setState({ toasts: [] })
})

describe('a drag on a v2 document (review finding 7)', () => {
  it('a wall dragged small and back gives no "Measure again" toast and loses no value', async () => {
    const doc = ensureV2(v1(400), { now: AT })
    expect(doc.schemaVersion).toBe(2)
    expect(doc.measurements['SE-1'].target).toMatchObject({ from: 0, to: 400 })
    useDoc.getState().replace(doc)
    useDoc.temporal.getState().clear()

    const start = beginDrag()
    // The first wall is dragged to 150 cm: less than half of its measured 400 cm, so its value has
    // no label any more. A preview must keep it: it stays under its label.
    useDoc.getState().updateSilent(() => moveCorner(start, TOP_RIGHT, 150, 0))
    await flush()
    expect(toasts()).toEqual([])
    expect(useDoc.getState().doc.measurements['SE-1']?.actualCm).toBe(401)
    expect(useDoc.getState().doc.oldMeasurements).toBeUndefined()

    // The user drags back to 350 cm and lets go: nothing must have been dropped on the way.
    useDoc.getState().updateSilent(() => moveCorner(start, TOP_RIGHT, 350, 0))
    await flush()
    expect(toasts()).toEqual([])
    endDrag(start)
    await flush()
    expect(toasts()).toEqual([])
    expect(useDoc.getState().doc.measurements['SE-1']?.actualCm).toBe(401)
    expect(useDoc.getState().doc.oldMeasurements).toBeUndefined()
    // The value follows the face it was measured on (the new span of 350 cm).
    expect(useDoc.getState().doc.measurements['SE-1'].target).toMatchObject({ from: 0, to: 350 })
  })

  it('one undo gives the exact document before the drag', () => {
    const doc = ensureV2(v1(400), { now: AT })
    useDoc.getState().replace(doc)
    useDoc.temporal.getState().clear()
    const before = useDoc.getState().doc

    const start = beginDrag()
    useDoc.getState().updateSilent(() => moveCorner(start, TOP_RIGHT, 150, 0))
    useDoc.getState().updateSilent(() => moveCorner(start, TOP_RIGHT, 350, 0))
    endDrag(start)
    expect(useDoc.getState().doc).not.toBe(before)
    useDoc.temporal.getState().undo()
    // The exact document of before the drag (same object: nothing was rebuilt).
    expect(useDoc.getState().doc).toBe(before)
  })

  it('a wall really left small: the value goes to the old values, with one toast', async () => {
    const doc = ensureV2(v1(400), { now: AT })
    useDoc.getState().replace(doc)
    useDoc.temporal.getState().clear()

    const start = beginDrag()
    useDoc.getState().updateSilent(() => moveCorner(start, TOP_RIGHT, 150, 0))
    await flush()
    expect(toasts()).toEqual([])
    endDrag(start)
    await flush()
    // At the end of the drag the face of SE-1 is gone: the value is kept, and the user is told.
    expect(useDoc.getState().doc.measurements['SE-1']).toBeUndefined()
    expect(useDoc.getState().doc.oldMeasurements?.map((m) => `${m.label} (${m.reason})`)).toEqual(['SE-1 (wall-split)'])
    expect(toasts()).toEqual(['Measure again: SE-1 (wall split). The old value is kept in the room card.'])
    // One undo step for the whole drag.
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc).toBe(doc)
  })

  it('a finished edit still drops the value and says so', async () => {
    const doc = ensureV2(v1(400), { now: AT })
    useDoc.getState().replace(doc)
    useDoc.temporal.getState().clear()
    // Not a drag preview: an `update` is a finished edit.
    useDoc.getState().update(() => moveCorner(useDoc.getState().doc, TOP_RIGHT, 150, 0))
    await flush()
    expect(useDoc.getState().doc.measurements['SE-1']).toBeUndefined()
    expect(useDoc.getState().doc.oldMeasurements?.map((m) => m.label)).toEqual(['SE-1'])
    expect(toasts()).toEqual(['Measure again: SE-1 (wall split). The old value is kept in the room card.'])
  })
})

describe('a value without a target (review finding 1)', () => {
  it('does not stop the relabel of the other values of the document', async () => {
    const doc = ensureV2(v1(400), { now: AT })
    // A value that came from the server without its target (an old client).
    const { target: _gone, ...noTarget } = doc.measurements['SE-2']
    useDoc.getState().replace({ ...doc, measurements: { ...doc.measurements, 'SE-2': noTarget } })
    useDoc.temporal.getState().clear()

    // A corner is added in the middle of the first wall: wall 2 is wall 3 now, wall 3 is wall 4...
    useDoc.getState().update((d) => insertVertex(d, 'R1', 'v0', { x: 200, y: 0 })!.doc)
    await flush()
    const after = useDoc.getState().doc
    // The value of the old wall 2 followed its wall to its new label (and not the value of wall 3).
    expect(after.measurements['SE-3']?.actualCm).toBe(302)
    expect(after.measurements['SE-4']?.actualCm).toBe(403)
    // Nothing is lost.
    expect(after.measurements['SE-5']?.actualCm).toBe(304)
    for (const m of Object.values(after.measurements)) expect(m.target).toBeDefined()
  })
})

describe('a stretched wall (review finding 9)', () => {
  it('gives its values the new span after the edit', () => {
    const doc = ensureV2(v1(400), { now: AT })
    useDoc.getState().replace(doc)
    useDoc.temporal.getState().clear()
    useDoc.getState().update(() => moveCorner(useDoc.getState().doc, TOP_RIGHT, 700, 0))
    expect(useDoc.getState().doc.measurements['SE-1']?.actualCm).toBe(401)
    expect(useDoc.getState().doc.measurements['SE-1'].target).toMatchObject({ from: 0, to: 700 })
  })
})
