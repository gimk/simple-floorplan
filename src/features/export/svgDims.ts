// Measurements on the EXPORTED plan (docs/measurements-plan.md): the SVG strings of the wall
// dimension lines, the room tags and the outside dimension chains. Pure: no store, no React, no DOM.
// The drawing rules are the ones of the plan (features/rooms/dims/dimLine.ts and the layers of
// features/rooms/), written again as plain SVG text attributes instead of classes.
//
// THE "PAPER ZOOM". The plan draws every measurement at a screen size taken from the viewport
// (`px(n)`). An export has no viewport: the drawing is in cm, and its font size `fs` (cm) is picked
// from the size of the plan. So the export uses a FIXED zoom that makes the dimension text of the
// plan (px(11)) exactly as big as the text the export already writes for a wall length (fs * 0.75):
//     zoom = 11 / (fs * 0.75)      [screen px per cm]
// A size of n px is then n / zoom cm on the paper (worldPx(n, zoom)), so a tick of px(8), a gap of
// px(7) and a minimum line of px(12) keep their proportions against the plan, whatever its scale.
//
// Light colours only (the export is always on white paper): no dark mode.
import { surveyIds } from '../../model/survey'
import { fmtLen, type LengthUnits } from '../../model/units'
import { measuredTextIn, shownLength } from '../../model/precision'
import { roomAreaM2, labelPoint, roomWalls, roomInnerRing, innerWallLengths } from '../../model/geometry'
import type { Measurement, PlanDoc, Room, Vec } from '../../model/types'
import type { DimStyle, RoomTagFields } from '../../model/store'
import { DIM_STYLE, worldPx, dimLine, type DimLine } from '../rooms/dims/dimLine'
import { boxHit, dimTextBox, fittingRows, ringBox, tagBox, type Box } from '../rooms/dims/dimBoxes'
import { roomPerimeterCm, roomTagLines, tagCeilingCm, wallProgress } from '../rooms/roomTag'
import { outsideDims, type OutsideDimRun, type OutsideDimSegment } from '../rooms/outside/outsideDims'

// ---- text of the paper ----
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const num = (v: number) => String(Math.round(v * 100) / 100)

/** Colours of the measurements on white paper. */
export const PAPER = {
  /** Dimension lines and ticks. */
  line: '#475569',
  /** Calculated value. */
  text: '#334155',
  /** Survey label before the value. */
  label: '#94a3b8',
  /** Measured value: green and bold. */
  measured: '#15803d',
  /** Halo behind the text, so it stays readable over a wall. */
  halo: '#ffffff',
}

// ---- sizes taken from the plan, in screen px ----
/** Distance of the chain row and the overall row from the outer face line (OutsideDimsLayer.tsx). */
const CHAIN_ROW_PX = 28
const OVERALL_ROW_PX = 52
/** Start of the extension lines off the face. */
const EXT_GAP_PX = 4
/** Extra distance from the row of a text that does not fit between its ticks. */
const OUTSIDE_EXTRA_PX = 6
/** A room smaller than this on the paper shows its code only (same rule as the plan). */
const SMALL_ROOM_PX = 50

/** The paper zoom: screen px per cm of an export whose font size is `fs` cm. */
export const paperZoom = (fs: number) => DIM_STYLE.font / (fs > 0 ? fs * 0.75 : 1)

const moved = (p: Vec, n: Vec, d: number): Vec => ({ x: p.x + n.x * d, y: p.y + n.y * d })

// ---- the value of a measurement ----

/** A value as the dimensions write it: the text, and the survey label in front of it (optional). */
export type DimText = {
  /** The value, e.g. "412" or "✓ 412 · 410,7". */
  value: string
  /** Survey label ("SE-2"), written in a smaller grey text in front of the value. */
  label?: string
  /** The value is measured on site: green and bold. */
  measured: boolean
}

/** The text of a dimension as `dimLine` measures it (label included, since it is drawn). */
export const fullDimText = (t: DimText) => (t.label ? `${t.label} ${t.value}` : t.value)

/**
 * The value of one face of a room, in the units of the plan: the measured value (green, with ✓)
 * when the survey has one, else the calculated length rounded to the plan precision.
 */
