// The overlays drawn ABOVE the walls of the wall graph (docs/walls-plan.md "Walls in the
// interface", UI review F1, F2, F3, F26): the A / B markers and the "In line on" guide of a
// selected wall, and the wall number badges that follow the wall selection.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../canvas/Viewport'
import { emptyDoc, useDoc, useUi, type DimStyle, type Layers } from '../../model/store'
import type { Measurement, Mode, PlanDoc, Room, Selection, ToolId } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { useSidebar, type SidebarTab } from '../../shell/sidebar/store'
import { RoomsLayer } from './RoomsLayer'
import { RoomsOverlay } from './RoomsOverlay'
import { badgeSizePx, boxAt, boxHit, textBox } from './dims/dimBoxes'
import { ensureV2 } from '../../model/v2/ensure'
import { demoRooms } from '../measure/demo'
import { useDimEdit } from './dims/dimEdit'

const BASE_LAYERS: Layers = {
  background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true, clashes: true,
  roomCodes: 'auto', wallLabels: 'auto', outsideDims: true,
}

/** Put the stores in the state the canvas reads (the string renderer reads the initial state). */
const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [], walls: {}, walkOrder,
})

/** Square room A, 400 x 300 cm, turned into a v2 document: its walls W1..W4, 10 cm thick. */
const v2 = (): PlanDoc =>
  convertToV2({ ...emptyDoc(), rooms: [mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1)] }).doc

type Over = {
  tab?: SidebarTab
  selection?: Selection
  /** `align` given to every wall of the document ('In line on' of the wall card). */
  align?: 'room' | 'center' | 'other'
  walls?: Partial<Layers>
  /** Wall lengths: dimension lines (default) or the old text only. */
  dimStyle?: DimStyle
  /** Values measured on site, by survey label ('A-1'). */
  measurements?: Record<string, Measurement>
  /** Mode and tool of the app: Edit mode with the Select tool types a length on the plan. */
  mode?: Mode
  tool?: ToolId
}

/** Draw the two layers of the rooms, in the order of the app: under the walls, then above them. */
const setup = (over: Over = {}) => {
  const base = v2()
  const doc = {
    ...base,
    walls: over.align ? (base.walls ?? []).map((w) => ({ ...w, align: over.align })) : base.walls,
    measurements: { ...base.measurements, ...over.measurements },
  }
  applyState(useUi, {
    layers: { ...BASE_LAYERS, ...over.walls },
    mode: over.mode ?? 'edit',
    tool: over.tool ?? 'select',
    selection: over.selection ?? null,
    multi: [],
    dimStyle: over.dimStyle ?? 'lines',
    hoverLabel: null,
    hoverDiagonal: null,
    view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useSidebar, { tab: over.tab ?? 'inspect' })
  applyState(useDoc, { doc })
  return renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)
}

const wallId = (doc: PlanDoc, i = 0) => doc.walls![i].id

