// Text boxes of the outside dimension chains (round 2 finding R2-2): the wall number badges must
// keep off the texts of the outside rows too, not only off the wall values.
//
// The layout below is the one of `outside/OutsideDimsLayer.tsx`, written again with the same pure
// functions (`dimLine` of dims/dimLine.ts): the chain row px(28) from the outer face line, the
// overall row px(52), the text of a segment that does not fit between its ticks past the end of its
// line and one step further from the row, and one row only for a run that has one segment. The
// layer file itself owns the drawing; this file only says where its texts are. Pure: no store, no
// React. Units are cm, y points down.
import { OUTSIDE_EXTRA_PX, OUTSIDE_ROWS_PX, type OutsideDimRun, type OutsideDimSegment } from '../outside/outsideDims'
export { OUTSIDE_EXTRA_PX, OUTSIDE_ROWS_PX }
import { DIM_STYLE, dimLine, worldPx } from './dimLine'
import { boxHit, dimTextBox, growBox, type Box } from './dimBoxes'

/** Distance of the chain row and the overall row from the outer face line, screen px. */
/** Extra distance from the row of a text that does not fit between its ticks, screen px. */

export type OutsideTextInput = {
  /** Screen px per cm. */
  zoom: number
  /** The text of a chain segment: the units and the measured value come from the caller. */
  segmentText: (seg: OutsideDimSegment) => string
  /** The text of the overall row of a run. */
  overallText: (run: OutsideDimRun) => string
  /** True when a chain segment shows a measured value (default: `seg.measuredCm > 0`). */
  segmentMeasured?: (seg: OutsideDimSegment) => boolean
}

/**
 * The box of the text of one row, or null when the row draws nothing (the face is shorter than
 * `DIM_STYLE.minLine` on screen, so no line and no text).
 */
function rowBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  normal: { x: number; y: number },
  offsetCm: number,
  zoom: number,
  text: string,
  outsideEnd: 'start' | 'end',
): Box | null {
  const base = { start: a, end: b, normal, offsetCm, zoom, text }
  const first = dimLine(base)
  if (!first) return null
  // A text that does not fit between the ticks of a row goes past the end of its line, one step
  // further from the row than the standard gap (round 1 suggestion 4).
  const line = first.outside
    ? dimLine({ ...base, textPlace: 'outside', outsideEnd, textGapPx: DIM_STYLE.textGap + OUTSIDE_EXTRA_PX }) ?? first
    : first
  return dimTextBox(line, text, zoom)
}

/** Margin kept between two outside texts, screen px. */
export const OUTSIDE_TEXT_MARGIN_PX = 2

/** One outside text with its box and its priority. */
export type OutsideTextEntry = {
  /** Stable key: '<run.key>:seg:<i>' (chain segment) or '<run.key>:overall'. */
  key: string
  box: Box
  /** 0 = overall/single row, 1 = chain row. */
  rank: number
  measured: boolean
  lengthCm: number
}

/** Every outside text that is drawn, with its box (same text rule and placement as the layer). */
export function outsideTextEntries(runs: OutsideDimRun[], input: OutsideTextInput): OutsideTextEntry[] {
  const { zoom } = input
  const isMeasured = input.segmentMeasured ?? ((seg: OutsideDimSegment) => (seg.measuredCm ?? 0) > 0)
  const out: OutsideTextEntry[] = []
  const chainOff = worldPx(OUTSIDE_ROWS_PX.chain, zoom)
  const overallOff = worldPx(OUTSIDE_ROWS_PX.overall, zoom)
  for (const run of runs) {
    const single = run.segments.length === 1
    if (!single) {
      run.segments.forEach((seg, i) => {
        // Past the end of the segment on the side of the outer end of the run: the start end for
        // the first half of the row, the end of the run for the second half.
        const outsideEnd = i * 2 < run.segments.length ? 'start' : 'end'
        const box = rowBox(seg.a, seg.b, run.normal, chainOff, zoom, input.segmentText(seg), outsideEnd)
        if (box) out.push({ key: `${run.key}:seg:${i}`, box, rank: 1, measured: isMeasured(seg), lengthCm: seg.lengthCm })
      })
    }
    // The overall row: the segment itself when a run has one segment, else the length of the run.
    const seg = run.segments[0]
    const text = single ? input.segmentText(seg) : input.overallText(run)
    const a = single ? seg.a : run.a
    const b = single ? seg.b : run.b
    const box = rowBox(a, b, run.normal, overallOff, zoom, text, 'end')
    if (box) {
      out.push({
        key: `${run.key}:overall`, box, rank: 0,
        measured: single && isMeasured(seg), lengthCm: single ? seg.lengthCm : run.overallCm,
      })
    }
  }
  return out
}

/**
 * Greedy overlap pass over the outside texts: overall rows first, then the measured values, then the
 * longer lengths; a text is kept when its box (with a 2 px margin) hits no kept box, else it is
 * hidden (its line, ticks and extension lines stay). Returns the keys of the hidden texts.
 */
export function outsideHiddenTexts(runs: OutsideDimRun[], input: OutsideTextInput): Set<string> {
  const entries = outsideTextEntries(runs, input)
  const margin = worldPx(OUTSIDE_TEXT_MARGIN_PX, input.zoom)
  const order = entries
    .map((e, i) => ({ e, i }))
    .sort((p, q) =>
      p.e.rank - q.e.rank ||
      Number(q.e.measured) - Number(p.e.measured) ||
      q.e.lengthCm - p.e.lengthCm ||
      p.i - q.i)
  const kept: Box[] = []
  const hidden = new Set<string>()
  for (const { e } of order) {
    const grown = growBox(e.box, margin / 2)
    if (kept.some((k) => boxHit(growBox(k, margin / 2), grown))) hidden.add(e.key)
    else kept.push(e.box)
  }
  return hidden
}

/**
 * Boxes of the texts of every outside row of the plan, cm, without the texts that the overlap pass
 * hides. The outside layer draws one chain row per straight run of outside faces (only when the run
 * has several segments) and one overall row; a run with one segment draws that segment once, on the
 * overall row.
 */
export function outsideDimTextBoxes(runs: OutsideDimRun[], input: OutsideTextInput): Box[] {
  const hidden = outsideHiddenTexts(runs, input)
  return outsideTextEntries(runs, input).filter((e) => !hidden.has(e.key)).map((e) => e.box)
}