export function faceText(input: {
  /** Survey label of the face, when the labels are on. */
  label?: string
  /** Value measured on site, cm. */
  measuredCm?: number
  /** Length of the face, cm. */
  solvedCm: number
  step: number
  units: LengthUnits
}): DimText {
  const measured = (input.measuredCm ?? 0) > 0
  const value = measured
    ? measuredTextIn(input.measuredCm!, shownLength(input.solvedCm, input.step), input.step, input.units)
    : fmtLen(shownLength(input.solvedCm, input.step), input.units)
  return { value, label: input.label, measured }
}

/** The value of one segment of an outside chain (OutsideDimsLayer.tsx, `segmentText`). */
export function segmentText(seg: OutsideDimSegment, step: number, units: LengthUnits): DimText {
  const measured = (seg.measuredCm ?? 0) > 0
  return {
    value: measured && seg.measuredCm !== null ? measuredTextIn(seg.measuredCm, seg.lengthCm, step, units) : fmtLen(seg.lengthCm, units),
    measured,
  }
}

// ---- one dimension line ----

export type DimSvgInput = {
  /** Layout of the line, from dimLine(). */
  line: DimLine
  text: DimText
  /** The face the line measures, for a test: the survey label, or a key of an outside row. */
  dimKey: string
  /** What the line belongs to. */
  kind: 'wall' | 'outside'
  fs: number
  zoom: number
}

/**
 * One dimension line in the common dimension style: a thin line, a 45 degree tick at each end,
 * and the value centred above the line, always up, with a white halo. A measured value is bold and
 * green; a survey label goes in front of it, smaller and grey.
 */
export function dimSvg({ line, text, dimKey, kind, fs, zoom }: DimSvgInput): string {
  const p = (n: number) => worldPx(n, zoom)
  const ticks = line.ticks.map((t) => `M${num(t.x1)} ${num(t.y1)}L${num(t.x2)} ${num(t.y2)}`).join('')
  const label = text.label
    ? `<tspan font-size="${num(fs * 0.62)}" fill="${PAPER.label}" font-weight="400">${esc(text.label)}</tspan>`
    : ''
  const body = label ? `${label} ${esc(text.value)}` : esc(text.value)
  return (
    `<line x1="${num(line.x1)}" y1="${num(line.y1)}" x2="${num(line.x2)}" y2="${num(line.y2)}" ` +
    `stroke="${PAPER.line}" stroke-width="${num(p(DIM_STYLE.lineStroke))}" data-dim-line="${kind}"/>` +
    `<path d="${ticks}" fill="none" stroke="${PAPER.line}" stroke-width="${num(p(DIM_STYLE.tickStroke))}" ` +
    `data-dim-ticks="${kind}"/>` +
    `<text x="${num(line.text.x)}" y="${num(line.text.y)}" text-anchor="middle" dominant-baseline="middle" ` +
    `transform="rotate(${num(line.angle)} ${num(line.text.x)} ${num(line.text.y)})" font-size="${num(fs * 0.75)}" ` +
    `fill="${text.measured ? PAPER.measured : PAPER.text}" font-weight="${text.measured ? 600 : 400}" ` +
    `paint-order="stroke" stroke="${PAPER.halo}" stroke-width="${num(p(3))}" stroke-linejoin="round" ` +
    `data-dim="${esc(dimKey)}"${line.outside ? ' data-dim-outside=""' : ''}>${body}</text>`
  )
}

// ---- the wall lengths of one room ----

export type WallDimCtx = {
  zoom: number
  fs: number
  step: number
  units: LengthUnits
  /** Write the survey label ("SE-2") in front of the value. */
  surveyLabels: boolean
  measurements: Record<string, Measurement>
  /** Thickness of the wall that starts at a vertex, cm (with the defaults of the plan). */
  thicknessOf: (r: Room, wallStart: string) => number
  /** Box of the room tag, cm: a dimension text that would cross it goes outside (as the plan). */
  avoid?: Box | null
}

/**
 * The wall lengths of one room: one dimension line along the inside face of each wall in the
 * "Lines" style (the span the value measures, ticks at the corners, value above the line), or the
 * old text only in the "Text" style (no line, no tick, offset off the wall band).
 */