beforeEach(() => {
  applyState(useUi, {
    layers: BASE_LAYERS, mode: 'edit', tool: 'select', selection: null, multi: [],
    hoverLabel: null, hoverDiagonal: null, view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useSidebar, { tab: 'inspect' })
  applyState(useDoc, { doc: emptyDoc() })
})

describe('A and B markers of the selected wall', () => {
  it('marks the two sides of the wall, outside the band', () => {
    const id = wallId(v2())
    const html = setup({ selection: { kind: 'storedWall', wallId: id, side: 'L' } })
    // W1 runs from (0,0) to (400,0) and is 10 cm thick: the letters sit 17 cm (half of the band
    // plus 12 px at zoom 1) on each side of the wall, at 25 % (A) and 75 % (B) of its length, away
    // from the thickness box at the middle of the band (r1fix suggestion 5).
    expect(html).toContain('data-wall-side-marker="A"')
    expect(html).toContain('data-wall-side-marker="B"')
    expect(html).toContain('transform="translate(100 17)"')
    expect(html).toContain('transform="translate(300 -17)"')
    // The side the user clicked is the strong one.
    expect(html).toContain('data-wall-side-marker="A" data-wall-side-marker-active=""')
    expect(html).not.toContain('data-wall-side-marker="B" data-wall-side-marker-active=""')
  })

  it('makes side B the strong one when side B was clicked', () => {
    const id = wallId(v2())
    const html = setup({ selection: { kind: 'storedWall', wallId: id, side: 'R' } })
    expect(html).toContain('data-wall-side-marker="B" data-wall-side-marker-active=""')
    expect(html).not.toContain('data-wall-side-marker="A" data-wall-side-marker-active=""')
  })

  it('draws no marker when no stored wall is selected', () => {
    expect(setup()).not.toContain('data-wall-side-marker')
    expect(setup({ selection: { kind: 'room', roomId: 'A' } })).not.toContain('data-wall-side-marker')
  })
})

describe('the "In line on" guide of the selected wall', () => {
  it('draws the guide on side A by default (half a thickness on the L side)', () => {
    const id = wallId(v2())
    const html = setup({ selection: { kind: 'storedWall', wallId: id, side: 'L' } })
    expect(html).toContain(`data-wall-align-line="${id}"`)
    expect(html).toContain('data-align="room"')
    // W1 is horizontal at y = 0, 10 cm thick: side A is the line at y = 5.
    expect(html).toContain('x1="0" y1="5" x2="400" y2="5"')
  })

  it('draws the centre line for Centre, and the other side for Side B', () => {
    const id = wallId(v2())
    const centre = setup({ selection: { kind: 'storedWall', wallId: id, side: 'L' }, align: 'center' })
    expect(centre).toContain('data-align="center"')
    expect(centre).toContain('x1="0" y1="0" x2="400" y2="0"')
    const other = setup({ selection: { kind: 'storedWall', wallId: id, side: 'L' }, align: 'other' })
    expect(other).toContain('data-align="other"')
    expect(other).toContain('x1="0" y1="-5" x2="400" y2="-5"')
  })

  it('draws no guide without a selected stored wall', () => {
    expect(setup()).not.toContain('data-wall-align-line')
  })
})

describe('wall number badges follow the wall selection', () => {
  it('marks the badge of the face of the selected wall, strong on the clicked side', () => {
    const doc = v2()
    // The face of room A on wall W1, seen from side L (the room is above the wall).
    const face = doc.walls![0].faces.find((f) => f.roomId === 'A')!
    const side = face.side
    const html = setup({ tab: 'solve', walls: { wallLabels: 'on' }, selection: { kind: 'storedWall', wallId: wallId(doc), side } })
    expect(html).toContain('data-wall-number-state="strong"')
    // The wall numbers of the walls that the selection does not touch stay neutral.
    expect(html).toContain('data-wall-number-state="none"')
  })

  it('uses the weak colour on the side that was not clicked', () => {
    const doc = v2()
    const face = doc.walls![0].faces.find((f) => f.roomId === 'A')!
    const other = face.side === 'L' ? 'R' : 'L'
    const html = setup({ tab: 'solve', walls: { wallLabels: 'on' }, selection: { kind: 'storedWall', wallId: wallId(doc), side: other } })
    expect(html).toContain('data-wall-number-state="weak"')
  })

  it('hides the badge of a wall that is very short on screen', () => {
    // 400 cm at zoom 0.05 = 20 px, below the 32 px rule of a badge with a selection.
    const id = wallId(v2())
    applyState(useUi, {
      layers: { ...BASE_LAYERS, wallLabels: 'on' }, mode: 'edit', tool: 'select', multi: [],
      selection: { kind: 'storedWall', wallId: id, side: 'L' }, hoverLabel: null, hoverDiagonal: null,
      view: { x: 0, y: 0, zoom: 0.05 },
    })
    applyState(useSidebar, { tab: 'solve' })
    applyState(useDoc, { doc: v2() })
    const html = renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)
    expect(html).not.toContain('data-wall-number=')
  })
})

