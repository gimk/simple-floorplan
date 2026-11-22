import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import { buildPlanSvg } from './svgExport'

describe('buildPlanSvg', () => {
  it('skips elements with missing or non-positive widthCm', () => {
    const doc = emptyDoc()
    doc.rooms.push({
      id: 'r1',
      code: 'SE',
      name: 'Living',
      walkOrder: 1,
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 400, y: 0 },
        { id: 'v3', x: 400, y: 300 },
        { id: 'v4', x: 0, y: 300 },
      ],
      holes: [],
      walls: {},
    })
    doc.elements.push(
      {
        id: 'e-zero',
        roomId: 'r1',
        wallStart: 'v1',
        kind: 'door',
        offsetCm: 50,
        widthCm: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'e-valid',
        roomId: 'r1',
        wallStart: 'v1',
        kind: 'window',
        offsetCm: 100,
        widthCm: 120,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    )
    const { svg } = buildPlanSvg(doc)
    expect(svg).not.toContain('NaN')
    expect(svg).toContain('matrix(1 0 0 1 100 0)')
    expect(svg).not.toContain('matrix(1 0 0 1 50 0)')
  })
})