export function roomWallDimsSvg(r: Room, style: DimStyle, ctx: WallDimCtx): string {
  const { zoom, fs } = ctx
  const p = (n: number) => worldPx(n, zoom)
  // The survey labels of the faces, by start vertex (the labels of the Solve tab).
  const labels = new Map<string, string>()
  for (const id of surveyIds(r)) if (id.kind === 'wall' && id.wallStart) labels.set(id.wallStart, id.label)
  const inner = innerWallLengths(r)
  const ring = style === 'lines' ? roomInnerRing(r) : []
  const parts: string[] = []
  for (const w of roomWalls(r)) {
    const label = labels.get(w.start.id)
    const text = faceText({
      label: ctx.surveyLabels && label ? label : undefined,
      measuredCm: label ? ctx.measurements[label]?.actualCm : undefined,
      solvedCm: style === 'lines' ? inner[w.index] : w.length,
      step: style === 'lines' ? ctx.step : 0,
      units: ctx.units,
    })
    if (style === 'lines') {
      const start = ring[w.index]
      const end = ring[(w.index + 1) % ring.length]
      if (!start || !end) continue
      const base = { start, end, normal: w.inward, offsetCm: p(10), zoom, text: fullDimText(text) }
      let line = dimLine(base)
      if (!line) continue
      // The text of a wall length must not cross the room tag: it goes past the end of its line,
      // and when that still crosses the tag it is not drawn (the plan, r1fix R1-8a).
      if (ctx.avoid && boxHit(dimTextBox(line, fullDimText(text), zoom), ctx.avoid)) {
        const outside = dimLine({ ...base, textPlace: 'outside', textGapPx: DIM_STYLE.textGap + OUTSIDE_EXTRA_PX })
        if (!outside || boxHit(dimTextBox(outside, fullDimText(text), zoom), ctx.avoid)) continue
        line = outside
      }
      parts.push(dimSvg({ line, text, dimKey: label ?? `${r.code}-${w.index + 1}`, kind: 'wall', fs, zoom }))
      continue
    }
    // "Wall lengths: Text": the old look, a text only, a fixed distance into the room.
    if (w.length < fs * 6) continue
    const off = ctx.thicknessOf(r, w.start.id) / 2 + fs * 0.9
    const mx = (w.start.x + w.end.x) / 2 + w.inward.x * off
    const my = (w.start.y + w.end.y) / 2 + w.inward.y * off
    let angle = (Math.atan2(w.dir.y, w.dir.x) * 180) / Math.PI
    if (angle > 90 || angle < -90) angle += 180
    const body = text.label ? `<tspan font-size="${num(fs * 0.5)}" fill="${PAPER.label}">${esc(text.label)}</tspan>  ` : ''
    parts.push(
      `<text x="${num(mx)}" y="${num(my)}" text-anchor="middle" dominant-baseline="middle" ` +
      `transform="rotate(${num(angle)} ${num(mx)} ${num(my)})" font-size="${num(fs * 0.75)}" ` +
      `fill="${text.measured ? PAPER.measured : PAPER.line}" font-weight="${text.measured ? 700 : 400}" ` +
      `paint-order="stroke" stroke="${PAPER.halo}" stroke-width="${num(fs * 0.25)}" stroke-linejoin="round" ` +
      `data-dim="${esc(label ?? '')}">${body}${esc(text.value)}</text>`,
    )
  }
  return parts.join('')
}

// ---- the room tag ----

export type TagCtx = {
  zoom: number
  fs: number
  measurements: Record<string, Measurement>
  /** Ceiling height of the apartment, for a room that has none of its own. */
  defaultCeilingCm?: number
}

/** The tag of one room: its SVG, and the box it takes (null when the room is too small for a tag). */
export type TagLayout = { svg: string; box: Box | null }

/**
 * The room tag of the export: the title (code + name) and the rows the user chose in the View menu
 * (area, perimeter, ceiling height, survey progress), centred on the label point of the room.
 * A room smaller than 50 screen px on the paper shows its code alone, and a room that is too small
 * for the whole tag keeps only the rows that fit in it (the plan, r1fix R1-8).
 */