describe('room tag rows (View menu, docs/measurements-plan.md section 2)', () => {
  type Tag = {
    code: boolean; name: boolean; area: boolean; perimeter: boolean; ceiling: boolean; progress: boolean
    areaDecimals: 0 | 1 | 2
  }
  /** The defaults of the View menu: code, name and area, two decimals. */
  const TAG: Tag = { code: true, name: true, area: true, perimeter: false, ceiling: false, progress: false, areaDecimals: 2 }

  /** The v2 square room A (400 x 300 cm), with another name and extra fields. */
  const roomDoc = (over: Partial<Room> = {}, measurements: PlanDoc['measurements'] = {}): PlanDoc => {
    const d = v2()
    return { ...d, rooms: d.rooms.map((r) => ({ ...r, ...over })), measurements }
  }

  /** Draw the plan with the tag fields of this test. */
  const draw = (fields: Partial<Tag> = {}, over: {
    doc?: PlanDoc; zoom?: number; tab?: SidebarTab; roomCodes?: Layers['roomCodes']
  } = {}) => {
    applyState(useUi, {
      layers: { ...BASE_LAYERS, roomCodes: over.roomCodes ?? 'auto' },
      mode: 'edit',
      tool: 'select',
      selection: null,
      multi: [],
      hoverLabel: null,
      hoverDiagonal: null,
      view: { x: 0, y: 0, zoom: over.zoom ?? 1 },
      roomTag: { ...TAG, ...fields },
    })
    applyState(useSidebar, { tab: over.tab ?? 'inspect' })
    applyState(useDoc, { doc: over.doc ?? v2() })
    return renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)
  }

  it('writes the area only with the default fields, as the label does today', () => {
    const html = draw()
    expect(html).toContain('data-room-label="A"')
    // Inside faces of the 400 x 300 cm room with 10 cm walls: 11,31 m².
    expect(html).toContain('data-room-tag-row="0"')
    expect(html).toContain('11,31 m²')
    expect(html).not.toContain('data-room-tag-row="1"')
  })

  it('adds the perimeter, the ceiling height and the survey progress', () => {
    const html = draw(
      { perimeter: true, ceiling: true, progress: true },
      { doc: roomDoc({ ceilingCm: 250 }, { 'A-1': { label: 'A-1', actualCm: 400, updatedAt: '' } }) },
    )
    const rows = [...html.matchAll(/data-room-tag-row="\d+"[^>]*>([^<]*)</g)].map((m) => m[1])
    expect(rows).toEqual(['11,31 m²', 'P 13,60 m', 'H 2,50 m', '1/4 walls'])
  })

  it('writes the area with 0 decimals when the View menu asks for it', () => {
    expect(draw({ areaDecimals: 0 })).toContain('11 m²')
    expect(draw({ areaDecimals: 1 })).toContain('11,3 m²')
  })

  it('uses the name of the room, and the code in front of it in the Solve tab', () => {
    const html = draw({}, { doc: roomDoc({ name: 'Living' }), tab: 'solve' })
    expect(html).toContain('Living')
    expect(html).toContain('data-room-code-text="A"')
  })

  it('leaves out the code when the Code row is off', () => {
    const html = draw({ code: false }, { doc: roomDoc({ name: 'Living' }), tab: 'solve', roomCodes: 'on' })
    expect(html).not.toContain('data-room-code-text=')
    expect(html).toContain('Living')
    expect(html).toContain('data-room-tag-row="0"')
  })

  it('leaves out the name when the Name row is off', () => {
    const html = draw({ name: false }, { doc: roomDoc({ name: 'Living' }), tab: 'solve' })
    // The name is gone from the tag (the floor path keeps it, in its aria-label).
    expect(/data-room-label="A"([\s\S]*?)<\/text>/.exec(html)?.[1] ?? '').not.toContain('Living')
    expect(html).toContain('data-room-code-text="A"')
  })

  it('keeps the small-room rule: the code alone, no rows', () => {
    // Zoom 0.05: the room is 20 x 15 screen px, below the 50 px rule of the name.
    const html = draw({}, { roomCodes: 'on', zoom: 0.05 })
    expect(html).toContain('data-room-code-only="A"')
    expect(html).not.toContain('data-room-tag-row')
  })
})

describe('wall lengths as dimension lines (docs/measurements-plan.md section 1)', () => {
  it('draws the line along the inside face, with a 45 degree tick at each end', () => {
    const html = setup()
    // W1 of room A: the inside face runs from (5,5) to (395,5); the line sits 10 px (10 cm at
    // zoom 1) into the room, so from (5,15) to (395,15).
    expect(html).toContain('data-dim="wall" data-dim-key="A-1"')
    expect(html).toContain('x1="5" y1="15" x2="395" y2="15"')
    // A tick of 8 px at 45 degrees, centred on the end of the line.
    expect(html).toContain('x1="2.17157287525381" y1="12.17157287525381" x2="7.82842712474619" y2="17.82842712474619"')
    expect(html).toContain('x1="392.1715728752538" y1="12.17157287525381" x2="397.8284271247462" y2="17.82842712474619"')
  })

  it('writes the value above the line, on the room side, always up', () => {
    const html = setup()
    // Middle of the line, then 7 px away from the wall: (200, 15 + 7).
    expect(html).toContain('x="200" y="22"')
    expect(html).toContain('transform="rotate(0 200 22)"')
    // The inside face of the wall is 390 cm long (400 cm centre line, 10 cm walls).
    expect(html).toContain('>390</text>')
    expect(html).toContain('fill-slate-600 dark:fill-slate-300')
  })

  it('shows a measured face in green and bold, with the measured text', () => {
    const html = setup({ measurements: { 'A-1': { label: 'A-1', actualCm: 412, updatedAt: '' } } })
    expect(html).toContain('✓ 412 · 390')
    expect(html).toContain('fill-emerald-700 dark:fill-emerald-400')
  })

  it('draws the old text only with the "text" style', () => {
    const html = setup({ dimStyle: 'text' })
    expect(html).not.toContain('data-dim=')
    // The text element of today, at half a thickness plus 10 px inside the centre line.
    expect(html).toContain('x="200" y="15"')
    expect(html).toContain('>390</text>')
  })

  it('draws no dimension line for a wall that is very short on screen', () => {
    // 400 cm at zoom 0.1 = 40 px, below the 55 px rule.
    const html = setup({ dimStyle: 'lines' })
    expect(html).toContain('data-dim="wall"')
    applyState(useUi, { view: { x: 0, y: 0, zoom: 0.1 } })
    expect(renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)).not.toContain('data-dim=')
  })
})

