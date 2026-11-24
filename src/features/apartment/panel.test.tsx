import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, Selection } from '../../model/types'
import { ApartmentCard } from './ApartmentPanel'

const rect = (code: string, w: number, h: number, over: Partial<Room> = {}): Room => ({
  id: `room_${code}`,
  code,
  name: code,
  walkOrder: 1,
  holes: [],
  walls: {},
  vertices: [
    { id: `${code}_0`, x: 0, y: 0 },
    { id: `${code}_1`, x: w, y: 0 },
    { id: `${code}_2`, x: w, y: h },
    { id: `${code}_3`, x: 0, y: h },
  ],
  ...over,
})

const baseDoc: PlanDoc = {
  projectId: 'p1',
  title: 'Apt',
  rooms: [rect('SE', 400, 300, { ceilingCm: 260 }), rect('CU', 200, 300), rect('BA', 400, 100, { outdoor: true })],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
  apartment: { defaultCeilingCm: 250 },
}

const render = (doc: PlanDoc = baseDoc, selection: Selection = null) =>
  renderToString(<ApartmentCard doc={doc} selection={selection} />)

describe('ApartmentCard', () => {
  it('shows the totals, the default ceiling and the reference hint', () => {
    const html = render()
    expect(html).toContain('Apartment')
    // Inside faces: SE 11.31 + CU 5.51 = 16.82 m² indoor; BA 3.51 m² outdoor.
    expect(html).toContain('16,82') // indoor floor area
    expect(html).toContain('3,51') // outdoor, reported separately
    expect(html).toContain('value="250"') // default ceiling input
    expect(html).toContain('Used for rooms without their own height.')
    expect(html).toContain('1 room(s) override it.')
    expect(html).toContain('No reference yet.')
    expect(html).toContain('Loi Carrez excludes surfaces under 1,80 m height')
    expect(html).toContain('aria-label="Default ceiling height in centimeters"')
  })

  it('shows the old values of deleted rooms and of removed walls in Edit Mode too', () => {
    // Decision (e): the values that left the plan are visible without entering Measuring Mode.
    const html = render({
      ...baseDoc,
      oldMeasurements: [
        { label: 'BA-2', actualCm: 305, updatedAt: '', roomCode: 'BA', reason: 'room-deleted', droppedAt: '2026-11-24T10:00:00.000Z' },
        { label: 'W12-C', actualCm: 424, updatedAt: '', roomCode: '', reason: 'wall-removed', droppedAt: '2026-11-24T10:00:00.000Z' },
      ],
      rooms: baseDoc.rooms.filter((r) => r.code !== 'BA'),
    })
    expect(html).toContain('Old values of deleted rooms (')
    expect(html).toContain('Old values of removed walls (')
    expect(html).toContain('W12-C')
  })

  it('names the level of a reference comparison in words, next to the colour', () => {
    // Colour alone says nothing to a colour-blind user (review finding 28).
    const html = render({
      ...baseDoc,
      apartment: { defaultCeilingCm: 250, references: [{ id: 'r1', source: 'carrez', surfaceM2: 16.82 }] },
    })
    expect(html).toContain('>OK<')
  })

  it('compares each reference with the plan and colours the difference', () => {
    const html = render({
      ...baseDoc,
      apartment: {
        defaultCeilingCm: 250,
        references: [
          { id: 'r1', source: 'carrez', surfaceM2: 16.82, label: 'Carrez 2023' },
          { id: 'r2', source: 'dpe', surfaceM2: 20 },
          { id: 'r3', source: 'boutin', surfaceM2: 12, roomCode: 'SE' },
        ],
      },
    })
    // react-dom/server separates interpolated text nodes with <!-- -->, so match fragments.
    expect(html).toContain('Loi Carrez')
    expect(html).toContain('Carrez 2023')
    expect(html).toContain('m² reported')
    expect(html).toContain('text-emerald-700') // 0 % (16.82 vs 16.82)
    expect(html).toContain('text-red-600') // (16.82 - 20) / 20 = -15.9 %
    expect(html).toContain('room SE')
    expect(html).toContain('−3,18 m² (−15,90 %)') // 16.82 - 20
    expect(html).toContain('aria-label="Delete reference Loi Carrez Carrez 2023"')
  })

  it('is hidden while something is selected', () => {
    expect(render(baseDoc, { kind: 'room', roomId: 'room_SE' })).toBe('')
    expect(render(baseDoc, null)).toContain('Apartment')
  })

  it('no longer owns the precision setting (it moved to the Solve tab)', () => {
    const html = render()
    expect(html).not.toContain('Precision (cm)')
    expect(html).not.toContain('aria-label="Precision of solved corners and thicknesses"')
    expect(html).not.toContain('Default 0,5 cm')
  })

  it('keeps the field names and the collapsible reference section', () => {
    const html = render()
    expect(html).toContain('aria-label="Reference surfaces"')
    expect(html).toContain('aria-expanded="true"') // open on the first visit
    expect(html).toContain('name="defaultCeilingCm"')
    expect(html).toContain('name="referenceSource"')
    expect(html).toContain('name="referenceSurface"')
    expect(html).toContain('name="referenceRoomCode"')
    expect(html).toContain('name="referenceLabel"')
    expect(html).toContain('name="referenceDate"')
    expect(html).toContain('name="referenceNote"')
    expect(html).toContain('aria-label="Reference source"')
    expect(html).toContain('aria-label="Reference surface in square meters"')
  })
})
