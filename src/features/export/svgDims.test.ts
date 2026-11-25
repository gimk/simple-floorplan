// Tests of the pure helpers of the exported measurements: the paper zoom, the text of a value, one
// dimension line, the room tag, and the extent of the outside rows.
import { describe, expect, it } from 'vitest'
import type { Room } from '../../model/types'
import { DIM_STYLE, worldPx } from '../rooms/dims/dimLine'
import { outsideDims, OUTSIDE_ROWS_PX, type OutsideDimRun } from '../rooms/outside/outsideDims'
import { ensureV2 } from '../../model/v2/ensure'
import { emptyDoc } from '../../model/store'
import {
  PAPER,
  faceText, paperZoom, roomTagLayout, segmentText, outsideExtentPoints, outsideRunSvg, dimSvg,
  planDimsLayout, roomWallDimEntries, roomWallDimsSvg,
} from './svgDims'
import { SOLVED_HEX } from '../../shell/panel/styles'
import { dimLine } from '../rooms/dims/dimLine'
import { boxHit } from '../rooms/dims/dimBoxes'
import type { DimStyle, RoomTagFields } from '../../model/store'

const room = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'SE', name: 'Living', walkOrder: 1, holes: [], walls: {}, ceilingCm: 250,
  vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 422, y: 0 }, { id: 'c', x: 422, y: 312 }, { id: 'd', x: 0, y: 312 }],
  ...over,
})

const TAG = { code: true, name: true, area: true, perimeter: true, ceiling: true, progress: true, areaDecimals: 2 } as const

describe('paperZoom', () => {
  it('makes the dimension text of the plan (px 11) the size of the export text (fs * 0.75)', () => {
    for (const fs of [8, 12.5, 30]) {
      const zoom = paperZoom(fs)
      expect(worldPx(DIM_STYLE.font, zoom)).toBeCloseTo(fs * 0.75, 6)
    }
  })

  it('gives a readable size to the other sizes of the style', () => {
    const zoom = paperZoom(10) // 1 cm = 1,47 px on the paper
    expect(worldPx(DIM_STYLE.tickLength, zoom)).toBeCloseTo(5.45, 2)
    expect(worldPx(DIM_STYLE.minLine, zoom)).toBeCloseTo(8.18, 2)
  })
})

describe('faceText', () => {
  const base = { solvedCm: 412, step: 0.5, units: { unit: 'cm' as const, decimals: 1 as const } }

  it('writes the calculated length in the units of the plan, with no ✓', () => {
    expect(faceText(base)).toEqual({ value: '412', label: undefined, measured: false, mismatch: false })
    expect(faceText({ ...base, units: { unit: 'm', decimals: 2 } }).value).toBe('4,12')
    expect(faceText({ ...base, units: { unit: 'mm', decimals: 0 } }).value).toBe('4120')
  })

  it('writes a measured length with ✓ when the plan fits it, and nothing else', () => {
    expect(faceText({ ...base, measuredCm: 412 })).toEqual({ value: '✓ 412', label: undefined, measured: true, mismatch: false })
    // The measured value is written as it was typed, with the ✓ of a value the plan fits.
    expect(faceText({ ...base, measuredCm: 412.4 }).value).toBe('✓ 412,4')
  })

  it('writes ONE value with ~ when the plan does not fit the measured one', () => {
    const text = faceText({ ...base, measuredCm: 414 })
    expect(text).toEqual({ value: '~414', label: undefined, measured: true, mismatch: true })
    // The solved length and the difference are never on the paper.
    expect(text.value).not.toContain('412')
    expect(faceText({ ...base, measuredCm: 414, units: { unit: 'm', decimals: 2 } }).value).toBe('~4,14')
  })

  it('keeps the survey label in front of the value', () => {
    expect(faceText({ ...base, label: 'SE-2' }).label).toBe('SE-2')
  })
})

describe('segmentText', () => {
  it('writes the measured value of a facade when the survey has one', () => {
    const seg = { a: { x: 0, y: 0 }, b: { x: 432, y: 0 }, lengthCm: 432, label: 'W1-E', measuredCm: 430 }
    // 430 against 432: 2 cm apart, over the step of the plan, so the value is amber with "~".
    expect(segmentText(seg, 0.5, { unit: 'cm', decimals: 1 })).toEqual({ value: '~430', measured: true, mismatch: true })
    // A measured value that fits its plan length: green with "✓".
    expect(segmentText({ ...seg, measuredCm: 432 }, 0.5, { unit: 'cm', decimals: 1 }))
      .toEqual({ value: '✓ 432', measured: true, mismatch: false })
    expect(segmentText({ ...seg, measuredCm: null }, 0.5, { unit: 'm', decimals: 2 })).toEqual({ value: '4,32', measured: false, mismatch: false })
  })
})

