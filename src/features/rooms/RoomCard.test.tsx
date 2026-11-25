// The Inspect room card with the solver On (docs/solver-plan.md, round 4): green measured values,
// purple solved values, grey estimated values, and the "average mismatch" line.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { syncStoredGraph } from '../../model/storedGraph'
import { emptyDoc } from '../../model/store'
import type { Measurement, PlanDoc, Room } from '../../model/types'
import { MEASURED_TEXT, SOLVED_TEXT } from '../../shell/panel/styles'
import { RoomCard } from './RoomCard'

const room = (id: string, pts: [number, number][]): Room => ({
  id, code: id, name: id, holes: [], walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  walls: Object.fromEntries(pts.map((_, i) => [`${id}v${i}`, { type: 'partition' as const, thicknessCm: 10 }])),
})

/** One room A, 400 x 300 cm; the stored walls of its four walls are W1..W4. */
const plan = (measurements: Record<string, Measurement> = {}): PlanDoc => {
  const rooms = [room('A', [[0, 0], [400, 0], [400, 300], [0, 300]])]
  const g = syncStoredGraph(undefined, rooms)
  return { ...emptyDoc(), projectId: 'r4', title: 'Purple', rooms, nodes: g.nodes, walls: g.walls, measurements }
}

/** Stored wall of the room wall that starts at `wallStart`. */
const wallIdOf = (doc: PlanDoc, wallStart: string) =>
  doc.walls!.find((w) => w.faces.some((f) => f.roomId === 'A' && f.wallStart === wallStart))!.id

const card = (doc: PlanDoc) =>
  renderToString(
    <RoomCard doc={doc} room={doc.rooms[0]} selection={{ kind: 'room', roomId: 'A' }} activeHole={null} />,
  )

describe('RoomCard: state of the wall values', () => {
  it('writes a measured value in green and an estimated value in grey when the solver is Off', () => {
    const doc = plan({ 'A-2': { label: 'A-2', actualCm: 296, updatedAt: '' } })
    const html = card(doc)
    expect(html).toContain(MEASURED_TEXT)
    expect(html).toContain('data-wall-value-state="measured"')
    expect(html).toContain('data-wall-value-state="estimated"')
    expect(html).not.toContain(SOLVED_TEXT)
  })

  it('writes the value of a wall the solver changed in purple', () => {
    const doc = plan()
    const solved: PlanDoc = {
      ...doc,
      solver: {
        enabled: true,
        changes: [{ kind: 'position', wallId: wallIdOf(doc, 'Av1'), label: 'A-2', moveCm: 1.5, dir: 'N' }],
        revoked: [],
        baseNodes: {},
        baseThickness: {},
      },
    }
    const html = card(solved)
    expect(html).toContain(SOLVED_TEXT)
    expect(html).toContain('data-wall-value-state="solved"')
    // The other walls of the room are still the plan, grey.
    expect(html).toContain('data-wall-value-state="estimated"')
  })

  it('keeps a measured value green even when the solver changed its wall', () => {
    const doc = plan({ 'A-2': { label: 'A-2', actualCm: 296, updatedAt: '' } })
    const solved: PlanDoc = {
      ...doc,
      solver: {
        enabled: true,
        changes: [{ kind: 'position', wallId: wallIdOf(doc, 'Av1'), label: 'A-2' }],
        revoked: [],
        baseNodes: {},
        baseThickness: {},
      },
    }
    const html = card(solved)
    expect(html).toContain(MEASURED_TEXT)
    expect(html).toContain('data-wall-value-state="measured"')
    expect(html).not.toContain(SOLVED_TEXT)
    expect(html).not.toContain('data-wall-value-state="solved"')
  })
})

describe('RoomCard: the fit line', () => {
  it('names the average mismatch, with the tip of the root mean square', () => {
    // One measured value, shorter than the plan: the rms of that one value, over one value.
    const html = card(plan({ 'A-2': { label: 'A-2', actualCm: 296, updatedAt: '' } }))
    // React puts `<!-- -->` between two text nodes: the comment goes, the sentence stays.
    const text = html.replace(/<!--.*?-->/g, '')
    expect(text).toContain('Average mismatch')
    expect(text).toMatch(/Average mismatch [\d,.]+ cm over 1 measured value\./)
    expect(text).not.toContain('Fit error')
    expect(html).toContain('title="How far the plan is from your measured values, on average (root mean square)."')
  })
})