export function roomTagLayout(r: Room, fields: RoomTagFields, ctx: TagCtx): TagLayout {
  const c = labelPoint([r.vertices, ...(r.holes ?? [])])
  // A room without its own height uses the height of the apartment (as the plan).
  const room: Room = r.ceilingCm && r.ceilingCm > 0 ? r : { ...r, ceilingCm: ctx.defaultCeilingCm }
  const progress = wallProgress([room], ctx.measurements)
  const lines = roomTagLines(
    {
      name: r.name,
      codes: [r.code],
      areaM2: roomAreaM2(r),
      perimeterCm: roomPerimeterCm(r),
      ceilingCm: tagCeilingCm([room]),
      measuredWalls: progress.measured,
      walls: progress.walls,
    },
    fields,
  )
  const fs = ctx.fs
  const xs = r.vertices.map((v) => v.x), ys = r.vertices.map((v) => v.y)
  const small = xs.length === 0
    || Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * ctx.zoom < SMALL_ROOM_PX
  const code = lines.title.code ?? ''
  if (small) {
    // No room for the name: the code alone, small, is better than nothing.
    if (!code) return { svg: '', box: null }
    return {
      svg:
        `<text x="${num(c.x)}" y="${num(c.y)}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-size="${num(fs * 0.7)}" font-weight="700" fill="${PAPER.line}" font-family="monospace" ` +
        `data-room-code-only="${esc(r.id)}">${esc(code)}</text>`,
      box: null,
    }
  }
  const step = fs * 1.15
  // The rows that fit in the room: they are dropped from the end until the tag fits (as the plan).
  const titleChars = (code ? code.length + 2 : 0) + (lines.title.name?.length ?? 0)
  const size = (kept: number) => {
    const longest = Math.max(titleChars, ...lines.rows.slice(0, kept).map((row) => row.length))
    return { w: longest * fs * 0.56, h: (kept + 1) * step }
  }
  const ring = roomInnerRing(r)
  const kept = fittingRows(lines.rows, {
    p: c,
    vertical: false,
    size: (n) => size(n),
    room: ringBox(ring.length >= 3 ? ring : r.vertices),
  })
  const box = tagBox(c, size(kept.length).w, size(kept.length).h, false)
  // The whole block (title + rows) is centred on the label point.
  const y0 = c.y - (kept.length * step) / 2 + fs * 0.35
  const title = lines.title.name
    ? `<tspan x="${num(c.x)}" font-weight="700" data-room-label="${esc(r.id)}">` +
      (code ? `<tspan font-weight="700" font-family="monospace" data-room-code-text="${esc(r.code)}">${esc(code)}  </tspan>` : '') +
      `${esc(lines.title.name)}</tspan>`
    : code
      ? `<tspan x="${num(c.x)}" font-weight="700" font-family="monospace" data-room-label="${esc(r.id)}">${esc(code)}</tspan>`
      : ''
  const rows = kept
    .map((row, i) =>
      `<tspan x="${num(c.x)}" y="${num(y0 + fs * 0.35 + (i + 1) * step)}" font-size="${num(fs * 0.85)}" ` +
      `fill="${PAPER.line}" data-room-tag-row="${i}">${esc(row)}</tspan>`)
    .join('')
  if (title === '' && rows === '') return { svg: '', box: null }
  return {
    svg:
      `<text x="${num(c.x)}" y="${num(y0)}" text-anchor="middle" font-size="${num(fs)}" fill="${PAPER.text}" ` +
      `data-room-tag="${esc(r.id)}">${title}${rows}</text>`,
    box,
  }
}

// ---- the outside dimension chains ----

export type OutsideCtx = {
  zoom: number
  fs: number
  step: number
  units: LengthUnits
  /** Write the facade survey label ("W12-E") in front of the value. */
  surveyLabels: boolean
}

/**
 * The two rows of one outside run, in the common dimension style and outside the wall band:
 * the extension lines, the CHAIN (one segment per outside span, cut at the T junctions) and the
 * OVERALL length of the run. A run with one segment draws one row only (the chain and the overall
 * are the same line then).
 */