describe('dimSvg', () => {
  it('writes the line, the two ticks and the text with a white halo', () => {
    const zoom = paperZoom(10)
    const line = dimLine({ start: { x: 0, y: 0 }, end: { x: 412, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 6, zoom, text: 'SE-1 412' })!
    const svg = dimSvg({ line, text: { value: '412', label: 'SE-1', measured: false }, dimKey: 'SE-1', kind: 'wall', fs: 10, zoom })
    expect(svg).toContain('data-dim-line="wall"')
    expect(svg).toContain('data-dim-ticks="wall"')
    expect(svg).toContain('stroke="#475569"')
    expect(svg).toContain('stroke="#ffffff"')
    expect(svg).toContain('<tspan font-size="6.2" fill="#94a3b8" font-weight="400">SE-1</tspan> 412')
    expect(svg).toContain('data-dim="SE-1"')
    // The text fits between the ticks: no "outside" marker.
    expect(svg).not.toContain('data-dim-outside')
  })

  it('marks a text that went past the end of the line', () => {
    const zoom = paperZoom(10)
    const text = 'SE-1 ✓ 412 · 410,7'
    const line = dimLine({ start: { x: 0, y: 0 }, end: { x: 30, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 6, zoom, text })!
    expect(line.outside).toBe(true)
    const svg = dimSvg({ line, text: { value: '✓ 412 · 410,7', label: 'SE-1', measured: true }, dimKey: 'SE-1', kind: 'wall', fs: 10, zoom })
    expect(svg).toContain('data-dim-outside')
    expect(svg).toContain('fill="#15803d" font-weight="600"')
  })

  it('writes a measured value the plan does not fit in amber (the same token as the plan)', () => {
    const zoom = paperZoom(10)
    const line = dimLine({ start: { x: 0, y: 0 }, end: { x: 412, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 6, zoom, text: 'SE-1 ~414' })!
    const svg = dimSvg({
      line, text: { value: '~414', label: 'SE-1', measured: true, mismatch: true }, dimKey: 'SE-1', kind: 'wall', fs: 10, zoom,
    })
    expect(svg).toContain(`fill="${PAPER.mismatch}" font-weight="600"`)
    expect(svg).not.toContain(`fill="${PAPER.measured}"`)
    // The value is still ONE value: no solved length, no difference on the paper.
    expect(svg).toContain('~414')
    expect(svg).not.toContain('·')
  })
})

describe('roomTagLayout', () => {
  const ctx = { zoom: paperZoom(10), fs: 10, measurements: {}, defaultCeilingCm: undefined }

  it('writes the title and the rows the user chose', () => {
    const { svg } = roomTagLayout(room(), TAG, ctx)
    expect(svg).toContain('data-room-code-text="SE"')
    expect(svg).toContain('Living')
    expect(svg).toContain('12,44 m²') // 412 x 302 cm inside
    expect(svg).toContain('P 14,28 m')
    expect(svg).toContain('H 2,50 m')
    // No survey value in this document: the progress row is there, at 0 of 4 walls.
    expect(svg).toContain('0/4 walls')
  })

  it('uses the height of the apartment when the room has none', () => {
    const { svg } = roomTagLayout(room({ ceilingCm: undefined }), TAG, { ...ctx, defaultCeilingCm: 260 })
    expect(svg).toContain('H 2,60 m')
  })

  it('the box of the tag covers the rows it draws, so a wall value keeps off them (V-1)', () => {
    const { svg, box } = roomTagLayout(room(), TAG, ctx)
    expect(box).not.toBeNull()
    // The rows are drawn below the title, one step each: the box must hold them all.
    const ys = [...svg.matchAll(/<tspan[^>]*\sy="([-\d.]+)"/g)].map((m) => Number(m[1]))
    expect(ys.length).toBeGreaterThan(0)
    expect(Math.max(...ys)).toBeLessThan(box!.y1)
    expect(Math.min(...ys)).toBeGreaterThan(box!.y0)
    // The title line is inside the box too.
    const titleY = Number(/<text x="[-\d.]+" y="([-\d.]+)"/.exec(svg)![1])
    expect(titleY).toBeGreaterThan(box!.y0)
    expect(titleY).toBeLessThan(box!.y1)
  })

  it('shows the code alone in a very small room', () => {
    const tiny = room({ vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 20, y: 20 }, { id: 'd', x: 0, y: 20 }] })
    const { svg } = roomTagLayout(tiny, TAG, ctx)
    expect(svg).toContain('data-room-code-only="r1"')
    expect(svg).not.toContain('data-room-tag-row')
  })
})

describe('outsideExtentPoints', () => {
  it('reaches past the outside rows, so the viewBox has to grow', () => {
    const doc = ensureV2({ ...emptyDoc(), rooms: [room()] })
    const runs = outsideDims(doc)
    expect(runs.length).toBe(4)
    const zoom = paperZoom(10)
    const pts = outsideExtentPoints(runs, zoom)
    expect(pts.length).toBeGreaterThan(0)
    // The top run goes UP (y points down): its rows are above the plan.
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(-30)
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(422)
  })
})

// V-10: a short outside segment puts its text past the OUTER end of the run, one step (6 px) further
// from the row, so the text never crosses an extension line. Same rule as the plan's outside layer
// (features/rooms/outside/OutsideDimsLayer.tsx, `outsideEnd`); this is the export's copy of it.
describe('outsideRunSvg: the text of a short chain segment', () => {
  const zoom = paperZoom(10)
  // With the survey labels on: the text is longer ("W1-E 20"), which is the case of the review.
  const ctx = { zoom, fs: 10, step: 0.5, units: { unit: 'cm' as const, decimals: 1 as const }, surveyLabels: true }
  /** Screen px as cm on the paper. */
  const p = (n: number) => worldPx(n, zoom)

  /** A top run (normal UP, y points down), cut in two at `cutCm`: one short segment, then a long one. */
  const topRun = (cutCm: number): OutsideDimRun => {
    const a = { x: 0, y: 0 }, mid = { x: cutCm, y: 0 }, b = { x: cutCm + 600, y: 0 }
    return {
      key: 'W1:R',
      a,
      b,
      dir: { x: 1, y: 0 },
      normal: { x: 0, y: -1 },
      points: [a, mid, b],
      overallCm: cutCm + 600,
      segments: [
        { a, b: mid, lengthCm: cutCm, label: 'W1-E', measuredCm: null },
        { a: mid, b, lengthCm: 600, label: 'W1-E2', measuredCm: null },
      ],
    }
  }

  /** The `x` and `y` of the text of the segment with this label. */
  const textAt = (svg: string, key: string) => {
    const seg = new RegExp(`data-dim="${key}"[^>]*`).exec(svg)
    expect(seg).not.toBeNull()
    // The whole opening tag of the text element (the outside marker comes after `data-dim`).
    const tag = svg.slice(svg.lastIndexOf('<text', seg!.index), svg.indexOf('>', seg!.index))
    const xy = /<text x="([-\d.]+)" y="([-\d.]+)"/.exec(tag)!
    return { x: Number(xy[1]), y: Number(xy[2]), outside: tag.includes('data-dim-outside') }
  }

  it('goes past the start end of the run, clear of the extension line, 7 px off the row', () => {
    // 20 cm on the paper is shorter than its own text: the rule puts the text outside.
    const run = topRun(20)
    const svg = outsideRunSvg(run, ctx)
    const t = textAt(svg, 'W1-E')
    expect(t.outside).toBe(true)
    // Past the start end of the run (x = 0) and the start extension line: the text ENDS before the
    // corner, 2 px of gap (DIM_STYLE.outsideGap) at least.
    const half = p((`W1-E 20`.length * DIM_STYLE.charWidth) / 2)
    expect(t.x + half).toBeLessThanOrEqual(-p(DIM_STYLE.outsideGap) + 1e-9)
    expect(t.x).toBeLessThan(0)
    // 7 px off the chain row, the standard gap of a text that fits: a text that went outside keeps
    // the same distance from its row (UI test report docs/ui-test-report-storage.md, "Look").
    // 2 decimals: the SVG text keeps 2 decimals of a cm.
    expect(t.y).toBeCloseTo(-p(OUTSIDE_ROWS_PX.chain) - p(DIM_STYLE.textGap), 2)
    // The extension lines stay where they are: the text does not move them.
    expect(svg).toContain(`data-dim-ext="W1:R:0"`)
    // A segment that holds its text keeps it centred between the ticks, 7 px off the row.
    const second = textAt(svg, 'W1-E2')
    expect(second.outside).toBe(false)
    expect(second.y).toBeCloseTo(-p(OUTSIDE_ROWS_PX.chain) - p(DIM_STYLE.textGap), 2)
  })

  it('picks the end of the run like the plan: start for the first half, end for the second half', () => {
    // Four segments: the text of 0 and 1 goes past their start, the text of 2 and 3 past their end
    // (the outer end of the run), exactly as OutsideDimsLayer's `outsideEnd`.
    const xs = [0, 20, 40, 660, 680]
    const run: OutsideDimRun = {
      key: 'W2:R',
      a: { x: 0, y: 0 },
      b: { x: 680, y: 0 },
      dir: { x: 1, y: 0 },
      normal: { x: 0, y: -1 },
      points: xs.map((x) => ({ x, y: 0 })),
      overallCm: 680,
      segments: xs.slice(0, 4).map((x, i) => ({
        a: { x, y: 0 }, b: { x: xs[i + 1], y: 0 }, lengthCm: xs[i + 1] - x, label: `S${i}`, measuredCm: null,
      })),
    }
    const svg = outsideRunSvg(run, ctx)
    // Segment 0 (0 -> 20 cm) is short: its text goes before x = 0.
    expect(textAt(svg, 'S0').x).toBeLessThan(0)
    // Segment 1 (20 -> 40 cm) is short too: its text goes before x = 20 (its start).
    const s1 = textAt(svg, 'S1')
    expect(s1.outside).toBe(true)
    expect(s1.x).toBeLessThan(20)
    // Segment 3 (660 -> 680 cm) is short: its text goes after x = 680 (the outer end of the run).
    const s3 = textAt(svg, 'S3')
    expect(s3.outside).toBe(true)
    expect(s3.x).toBeGreaterThan(680)
    // Segment 2 (40 -> 660 cm) is long: its text stays between its ticks.
    expect(textAt(svg, 'S2').outside).toBe(false)
  })
})

// ---- the rules of the plan on the paper (visual review V-1, V-2, V-3, V-6, V-7) ----

/** A room from a rectangle of w x h cm on its centre line, first vertex at (0, 0). */
const rect = (id: string, code: string, name: string, w: number, h: number): Room => ({
  id, code, name, walkOrder: 1, holes: [], walls: {}, ceilingCm: 250,
  vertices: [
    { id: `${id}a`, x: 0, y: 0 },
    { id: `${id}b`, x: w, y: 0 },
    { id: `${id}c`, x: w, y: h },
    { id: `${id}d`, x: 0, y: h },
  ],
})

const ALL_ROWS: RoomTagFields = {
  code: true, name: true, area: true, perimeter: true, ceiling: true, progress: true, areaDecimals: 2,
}

/** The context of a room at a font size of `fs` cm on the paper. */
const dimCtx = (fs: number, over: Partial<Parameters<typeof roomWallDimEntries>[2]> = {}) => ({
  zoom: paperZoom(fs), fs, step: 0.5, units: { unit: 'cm' as const, decimals: 1 as const },
  surveyLabels: false, measurements: {}, thicknessOf: () => 10, ...over,
})

describe('roomWallDimEntries: the rules of the plan', () => {
  it('a face shorter than px(24) on the paper has no line and no value (V-1)', () => {
    const ctx = dimCtx(10) // 1 cm = 1,47 px on the paper, so px(24) is 16 cm
    // 20 x 12 cm on the centre line: the inside faces are 10 x 2 cm, under 16 cm.
    expect(roomWallDimEntries(rect('r1', 'WC', 'Wc', 20, 12), 'lines', ctx)).toEqual([])
    // 422 x 312 cm: every face is far over the minimum.
    expect(roomWallDimEntries(rect('r1', 'SE', 'Living', 422, 312), 'lines', ctx)).toHaveLength(4)
  })

  it('a value that does not fit between its ticks keeps its line and loses its text (V-1)', () => {
    // A narrow room: the inside faces of the short walls are 17 cm, 25 px at this size (over the
    // px(24) of the shortest line drawn). The measured value of the top wall is "~55" (its plan
    // length is 17, so it does not fit the plan), 19 px wide: it does not fit between the ticks of
    // that wall, so the face keeps its line and has no value any more (the plan does the same). The
    // plain value "17" of the other short wall fits.
    const narrow = rect('r1', 'SE', 'Living', 27, 300)
    const ctx = dimCtx(10, { measurements: { 'SE-1': { label: 'SE-1', actualCm: 55, updatedAt: '2026-01-01T00:00:00Z' } } })
    const entries = roomWallDimEntries(narrow, 'lines', ctx)
    const top = entries.find((e) => e.dimKey === 'SE-1')!
    expect(top.wallCm).toBeCloseTo(17, 6)
    expect(top.box).toBeNull()
    // The line stays, and it does not carry the text past its end.
    expect(top.line).not.toBeNull()
    expect(top.line!.outside).toBe(false)
    // The other faces are long enough, or their value fits: they keep their value.
    expect(entries.filter((e) => e.box)).toHaveLength(3)
    const svg = roomWallDimsSvg(entries, { fs: 10, zoom: paperZoom(10) })
    expect(svg.split('data-dim-line="wall"').length - 1).toBe(4)
    // One text element per value that is drawn: the top face has none.
    expect(svg.split('<text').length - 1).toBe(3)
    expect(svg).not.toContain('data-dim="SE-1"')
  })

  it('a room under px(60) in both directions has no wall dimension at all (V-2)', () => {
    const ctx = dimCtx(10) // px(60) is 41 cm on the paper
    // 45 x 35 cm on the centre line: the inside box is 35 x 25 cm, 51 x 37 px.
    expect(roomWallDimEntries(rect('r1', 'WC', 'Wc', 45, 35), 'lines', ctx)).toEqual([])
    // Long and thin keeps its dimensions: only one direction is small.
    expect(roomWallDimEntries(rect('r1', 'CO', 'Hall', 400, 55), 'lines', ctx).length).toBeGreaterThan(0)
  })
})

describe('planDimsLayout: one pass over the whole plan', () => {
  const layoutOf = (rooms: Room[], fs: number, style: DimStyle = 'lines', fields: RoomTagFields = ALL_ROWS) =>
    planDimsLayout({
      doc: { ...emptyDoc(), rooms },
      style, tagFields: fields, zoom: paperZoom(fs), fs, step: 0.5,
      units: { unit: 'cm', decimals: 1 }, surveyLabels: false, thicknessOf: () => 10, runs: [],
    })

  it('drops the values that hit a room tag, and keeps their lines and ticks (V-1)', () => {
    // A big tag (every row on) in a small room: the tag box covers the values of the walls.
    const layout = layoutOf([rect('r1', 'SE', 'Living', 300, 200)], 40)
    const room0 = layout.rooms[0]
    const tag = room0.tag.box
    expect(tag).not.toBeNull()
    const withLine = room0.entries.filter((e) => e.line)
    const drawn = room0.entries.filter((e) => e.box)
    expect(withLine).toHaveLength(4)
    // The tag is a blocker: some values go, and no value that stays touches it.
    expect(drawn.length).toBeLessThan(withLine.length)
    for (const e of drawn) expect(boxHit(e.box!, tag!)).toBe(false)
    // The lines and the ticks of the dropped values stay.
    const svg = roomWallDimsSvg(room0.entries, { fs: 40, zoom: paperZoom(40) })
    expect(svg.split('data-dim-line="wall"').length - 1).toBe(4)
    expect(svg.split('<text').length - 1).toBe(drawn.length)
  })

  it('never leaves two room wall values that overlap (V-1, V-7)', () => {
    // Two rooms side by side, both narrow: their parallel walls are close, so their values meet.
    const a = rect('r1', 'SE', 'Living', 200, 120)
    const b: Room = {
      ...rect('r2', 'CU', 'Kitchen', 200, 120),
      vertices: rect('r2', 'CU', 'Kitchen', 200, 120).vertices.map((v) => ({ ...v, y: v.y + 120 })),
    }
    const layout = layoutOf([a, b], 20)
    const drawn = layout.rooms.flatMap((x) => x.entries.filter((e) => e.box))
    expect(drawn.length).toBeGreaterThan(0)
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        expect(boxHit(drawn[i].box!, drawn[j].box!)).toBe(false)
      }
    }
    expect(layout.kept.size).toBe(drawn.length)
  })

  it('the outside row texts are blockers when the rows are drawn', () => {
    const doc = ensureV2({ ...emptyDoc(), rooms: [rect('r1', 'SE', 'Living', 422, 312)] })
    const runs = outsideDims(doc)
    const zoom = paperZoom(20)
    const layout = planDimsLayout({
      doc, style: 'lines', tagFields: { ...ALL_ROWS, progress: false }, zoom, fs: 20, step: 0.5,
      units: { unit: 'cm', decimals: 1 }, surveyLabels: false, thicknessOf: () => 10, runs,
    })
    const outside = layout.blockers.filter((b) => !layout.rooms.some((x) => x.tag.box === b))
    expect(outside.length).toBeGreaterThan(0)
    // Every value that is drawn keeps off every outside text box.
    for (const e of layout.rooms[0].entries.filter((x) => x.box)) {
      for (const b of outside) expect(boxHit(e.box!, b)).toBe(false)
    }
  })
})

