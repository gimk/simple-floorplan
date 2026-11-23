// Tests of the conversion report of a plan (docs/walls-plan.md 5c, step 4):
// the words of the toast and of the "Wall conversion" section, and the rendered section.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ConversionReport, PlanDoc, Room } from '../../model/types'
import { ApartmentCard } from './ApartmentPanel'
import {
  conversionCountsText,
  conversionEntryText,
  conversionNoticeText,
  conversionToShow,
  conversionToastText,
  mergedWallCount,
} from './conversion'
import { ConversionNotice, WallConversionSection } from './WallConversionSection'

const report: ConversionReport = {
  entries: [
    {
      wallId: 'W12',
      rooms: ['EN', 'CO'],
      linesApartCm: 1.5,
      thicknesses: [10, 12],
      types: ['partition', 'partition'],
      chosen: { type: 'partition', thicknessCm: 12 },
    },
    {
      wallId: 'W7',
      rooms: ['SE', 'CU'],
      linesApartCm: 0,
      thicknesses: [10],
      types: ['exterior', 'partition'],
      chosen: { type: 'partition', thicknessCm: 10 },
    },
  ],
  counts: { rooms: 3, walls: 8, sharedWalls: 4, droppedRoomWalls: 0 },
}

const conversion = { at: '2026-11-24T10:00:00.000Z', report }

const rect = (code: string, w: number, h: number): Room => ({
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
})

const docWith = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'p1',
  title: 'Apt',
  rooms: [rect('SE', 400, 300), rect('CO', 100, 300)],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
  ...over,
})

describe('conversion report text (walls-plan 5c step 4)', () => {
  it('counts the shared and adjusted walls and words the toast', () => {
    expect(mergedWallCount(report)).toBe(4)
    expect(conversionToastText(report)).toBe('Plan converted to walls: 4 shared walls, 2 adjusted.')
    expect(conversionToastText({ ...report, counts: { ...report.counts, sharedWalls: 1 } })).toBe(
      'Plan converted to walls: 1 shared wall, 2 adjusted.',
    )
  })

  it('writes one report line in words, with only what changed', () => {
    expect(conversionEntryText(report.entries[0])).toBe('EN | CO: lines 1,5 cm apart, thickness 10 / 12 cm -> 12 cm')
    // Same line, same thickness, other type: the type and its kept value.
    expect(conversionEntryText(report.entries[1])).toBe(
      'SE | CU: lines in line, thickness 10 cm, type exterior / partition -> partition',
    )
  })

  it('words the counts, with the room walls of zero length when there are some', () => {
    expect(conversionCountsText(report)).toBe('3 rooms, 8 walls, 4 shared.')
    expect(conversionCountsText({ ...report, counts: { ...report.counts, droppedRoomWalls: 2 } })).toBe(
      '3 rooms, 8 walls, 4 shared. 2 room walls of zero length left as they are.',
    )
    expect(conversionCountsText({ ...report, counts: { ...report.counts, droppedRoomWalls: 1 } })).toBe(
      '3 rooms, 8 walls, 4 shared. 1 room wall of zero length left as it is.',
    )
  })

  it('shows the notice once, until the report is seen', () => {
    expect(conversionNoticeText(undefined)).toBeNull()
    expect(conversionNoticeText(conversion)).toBe('Plan converted to walls: 4 shared walls, 2 adjusted.')
    expect(conversionNoticeText({ ...conversion, seen: true })).toBeNull()
    expect(conversionToShow(docWith())).toBeNull()
    expect(conversionToShow(docWith({ conversion }))).toEqual(conversion)
    expect(conversionToShow(docWith({ conversion: { ...conversion, seen: true } }))).toBeNull()
  })
})

describe('Wall conversion section (render)', () => {
  it('renders the report of the document, with the counts and the hide button', () => {
    const html = renderToString(<ApartmentCard doc={docWith({ conversion })} selection={null} />)
    expect(html).toContain('Wall conversion')
    expect(html).toContain('3 rooms, 8 walls, 4 shared.')
    expect(html).toContain('EN | CO: lines 1,5 cm apart, thickness 10 / 12 cm -&gt; 12 cm')
    expect(html).toContain('SE | CU: lines in line, thickness 10 cm')
    expect(html).toContain('Hide this report')
    // The card keeps the rest of its content.
    expect(html).toContain('Apartment')
  })

  it('renders no section when the document has no report, or when it is seen', () => {
    expect(renderToString(<ApartmentCard doc={docWith()} selection={null} />)).not.toContain('Wall conversion')
    expect(
      renderToString(<ApartmentCard doc={docWith({ conversion: { ...conversion, seen: true } })} selection={null} />),
    ).not.toContain('Wall conversion')
  })

  it('renders nothing on its own (the toast host shows the notice)', () => {
    expect(renderToString(<ConversionNotice />)).toBe('')
  })

  it('says so when no wall needed a change', () => {
    const html = renderToString(
      <WallConversionSection conversion={{ ...conversion, report: { ...report, entries: [] } }} />,
    )
    expect(html).toContain('No wall needed a change')
    expect(html).toContain('Hide this report')
  })
})
