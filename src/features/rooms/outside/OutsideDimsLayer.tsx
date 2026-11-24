// Outside dimension chains around the plan (docs/measurements-plan.md section 3): for each straight
// run of outside faces, a CHAIN row (one segment per outside span, cut at the wall ends and at the
// T junctions) and an OVERALL row, both outside the wall band, in the common dimension style of the
// plan (thin line, 45 degree ticks, text centred above the line, always up).
// A run with ONE segment draws one row only: the chain and the overall are the same line then
// (round 1 finding R1-6: two rows with the same ends are a duplicate text).
// Pure geometry: outside/outsideDims.ts.
import { useMemo } from 'react'
import { useViewport } from '../../../canvas/Viewport'
import { fmtLen, type LengthUnits } from '../../../model/units'
import { measuredTextIn, planPrecision } from '../../../model/precision'
import { useDoc, useUi } from '../../../model/store'
import type { Vec } from '../../../model/types'
import { isV2Doc } from '../../../model/v2/targets'
import { useIsDesktop } from '../../../shell/useDesktop'
import { DIM_STYLE, dimLine } from '../dims/dimLine'
import { DimLineView } from '../dims/DimLineView'
import { dimEditAllowed, dimTextLabel, useDimEdit } from '../dims/dimEdit'
import { outsideDims, type OutsideDimSegment, type OutsideDimRun } from './outsideDims'

/** Distance of the chain row and the overall row from the outer face line, screen px. */
const ROW_CHAIN_PX = 28
const ROW_OVERALL_PX = 52
/** Start of the extension lines off the face, screen px. */
const GAP_PX = 4
/** Extra distance from the row of a text that does not fit between its ticks, screen px. */
const OUTSIDE_EXTRA_PX = 6

const moved = (p: Vec, n: Vec, d: number): Vec => ({ x: p.x + n.x * d, y: p.y + n.y * d })

type RowProps = {
  /** Face the row measures, cm. */
  a: Vec
  b: Vec
  /** Unit normal of the run, away from the wall: the side the text and the rows go. */
  normal: Vec
  /** Distance of the dimension line from the face line, cm (from px()). */
  offset: number
  text: string
  /** Measured value: bold green text instead of the calculated grey one. */
  measured: boolean
  /** Which end the text goes past when it does not fit between the ticks. */
  outsideEnd: 'start' | 'end'
  dimKey: string
  px: (n: number) => number
  zoom: number
  /**
   * Measurement label written by the text ('W12-E'), so a double-click types the value of that
   * outside face (docs/measurements-plan.md section 4); null when the text writes no value.
   */
  editLabel?: string | null
  /** Length of the span on the plan, cm: the placeholder of the typed length. */
  plannedCm?: number
  /** True while the field of that text is open: the field replaces the text. */
  editing?: boolean
}

/**
 * One dimension line of a row, in the common dimension style of the plan. Too short on screen: no
 * line. Text wider than the line: past the end of the line, one step further from the row so the
 * text of the neighbouring segment stays readable, and never on a tick or an extension line
 * (round 1 suggestion 4).
 */
function RowDim({ a, b, normal, offset, text, measured, outsideEnd, dimKey, zoom, editLabel, plannedCm, editing }: RowProps) {
  const base = { start: a, end: b, normal, offsetCm: offset, zoom, text }
  const first = dimLine(base)
  if (!first) return null
  const line = first.outside
    ? dimLine({ ...base, textPlace: 'outside', outsideEnd, textGapPx: DIM_STYLE.textGap + OUTSIDE_EXTRA_PX }) ?? first
    : first
  return (
    <DimLineView line={line} text={text} measured={measured} kind="outside" dimKey={dimKey} hideText={editing}
      onTextDoubleClick={editLabel ? () => useDimEdit.getState().open({ label: editLabel, at: line.text, plannedCm: plannedCm ?? 0 }) : undefined} />
  )
}

/** Text and measured state of one segment of a chain row. */
const segmentText = (seg: OutsideDimSegment, step: number, units: LengthUnits) => {
  const measured = (seg.measuredCm ?? 0) > 0
  return {
    measured,
    text: measured && seg.measuredCm !== null ? measuredTextIn(seg.measuredCm, seg.lengthCm, step, units) : fmtLen(seg.lengthCm, units),
  }
}

/**
 * Outside dimension chains of a v2 document: rows outside the wall band, one chain row and one
 * overall row per straight run of outside faces (one row only when the run has one segment).
 * No hit area, and no pointer event except on the TEXT of a segment that measures a whole outside
 * face: a double-click there types that value (docs/measurements-plan.md section 4). Not drawn when
 * the dimensions layer or the outside dimensions layer is off, and (on a phone) in Measuring Mode,
 * where the plan is cleaned for the survey.
 */
