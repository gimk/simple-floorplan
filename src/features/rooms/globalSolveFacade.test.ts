// A facade value W*-E measured on site equal to its planned length (the outside row of the plan,
// facadePlannedLengths) must fit exactly: no residual, and the plan does not move. This holds
// also at an inside (concave) corner and at a T junction, where the row ends on the NEAR face.
import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import type { Measurement, PlanDoc } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { ensureV2 } from '../../model/v2/ensure'
import { demoRooms } from '../measure/demo'
import { solveGlobal } from './globalSolve'
import { facadePlannedLengths } from './outside/outsideDims'

function check(doc: PlanDoc) {
  const planned = facadePlannedLengths(doc)
  expect(planned.size).toBeGreaterThan(0)
  const measurements: Record<string, Measurement> = {}
  for (const [label, cm] of planned) measurements[label] = { label, actualCm: cm, updatedAt: '' }
  const s = solveGlobal({ rooms: doc.rooms, measurements, nodes: doc.nodes, walls: doc.walls })
  const bad: string[] = []
  const rows = s.residuals.filter((r) => r.kind === 'outside')
  for (const r of rows) if (Math.abs(r.diffCm) >= 0.5) bad.push(`${r.label}: measured ${r.measuredCm.toFixed(2)}, solved ${r.solvedCm.toFixed(2)}`)
  let maxMove = 0
  for (const r of doc.rooms) {
    const moved = s.rooms[r.id]
    if (!moved) continue
    r.vertices.forEach((v, i) => { maxMove = Math.max(maxMove, Math.hypot(v.x - moved[i].x, v.y - moved[i].y)) })
  }
  return { rows, bad, maxMove, skipped: s.skipped, count: planned.size }
}

describe('solveGlobal: facade value equal to the planned length', () => {
  it('fits every W*-E of the demo plan exactly', () => {
    const d = ensureV2({ ...emptyDoc(), rooms: demoRooms() })
    const r = check(d)
    expect(r.skipped.filter((x) => x.label.endsWith('-E'))).toEqual([])
    expect(r.bad).toEqual([])
    expect(r.maxMove).toBeLessThan(0.5)
  })

  it('fits every W*-E of an L-shape plan exactly (inside corner)', () => {
    const d = convertToV2({
      ...emptyDoc(),
      rooms: [{
        id: 'A', code: 'A', name: 'A',
        vertices: [
          { id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 600, y: 0 }, { id: 'v2', x: 600, y: 400 },
          { id: 'v3', x: 300, y: 400 }, { id: 'v4', x: 300, y: 700 }, { id: 'v5', x: 0, y: 700 },
        ],
        holes: [], walls: {}, walkOrder: 1,
      }],
    }).doc
    const r = check(d)
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.bad).toEqual([])
    expect(r.maxMove).toBeLessThan(0.5)
  })
})