export function outsideRunSvg(run: OutsideDimRun, ctx: OutsideCtx): string {
  const { zoom, fs } = ctx
  const p = (n: number) => worldPx(n, zoom)
  const parts: string[] = []
  const last = run.points.length - 1
  // Extension lines: thin, from a small gap off the face to the chain row (and to the overall row
  // at the two ends of the run).
  run.points.forEach((q, i) => {
    const end = i === 0 || i === last
    const from = moved(q, run.normal, p(EXT_GAP_PX))
    const to = moved(q, run.normal, p(end ? OVERALL_ROW_PX : CHAIN_ROW_PX))
    parts.push(
      `<line x1="${num(from.x)}" y1="${num(from.y)}" x2="${num(to.x)}" y2="${num(to.y)}" ` +
      `stroke="${PAPER.line}" stroke-width="${num(p(DIM_STYLE.lineStroke))}" data-dim-ext="${esc(run.key)}:${i}"/>`,
    )
  })
  /** One row of the run, with the rule of the style: text past the end when it does not fit. */
  const row = (a: Vec, b: Vec, offsetPx: number, text: DimText, outsideEnd: 'start' | 'end', dimKey: string) => {
    const base = { start: a, end: b, normal: run.normal, offsetCm: p(offsetPx), zoom, text: fullDimText(text) }
    const first = dimLine(base)
    if (!first) return
    const line = first.outside
      ? dimLine({ ...base, textPlace: 'outside', outsideEnd, textGapPx: DIM_STYLE.textGap + OUTSIDE_EXTRA_PX }) ?? first
      : first
    parts.push(dimSvg({ line, text, dimKey, kind: 'outside', fs, zoom }))
  }
  const single = run.segments.length === 1
  if (!single) {
    run.segments.forEach((seg, i) => {
      const text = segmentText(seg, ctx.step, ctx.units)
      const withLabel: DimText = {
        ...text,
        label: ctx.surveyLabels && seg.label ? seg.label : undefined,
      }
      // Past the end of the segment on the side of the outer end of the run.
      row(seg.a, seg.b, CHAIN_ROW_PX, withLabel, i * 2 < run.segments.length ? 'start' : 'end', seg.label ?? `${run.key}:${i}`)
    })
  }
  // The overall row: the whole run (one row only when the run has one segment, since the chain
  // segment already spans the same two ends).
  if (single) {
    const seg = run.segments[0]
    const text = segmentText(seg, ctx.step, ctx.units)
    const withLabel: DimText = { ...text, label: ctx.surveyLabels && seg.label ? seg.label : undefined }
    row(seg.a, seg.b, OVERALL_ROW_PX, withLabel, 'end', seg.label ?? 'overall')
  } else {
    row(run.a, run.b, OVERALL_ROW_PX, { value: fmtLen(run.overallCm, ctx.units), measured: false }, 'end', `overall:${run.key}`)
  }
  return parts.join('')
}

/**
 * The outside runs of the export, or none: only a v2 document has stored walls, and the rows can be
 * turned off in the Export panel.
 */
export function exportOutsideRuns(doc: PlanDoc, on: boolean): OutsideDimRun[] {
  if (!on || doc.schemaVersion !== 2) return []
  return outsideDims(doc)
}

/**
 * The points that the outside rows and their texts reach beyond the plan, so that the viewBox of the
 * export grows enough to keep them in the image.
 */
export function outsideExtentPoints(runs: OutsideDimRun[], zoom: number): Vec[] {
  const far = worldPx(OVERALL_ROW_PX + DIM_STYLE.textGap + OUTSIDE_EXTRA_PX + DIM_STYLE.font, zoom)
  const near = worldPx(CHAIN_ROW_PX, zoom)
  const out: Vec[] = []
  for (const run of runs) {
    for (const q of run.points) out.push(moved(q, run.normal, near), moved(q, run.normal, far))
    // The text of a segment that does not fit goes past the end of the row.
    const first = run.points[0], lastP = run.points[run.points.length - 1]
    if (first && lastP) {
      out.push(moved(moved(first, run.normal, far), run.dir, -far))
      out.push(moved(moved(lastP, run.normal, far), run.dir, far))
    }
  }
  return out
}