export function OutsideDimsLayer() {
  const rooms = useDoc((s) => s.doc.rooms)
  const nodes = useDoc((s) => s.doc.nodes)
  const walls = useDoc((s) => s.doc.walls)
  const measurements = useDoc((s) => s.doc.measurements)
  const v2 = useDoc((s) => isV2Doc(s.doc))
  const step = useDoc((s) => planPrecision(s.doc))
  const dimensions = useUi((s) => s.layers.dimensions)
  const outside = useUi((s) => s.layers.outsideDims)
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const units = useUi((s) => s.canvasUnits)
  /** Label of the dimension text whose field is open: that text is replaced by the field. */
  const dimEditing = useDimEdit((s) => s.edit?.label ?? null)
  const isDesktop = useIsDesktop()
  const { px, zoom } = useViewport()
  const runs = useMemo(
    () => (v2 ? outsideDims({ rooms, nodes, walls, measurements }) : []),
    [v2, rooms, nodes, walls, measurements],
  )
  if (!v2 || !dimensions || !outside) return null
  if (mode === 'measure' && !isDesktop) return null
  if (!runs.length) return null
  /** Edit mode with the Select tool: a double-click on a facade text types its length (section 4). */
  const canEdit = dimEditAllowed(mode, tool)

  /** The rows of one run: the chain row (only with several segments) and the overall row. */
  const rowsOf = (run: OutsideDimRun) => {
    const last = run.points.length - 1
    const single = run.segments.length === 1
    return (
      <>
        {/* Extension lines: thin, from a small gap off the face to the chain row (and to the
            overall row at the two ends of the run). */}
        {run.points.map((p, i) => {
          const end = i === 0 || i === last
          const from = moved(p, run.normal, px(GAP_PX))
          const to = moved(p, run.normal, px(end ? ROW_OVERALL_PX : ROW_CHAIN_PX))
          return (
            <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={px(1)}
              className="stroke-slate-500 dark:stroke-slate-400" />
          )
        })}
        {!single && run.segments.map((seg, i) => {
          const { measured, text } = segmentText(seg, step, units)
          // Past the end of the segment on the side of the outer end of the run: the start end for
          // the first half of the row, the end of the run for the second half.
          const outsideEnd = i * 2 < run.segments.length ? 'start' : 'end'
          // A segment that measures one whole outside face of a wall ('W12-E') can be typed on.
          const editLabel = canEdit ? dimTextLabel('outside', seg.label ?? String(i)) : null
          return (
            <g key={i} data-outside-seg={seg.label ?? String(i)}>
              <RowDim a={seg.a} b={seg.b} normal={run.normal} offset={px(ROW_CHAIN_PX)} text={text}
                measured={measured} outsideEnd={outsideEnd} dimKey={seg.label ?? String(i)} px={px} zoom={zoom}
                editLabel={editLabel} plannedCm={seg.lengthCm} editing={!!editLabel && editLabel === dimEditing} />
            </g>
          )
        })}
        <g data-outside-overall="">
          {single ? (
            // One segment: the overall row IS the chain segment, with its facade label and its
            // measured value (a second row would repeat the same text between the same ends).
            <g data-outside-seg={run.segments[0].label ?? '0'}>
              <RowDim a={run.segments[0].a} b={run.segments[0].b} normal={run.normal}
                offset={px(ROW_OVERALL_PX)} text={segmentText(run.segments[0], step, units).text}
                measured={segmentText(run.segments[0], step, units).measured} outsideEnd="end"
                dimKey={run.segments[0].label ?? '0'} px={px} zoom={zoom}
                editLabel={canEdit ? dimTextLabel('outside', run.segments[0].label ?? '0') : null}
                plannedCm={run.segments[0].lengthCm}
                editing={!!run.segments[0].label && run.segments[0].label === dimEditing} />
            </g>
          ) : (
            <RowDim a={run.a} b={run.b} normal={run.normal} offset={px(ROW_OVERALL_PX)}
              text={fmtLen(run.overallCm, units)} measured={false} outsideEnd="end" dimKey="overall" px={px} zoom={zoom} />
          )}
        </g>
      </>
    )
  }

  return (
    <g data-outside-dims="" pointerEvents="none">
      {runs.map((run) => (
        <g key={run.key} data-outside-run={run.key}>
          {rowsOf(run)}
        </g>
      ))}
    </g>
  )
}
