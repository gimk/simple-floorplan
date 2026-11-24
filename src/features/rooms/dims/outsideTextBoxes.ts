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
import { dimTextBox, type Box } from './dimBoxes'

/** Distance of the chain row and the overall row from the outer face line, screen px. */
/** Extra distance from the row of a text that does not fit between its ticks, screen px. */

export type OutsideTextInput = {
  /** Screen px per cm. */
  zoom: number
  /** The text of a chain segment: the units and the measured value come from the caller. */
  segmentText: (seg: OutsideDimSegment) => string
  /** The text of the overall row of a run. */
  overallText: (run: OutsideDimRun) => string
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

/**
 * Boxes of the texts of every outside row of the plan, cm. The outside layer draws one chain row per
 * straight run of outside faces (only when the run has several segments) and one overall row; a run
 * with one segment draws that segment once, on the overall row.
 */
export function outsideDimTextBoxes(runs: OutsideDimRun[], input: OutsideTextInput): Box[] {
  const { zoom } = input
  const out: Box[] = []
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
        if (box) out.push(box)
      })
    }
    // The overall row: the segment itself when a run has one segment, else the length of the run.
    const seg = run.segments[0]
    const text = single ? input.segmentText(seg) : input.overallText(run)
    const a = single ? seg.a : run.a
    const b = single ? seg.b : run.b
    const box = rowBox(a, b, run.normal, overallOff, zoom, text, 'end')
    if (box) out.push(box)
  }
  return out
}