describe('helper dimensions of the selected stored wall', () => {
  it('measures each face of each side, outside the band', () => {
    const doc = v2()
    const html = setup({ selection: { kind: 'storedWall', wallId: wallId(doc), side: 'L' } })
    // Side A (L) holds the face of room A; side B (R) of this wall is outside (a facade).
    expect(html).toContain('data-helper-dim="A-1" data-helper-side="A"')
    expect(html).toContain('data-helper-dim="out:R:0" data-helper-side="B"')
    // 5 cm of half thickness plus 22 px at zoom 1 on each side of the centre line.
    expect(html).toContain('x1="0" y1="27" x2="400" y2="27"')
    expect(html).toContain('x1="0" y1="-27" x2="400" y2="-27"')
  })

  it('writes the thickness in a box at the middle of the band', () => {
    const html = setup({ selection: { kind: 'storedWall', wallId: wallId(v2()), side: 'L' } })
    expect(html).toContain('data-helper-thickness="10"')
    expect(html).toContain('transform="translate(200 0)" data-helper-thickness="10"')
  })

  it('shows a measured face of the wall in green', () => {
    const html = setup({
      selection: { kind: 'storedWall', wallId: wallId(v2()), side: 'L' },
      measurements: { 'A-1': { label: 'A-1', actualCm: 390, updatedAt: '' } },
    })
    expect(html).toContain('✓ 390')
    expect(html).toContain('data-dim="helper" data-dim-key="A-1"')
  })

  it('draws no helper dimension without a selected stored wall', () => {
    expect(setup()).not.toContain('data-helper-dim')
    expect(setup({ selection: { kind: 'room', roomId: 'A' } })).not.toContain('data-helper-dim')
  })

  it('draws no helper dimension when the Dimensions layer is off', () => {
    const html = setup({ selection: { kind: 'storedWall', wallId: wallId(v2()), side: 'L' }, walls: { dimensions: false } })
    expect(html).not.toContain('data-helper-dim')
    expect(html).not.toContain('data-helper-thickness')
  })
})