// ---- the solver on the paper (docs/solver-plan.md, round 4) ----

describe('a value the solver changed: purple on the paper', () => {
  it('keeps the purple of the app in the colours of the paper', () => {
    expect(PAPER.solved).toBe(SOLVED_HEX)
    expect(PAPER.solved).toBe('#6d28d9')
  })

  it('writes a solved value in purple, and a measured one in green', () => {
    const zoom = paperZoom(10)
    const solvedLine = dimLine({
      start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 10, zoom, text: '412',
    })!
    const solved = dimSvg({
      line: solvedLine, text: { value: '412', measured: false, solved: true }, dimKey: 'SE-2', kind: 'wall', fs: 10, zoom,
    })
    expect(solved).toContain(`fill="${PAPER.solved}"`)
    expect(solved).not.toContain(`fill="${PAPER.measured}"`)
    const measured = dimSvg({
      line: solvedLine, text: { value: '412', measured: true }, dimKey: 'SE-2', kind: 'wall', fs: 10, zoom,
    })
    expect(measured).toContain(`fill="${PAPER.measured}"`)
    const estimated = dimSvg({
      line: solvedLine, text: { value: '412', measured: false }, dimKey: 'SE-2', kind: 'wall', fs: 10, zoom,
    })
    expect(estimated).toContain(`fill="${PAPER.text}"`)
  })

  it('gives the value of a solved wall of a room the purple, and leaves the other values grey', () => {
    const fs = 10
    const ctx = dimCtx(fs, { valueStates: (label) => (label === 'SE-2' ? 'solved' : 'estimated') })
    const entries = roomWallDimEntries(rect('r1', 'SE', 'Living', 422, 312), 'lines', ctx)
    const solved = entries.find((e) => e.dimKey === 'SE-2')!
    expect(solved.text.solved).toBe(true)
    expect(entries.find((e) => e.dimKey === 'SE-1')!.text.solved).toBeUndefined()
    const svg = roomWallDimsSvg(entries, { fs, zoom: paperZoom(fs) })
    expect(svg).toContain(`fill="${PAPER.solved}"`)
    // One purple value only: the three other values keep the grey of the paper.
    expect(svg.split(`fill="${PAPER.solved}"`).length - 1).toBe(1)
  })

  it('never writes a measured value in purple, even when the solver changed its wall', () => {
    const fs = 10
    const ctx = dimCtx(fs, {
      surveyLabels: true,
      measurements: { 'SE-2': { label: 'SE-2', actualCm: 302, updatedAt: '2026-01-01T00:00:00Z' } },
      valueStates: (label) => (label === 'SE-2' ? 'measured' : 'estimated'),
    })
    const entries = roomWallDimEntries(rect('r1', 'SE', 'Living', 422, 312), 'lines', ctx)
    const svg = roomWallDimsSvg(entries, { fs, zoom: paperZoom(fs) })
    expect(svg).toContain(`fill="${PAPER.measured}"`)
    expect(svg).not.toContain(`fill="${PAPER.solved}"`)
  })

  it('writes nothing purple when the doc has no solver state (every value is measured or estimated)', () => {
    const fs = 10
    const layout = planDimsLayout({
      doc: { ...emptyDoc(), rooms: [rect('r1', 'SE', 'Living', 422, 312)] },
      style: 'lines', tagFields: TAG, zoom: paperZoom(fs), fs, step: 0.5,
      units: { unit: 'cm', decimals: 1 }, surveyLabels: true, thicknessOf: () => 10, runs: [],
    })
    const svg = roomWallDimsSvg(layout.rooms[0].entries, { fs, zoom: paperZoom(fs) })
    expect(svg).not.toContain(`fill="${PAPER.solved}"`)
  })
})
