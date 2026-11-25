// The "Room schedule" section of the sidebar (docs/measurements-plan.md section 6): the table,
// the total line, the outdoor marker and the empty state. Rendered on the server with props, so a
// typo in the markup breaks this test. The CSV text itself is tested in rows.test.ts.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { SchedulePanelView } from './SchedulePanel'

const rect = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'CU', name: 'Cuisine', holes: [], walls: {}, walkOrder: 0,
  vertices: [
    { id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 400, y: 300 }, { id: 'd', x: 0, y: 300 },
  ],
  ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'p1',
  title: 'Rue Exemple',
  rooms: [rect()],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  ...over,
})

describe('SchedulePanelView', () => {
  it('shows the empty state when there is no room', () => {
    const html = renderToString(<SchedulePanelView doc={doc({ rooms: [] })} />)
    expect(html).toContain('aria-label="Room schedule"')
    expect(html).toContain('No rooms yet')
    expect(html).not.toContain('Copy CSV')
  })

  it('lists the rooms with comma decimals and a total line', () => {
    const html = renderToString(
      <SchedulePanelView doc={doc({ rooms: [rect(), rect({ id: 'r2', code: 'SE', name: 'Séjour', walkOrder: 1 })] })} />,
    )
    expect(html).toContain('data-room-schedule-row="r1"')
    expect(html).toContain('data-room-schedule-row="r2"')
    expect(html).toContain('>CU<')
    expect(html).toContain('>Séjour<')
    // Two rooms of 11,31 m²: 22,62 on the total line, counting the 2 rooms.
    expect(html).toContain('data-room-schedule-total-area')
    expect(html).toContain('22,62')
    expect(html).toContain('(2)')
    expect(html).toContain('Copy CSV')
    expect(html).toContain('Download CSV')
  })

  it('follows the area decimals of the room tag', () => {
    const html = renderToString(<SchedulePanelView doc={doc()} areaDecimals={0} />)
    expect(html).toContain('>11<')
    expect(html).not.toContain('11,31')
  })

  it('marks an outdoor room and keeps it out of the total', () => {
    const html = renderToString(
      <SchedulePanelView
        doc={doc({ rooms: [rect(), rect({ id: 'r2', code: 'BA', name: 'Balcon', outdoor: true, walkOrder: 1 })] })}
      />,
    )
    expect(html).toContain('Balcon')
    expect(html).toContain('>out<')
    // One indoor room in the total, area 11,31 (not 22,62).
    expect(html).toContain('(1)')
    expect(html).toContain('11,31')
    expect(html).not.toContain('22,62')
  })

  it('marks the selected room and shows the survey progress', () => {
    const d = doc({
      rooms: [rect(), rect({ id: 'r2', code: 'SE', name: 'Séjour', walkOrder: 1 })],
      measurements: { 'CU-1': { label: 'CU-1', actualCm: 390, updatedAt: '2026-01-01T00:00:00.000Z' } },
    })
    const html = renderToString(<SchedulePanelView doc={d} selection={{ kind: 'room', roomId: 'r2' }} />)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('>1/4<')
    expect(html).toContain('>0/4<')
  })

  it('keeps both CSV buttons on one line, with equal widths', () => {
    const html = renderToString(<SchedulePanelView doc={doc()} />)
    const at = html.indexOf('data-schedule-buttons')
    expect(at).toBeGreaterThan(-1)
    const row = html.slice(at, html.indexOf('</div>', html.lastIndexOf('Download CSV')))
    // No wrap inside a label, and the two buttons share the row.
    expect(row.match(/whitespace-nowrap/g)).toHaveLength(2)
    expect(row.match(/flex-1/g)).toHaveLength(2)
    expect(row.match(/min-w-0/g)).toHaveLength(2)
    expect(html).toContain('Copy CSV')
    expect(html).toContain('Download CSV')
  })

  it('wraps a long room name onto 2 lines and keeps the full name in the title', () => {
    const parent = rect({ id: 'r1', code: 'R1', name: 'Room 1' })
    const store = rect({
      id: 's1', code: 'R2', name: 'Hall Closet', walkOrder: 3,
      storage: { parentRoomId: 'r1' },
      vertices: [
        { id: 's1a', x: 0, y: -60 }, { id: 's1b', x: 200, y: -60 },
        { id: 's1c', x: 200, y: -10 }, { id: 's1d', x: 0, y: -10 },
      ],
    })
    const html = renderToString(<SchedulePanelView doc={doc({ rooms: [parent, store] })} />)
    // The full name is in the tooltip of the name cell…
    expect(html).toContain('title="Hall Closet (Room 1)"')
    // …the cell shows it in full, and wraps onto 2 lines instead of a single-line cut.
    expect(html).toContain('Hall Closet (Room 1)')
    const at = html.indexOf('data-room-schedule-row="s1"')
    const row = html.slice(at, html.indexOf('</tr>', at))
    expect(row).toContain('line-clamp-2')
    expect(row).toContain('break-words')
    expect(row).not.toContain('truncate')
  })

  it('warns when a room has no ceiling height (no volume in the CSV)', () => {
    const html = renderToString(<SchedulePanelView doc={doc()} />)
    expect(html).toContain('without ceiling height')
  })

  it('shows a built-in storage as an indented sub-row, its area in the total', () => {
    const store = rect({
      id: 's1', code: 'ST', name: 'Storage', walkOrder: 3,
      storage: { parentRoomId: 'r1' },
      vertices: [
        { id: 's1a', x: 0, y: -60 }, { id: 's1b', x: 200, y: -60 },
        { id: 's1c', x: 200, y: -10 }, { id: 's1d', x: 0, y: -10 },
      ],
    })
    const html = renderToString(<SchedulePanelView doc={doc({ rooms: [rect(), store] })} />)
    expect(html).toContain('Storage (Cuisine)')
    expect(html).toContain('data-room-schedule-storage="yes"')
    // The storage row comes after its parent row, in the markup.
    expect(html.indexOf('data-room-schedule-row="r1"')).toBeLessThan(html.indexOf('data-room-schedule-row="s1"'))
    // Its area is in the total (11,31 + 0,76 = 12,07) but it is not a room of the count.
    expect(html).toContain('12,07')
    expect(html).toContain('(1)')
  })
})