describe('wall number badges and small rooms (r1fix R1-2, R1-8)', () => {
  type Tag = {
    code: boolean; name: boolean; area: boolean; perimeter: boolean; ceiling: boolean; progress: boolean
    areaDecimals: 0 | 1 | 2
  }
  const TAG: Tag = { code: true, name: true, area: true, perimeter: false, ceiling: false, progress: false, areaDecimals: 2 }

  /** Draw the plan of `doc` with the wall numbers on, and the tag fields of this test. */
  const draw = (over: {
    doc?: PlanDoc; selection?: Selection; walls?: Partial<Layers>; tab?: SidebarTab; roomTag?: Partial<Tag>
  } = {}) => {
    applyState(useUi, {
      layers: { ...BASE_LAYERS, wallLabels: 'on', ...over.walls },
      mode: 'edit',
      tool: 'select',
      selection: over.selection ?? null,
      multi: [],
      dimStyle: 'lines',
      hoverLabel: null,
      hoverDiagonal: null,
      view: { x: 0, y: 0, zoom: 1 },
      roomTag: { ...TAG, ...over.roomTag },
    })
    applyState(useSidebar, { tab: over.tab ?? 'solve' })
    applyState(useDoc, { doc: over.doc ?? v2() })
    return renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)
  }

  /** The place of a badge on the plan, cm. */
  const badgeAt = (html: string, number: string) => {
    const m = new RegExp(`transform="translate\\(([-\\d.]+) ([-\\d.]+)\\)" pointer-events="none" data-wall-number="${number}"`).exec(html)
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null
  }
  /** The place of the text of one wall dimension line, cm. */
  const dimTextAt = (html: string, key: string) => {
    const m = new RegExp(`data-dim-key="${key}"[\\s\\S]*?<text x="([-\\d.]+)" y="([-\\d.]+)"`).exec(html)
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null
  }

  it('puts the badge clear of the dimension text of the same wall', () => {
    const html = draw()
    const badge = badgeAt(html, '1')!
    const text = dimTextAt(html, 'A-1')!
    expect(badge).not.toBeNull()
    expect(text).not.toBeNull()
    // Same boxes as the drawing code: chars * 6,2 px wide and 11 px high for the text, the badge
    // padding for the number (round 1 finding R1-2: 19 badges sat on a text).
    const textB = textBox(text, 0, '390', 1)
    const badgeB = boxAt(badge, badgeSizePx('1').w, badgeSizePx('1').h)
    expect(boxHit(textB, badgeB)).toBe(false)
    // The badge sits near the start end of the wall, not on its middle.
    expect(badge.x).toBeLessThan(50)
  })

  it('hides the room dimension lines of the walls of the selected wall (they are duplicates)', () => {
    const doc = v2()
    const html = draw({ selection: { kind: 'storedWall', wallId: wallId(doc), side: 'L' } })
    // The helper dimensions of the selected wall show the same face lengths.
    expect(html).not.toContain('data-dim="wall" data-dim-key="A-1"')
    expect(html).toContain('data-dim="helper" data-dim-key="A-1"')
    // The other walls of the room keep their lines.
    expect(html).toContain('data-dim="wall" data-dim-key="A-2"')
  })

  it('keeps only the tag rows that fit in a small room, from the end', () => {
    // A room 200 x 70 cm: its inside box is 190 x 60 cm, too low for the title and four rows.
    const small = (): PlanDoc =>
      convertToV2({ ...emptyDoc(), rooms: [mk('A', [[0, 0], [200, 0], [200, 70], [0, 70]], 1)] }).doc
    const doc = small()
    const html = draw({
      doc: { ...doc, rooms: doc.rooms.map((r) => ({ ...r, ceilingCm: 250 })), measurements: { 'A-1': { label: 'A-1', actualCm: 190, updatedAt: '' } } },
      roomTag: { perimeter: true, ceiling: true, progress: true },
    })
    const rows = [...html.matchAll(/data-room-tag-row="\d+"[^>]*>([^<]*)</g)].map((m) => m[1])
    // Area and perimeter stay; the ceiling height and the progress are dropped first.
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('m²')
    expect(rows[1]).toMatch(/^P /)
    expect(html).not.toContain('1/4 walls')
  })

  it('moves a wall dimension text out of the room tag, past the end of its line (R1-8a)', () => {
    const small = (): PlanDoc =>
      convertToV2({ ...emptyDoc(), rooms: [mk('A', [[0, 0], [200, 0], [200, 70], [0, 70]], 1)] }).doc
    const html = draw({ doc: small() })
    // The inside face of wall A-1 ends at x = 195 cm: the text went past it to keep out of the tag.
    const text = dimTextAt(html, 'A-1')!
    expect(text.x).toBeGreaterThan(195)
    expect(html).toContain('data-dim-outside=""')
  })

  it('draws no wall number badge on a dimension text of the plan (demo apartment, R1-2)', () => {
    // The round 1 test measured 19 of 56 badges on a value text. Every box here comes from the
    // drawing itself: the badge size and the same text approximation as the code.
    for (const zoom of [1, 0.5]) {
      applyState(useUi, {
        layers: { ...BASE_LAYERS, wallLabels: 'on' },
        mode: 'edit',
        tool: 'select',
        selection: null,
        multi: [],
        dimStyle: 'lines',
        hoverLabel: null,
        hoverDiagonal: null,
        view: { x: 0, y: 0, zoom },
        roomTag: { ...TAG, perimeter: true, ceiling: true, progress: true },
      })
      applyState(useSidebar, { tab: 'solve' })
      applyState(useDoc, { doc: ensureV2({ ...emptyDoc(), rooms: demoRooms() }) })
      const html = renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)
      // The text of one dimension, read from its own group only.
      const dims = [...html.matchAll(/<g pointer-events="none" data-dim="wall" data-dim-key="([^"]+)">((?:(?!data-dim-key)[\s\S])*?)<\/g>/g)]
        .flatMap((m) => {
          const t = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*?(?:transform="rotate\(([-\d.]+))?[^>]*>([^<]*)</.exec(m[2])
          return t ? [{ p: { x: Number(t[1]), y: Number(t[2]) }, angle: Number(t[3] ?? 0), text: t[4] }] : []
        })
      const badges = [...html.matchAll(/transform="translate\(([-\d.]+) ([-\d.]+)\)" pointer-events="none" data-wall-number="([^"]+)"/g)]
        .map((m) => ({ p: { x: Number(m[1]), y: Number(m[2]) }, n: m[3] }))
      expect(dims.length).toBeGreaterThan(0)
      expect(badges.length).toBeGreaterThan(0)
      for (const b of badges) {
        const box = boxAt(b.p, badgeSizePx(b.n).w / zoom, badgeSizePx(b.n).h / zoom)
        for (const d of dims) expect(boxHit(box, textBox(d.p, d.angle, d.text, zoom))).toBe(false)
      }
    }
  })
})

