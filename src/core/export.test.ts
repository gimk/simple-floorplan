// The legacy string SVG export draws a built-in storage like a room, with the light amber fill and
// hatch of the Edit Mode canvas, a small label and a legend entry (docs/storage-plan.md, step 4).
import { describe, expect, it } from 'vitest'
import { applyBatch } from './commands'
import { parsePlan } from './schema'
import { renderPlanSvg } from './export'

function base() {
  return parsePlan({
    projectId: 'p1',
    title: 'Apt',
    rooms: [],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
    pins: [],
  })
}

function plan(withStorage: boolean) {
  const commands: Record<string, unknown>[] = [
    { type: 'add_room', code: 'SE', name: 'Bedroom 1', rect: { x: 0, y: 0, w: 400, h: 300 }, walkOrder: 1 },
  ]
  if (withStorage) {
    commands.push({ type: 'add_storage', room: 'SE', wall: 'SE-4', offsetCm: 100, widthCm: 60, depthCm: 40, door: 'single' })
  }
  return applyBatch(base(), commands).doc
}

describe('renderPlanSvg and built-in storage', () => {
  it('fills and hatches the storage, and labels it with its area', () => {
    const { svg } = renderPlanSvg(plan(true), { date: '2026-11-24' })
    expect(svg).toContain('data-room-storage="true"')
    expect(svg).toContain('fill="#fffbeb"')
    expect(svg).toContain('url(#storage-hatch)')
    expect(svg).toContain('data-room-storage-label=')
    expect(svg).toContain('>Storage</tspan>')
  })

  it('adds the legend entry only when the plan has a storage', () => {
    expect(renderPlanSvg(plan(false), { date: '2026-11-24' }).svg).not.toContain('Built-in storage')
    expect(renderPlanSvg(plan(true), { date: '2026-11-24' }).svg).toContain('Built-in storage')
  })
})