describe('typing a length on a dimension text (docs/measurements-plan.md section 4)', () => {
  /** The markup of the group of one dimension line, e.g. the walls of key 'A-1'. */
  const groupOf = (html: string, key: string) => {
    const m = new RegExp(`data-dim-key="${key}">([\\s\\S]*?)</g>`).exec(html)
    return m ? m[1] : null
  }
  /** The markup of the text of one dimension line. */
  const textOf = (html: string, key: string) => {
    const group = groupOf(html, key)
    return group ? /<text[\s\S]*?<\/text>/.exec(group)?.[0] ?? null : null
  }

  it('makes the text of a wall dimension a target, and leaves the line and its ticks read only', () => {
    const html = setup()
    const text = textOf(html, 'A-1')!
    expect(text).toMatch(/pointer-events="auto"/)
    expect(text).toContain('data-dim-text="A-1"')
    // A single press on the text still selects or drags the room under it (no dead click).
    expect(text).toContain('cursor:text')
    // The group of the line stays read only: the line and the ticks never take a pointer event.
    expect(html).toContain('<g pointer-events="none" data-dim="wall" data-dim-key="A-1">')
    const line = /^<line[^>]*>/.exec(groupOf(html, 'A-1')!)![0]
    expect(line).not.toContain('pointer-events')
  })

  it('keeps the texts read only with another tool, and in Measuring Mode', () => {
    expect(setup({ tool: 'wall' })).not.toContain('data-dim-text=')
    expect(setup({ mode: 'measure' })).not.toContain('data-dim-text=')
    // The texts are still drawn, and the plan is unchanged otherwise.
    expect(setup({ tool: 'wall' })).toContain('data-dim="wall" data-dim-key="A-1"')
  })

  it('types the value of the face of the helper dimensions of the selected wall', () => {
    const doc = v2()
    const html = setup({ selection: { kind: 'storedWall', wallId: wallId(doc), side: 'L' } })
    expect(textOf(html, 'A-1')).toContain('data-dim-text="A-1"')
    // A facade span of the selected wall keeps writing the outside value of the wall, when there is one.
    expect(html).toContain('data-helper-dim="out:R:0"')
  })

  it('draws the field of the open text, with the value, the plan length and the unit', () => {
    applyState(useDimEdit, {
      edit: { label: 'A-1', at: { x: 200, y: 20 }, plannedCm: 390, roomCode: 'A', faces: 4 },
    })
    const html = setup({ measurements: { 'A-1': { label: 'A-1', actualCm: 412, updatedAt: '2026-01-01' } } })
    expect(html).toContain('data-dim-editor="A-1"')
    expect(html).toContain('aria-label="Measured A-1"')
    // The measured value of the face, and the length of the plan as the placeholder.
    expect(html).toContain('value="412"')
    expect(html).toContain('placeholder="390"')
    expect(html).toMatch(/inputMode="decimal"/i)
    expect(html).toContain('cm')
    // Centred on the text, 92 px wide at zoom 1 (about 90 px of field and its unit).
    expect(html).toContain('x="154"')
    applyState(useDimEdit, { edit: null })
  })

  it('draws no field when no dimension text is open', () => {
    expect(setup()).not.toContain('data-dim-editor=')
  })
})
