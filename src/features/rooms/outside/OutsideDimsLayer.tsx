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
import { fitsPlan, measuredBreakdown, measuredTextIn, planPrecision } from '../../../model/precision'
import { useDoc, useUi } from '../../../model/store'
import type { Vec } from '../../../model/types'
import { isV2Doc } from '../../../model/v2/targets'
import { MISMATCH_FILL } from '../../../shell/panel/styles'
import { useIsDesktop } from '../../../shell/useDesktop'
import { outsideHiddenTexts } from '../dims/outsideTextBoxes'
import { DimLineView } from '../dims/DimLineView'
import { useValueStates } from '../dims/useValueStates'
import type { ValueStates } from '../dims/valueStates'
import type { ValueState } from '../../solver/lookup'
import { dimEditAllowed, dimTextLabel, useDimEdit } from '../dims/dimEdit'
import { OUTSIDE_EXT_GAP_PX, OUTSIDE_ROWS_PX, outsideDims, outsideDimsLod, outsideRowLine, type OutsideDimSegment, type OutsideDimRun } from './outsideDims'

/** Row distances from the outer face line, screen px (shared with the badge mask and the export). */
const ROW_CHAIN_PX = OUTSIDE_ROWS_PX.chain
const ROW_OVERALL_PX = OUTSIDE_ROWS_PX.overall
const GAP_PX = OUTSIDE_EXT_GAP_PX

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
  /** Green measured, purple solved, grey estimated (docs/solver-plan.md). */
  state: ValueState
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
  /** The overlap pass hid this text: the line and the ticks stay. */
  hidden?: boolean
  /** Measured value that the plan does not fit: amber, and its text starts with "~". */
  mismatch?: boolean
  /** Full value of a mismatch, shown while the pointer is on the text; null otherwise. */
  breakdown?: string | null
  /** Pointer enters the TEXT: the plan shows the breakdown and the label of the face lights up. */
  onTextPointerEnter?: () => void
  /** Pointer leaves the TEXT: the breakdown goes, when it is still this text that holds it. */
  onTextPointerLeave?: () => void
}

/**
 * One dimension line of a row, in the common dimension style of the plan. Too short on screen: no
 * line. Text wider than the line: past the end of the line, one step further from the row so the
 * text of the neighbouring segment stays readable, and never on a tick or an extension line
 * (round 1 suggestion 4).
 */
function RowDim({
  a, b, normal, offset, text, measured, state, outsideEnd, dimKey, zoom, editLabel, plannedCm, editing, hidden,
  mismatch, breakdown, onTextPointerEnter, onTextPointerLeave,
}: RowProps) {
  const line = outsideRowLine({ start: a, end: b, normal, offsetCm: offset, zoom, text, outsideEnd })
  if (!line) return null
  // The breakdown of a value the plan does not fit: one small amber text, px(13) further out than
  // the value (perpendicular to the line of the row, so it never sits on the text).
  const px = (n: number) => n / (zoom > 0 ? zoom : 1)
  const bx = line.text.x + normal.x * px(13), by = line.text.y + normal.y * px(13)
  return (
    <>
      <DimLineView line={line} text={text} measured={measured} state={state} kind="outside" dimKey={dimKey} hideText={editing || hidden}
        mismatch={mismatch} onTextPointerEnter={onTextPointerEnter} onTextPointerLeave={onTextPointerLeave}
        onTextDoubleClick={editLabel ? () => useDimEdit.getState().open({ label: editLabel, at: line.text, plannedCm: plannedCm ?? 0 }) : undefined} />
      {breakdown && !hidden && (
        <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle"
          transform={`rotate(${line.angle} ${bx} ${by})`} fontSize={px(10)}
          pointerEvents="none" paintOrder="stroke" strokeWidth={px(3)} strokeLinejoin="round"
          data-dim-breakdown={dimKey}
          className={`stroke-[#f6f7f5] dark:stroke-[#12161b] ${MISMATCH_FILL}`}>
          {breakdown}
        </text>
      )}
    </>
  )
}

/**
 * Text and state of one segment of a chain row. A chain segment that measures one whole outside face
 * ('W12-E') maps to one stored wall, so the solver can have solved it: purple (docs/solver-plan.md).
 */
const segmentText = (seg: OutsideDimSegment, step: number, units: LengthUnits, valueStates?: ValueStates) => {
  const measured = (seg.measuredCm ?? 0) > 0
  // A measured facade value that the plan does not fit: ONE clean value on the plan ("~412"), amber;
  // the breakdown (measured, plan, difference) goes under it while the pointer is on the text.
  const mismatch = measured && seg.measuredCm !== null && !fitsPlan(seg.measuredCm, seg.lengthCm, step)
  return {
    measured,
    state: valueStates ? valueStates(seg.label, seg.measuredCm) : measured ? 'measured' as const : 'estimated' as const,
    text: measured && seg.measuredCm !== null ? measuredTextIn(seg.measuredCm, seg.lengthCm, step, units) : fmtLen(seg.lengthCm, units),
    mismatch,
    breakdown: mismatch && seg.measuredCm !== null ? measuredBreakdown(seg.measuredCm, seg.lengthCm, units) : null,
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
  /** Label of the face under the pointer (the plan and the survey cards share it). */
  const hoverLabel = useUi((s) => s.hoverLabel)
  const isDesktop = useIsDesktop()
  const { px, zoom } = useViewport()
  /** Green measured, purple solved, grey estimated: one memoized lookup per document. */
  const valueStates = useValueStates()
  const runs = useMemo(
    () => (v2 ? outsideDims({ rooms, nodes, walls, measurements }) : []),
    [v2, rooms, nodes, walls, measurements],
  )
  if (!v2 || !dimensions || !outside) return null
  if (mode === 'measure' && !isDesktop) return null
  // Level of detail: no row for the small runs, no chain row for a run with small segments.
  const shown = outsideDimsLod(runs, zoom)
  if (!shown.length) return null
  // Greedy overlap pass: a text that hits a stronger outside text is hidden (same pass as the badge
  // mask and the export).
  const hiddenTexts = outsideHiddenTexts(shown, {
    zoom,
    segmentText: (seg) => segmentText(seg, step, units, valueStates).text,
    overallText: (run) => fmtLen(run.overallCm, units),
    segmentMeasured: (seg) => segmentText(seg, step, units, valueStates).measured,
  })
  /** Edit mode with the Select tool: a double-click on a facade text types its length (section 4). */
  const canEdit = dimEditAllowed(mode, tool)
  /**
   * The pointer on a facade text: the plan shows the breakdown of a measured value that does not
   * fit, and the survey card of that face lights up (`hoverLabel`). The leave clears it only when
   * it is still the label of this text.
   */
  const enter = (label: string) => () => useUi.getState().set({ hoverLabel: label })
  const leave = (label: string) => () => {
    if (useUi.getState().hoverLabel === label) useUi.getState().set({ hoverLabel: null })
  }

  /** The rows of one run: the chain row (only with several segments) and the overall row. */
  const rowsOf = (run: OutsideDimRun) => {
    const overallHidden = hiddenTexts.has(`${run.key}:overall`)
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
          const { measured, state, text, mismatch, breakdown } = segmentText(seg, step, units, valueStates)
          // Past the end of the segment on the side of the outer end of the run: the start end for
          // the first half of the row, the end of the run for the second half.
          const outsideEnd = i * 2 < run.segments.length ? 'start' : 'end'
          // A segment that measures one whole outside face of a wall ('W12-E') can be typed on.
          const editLabel = canEdit ? dimTextLabel('outside', seg.label ?? String(i)) : null
          const hidden = hiddenTexts.has(`${run.key}:seg:${i}`)
          const editing = !!editLabel && editLabel === dimEditing
          return (
            <g key={i} data-outside-seg={seg.label ?? String(i)}>
              <RowDim a={seg.a} b={seg.b} normal={run.normal} offset={px(ROW_CHAIN_PX)} text={text}
                measured={measured} state={state} outsideEnd={outsideEnd} hidden={hidden} dimKey={seg.label ?? String(i)} px={px} zoom={zoom}
                editLabel={editLabel} plannedCm={seg.lengthCm} editing={editing}
                mismatch={mismatch}
                breakdown={!editing && hoverLabel === seg.label ? breakdown : null}
                onTextPointerEnter={seg.label ? enter(seg.label) : undefined}
                onTextPointerLeave={seg.label ? leave(seg.label) : undefined} />
            </g>
          )
        })}
        <g data-outside-overall="">
          {single ? (
            // One segment: the overall row IS the chain segment, with its facade label and its
            // measured value (a second row would repeat the same text between the same ends).
            <g data-outside-seg={run.segments[0].label ?? '0'}>
              <RowDim a={run.segments[0].a} b={run.segments[0].b} normal={run.normal}
                offset={px(ROW_OVERALL_PX)} text={segmentText(run.segments[0], step, units, valueStates).text}
                measured={segmentText(run.segments[0], step, units, valueStates).measured}
                state={segmentText(run.segments[0], step, units, valueStates).state} outsideEnd="end" hidden={overallHidden}
                dimKey={run.segments[0].label ?? '0'} px={px} zoom={zoom}
                editLabel={canEdit ? dimTextLabel('outside', run.segments[0].label ?? '0') : null}
                plannedCm={run.segments[0].lengthCm}
                editing={!!run.segments[0].label && run.segments[0].label === dimEditing}
                mismatch={segmentText(run.segments[0], step, units, valueStates).mismatch}
                breakdown={hoverLabel === run.segments[0].label
                  ? segmentText(run.segments[0], step, units, valueStates).breakdown
                  : null}
                onTextPointerEnter={run.segments[0].label ? enter(run.segments[0].label) : undefined}
                onTextPointerLeave={run.segments[0].label ? leave(run.segments[0].label) : undefined} />
            </g>
          ) : (
            <RowDim a={run.a} b={run.b} normal={run.normal} offset={px(ROW_OVERALL_PX)}
              text={fmtLen(run.overallCm, units)} measured={false} state="estimated" outsideEnd="end" hidden={overallHidden} dimKey="overall" px={px} zoom={zoom} />
          )}
        </g>
      </>
    )
  }

  return (
    <g data-outside-dims="" pointerEvents="none">
      {shown.map((run) => (
        <g key={run.key} data-outside-run={run.key}>
          {rowsOf(run)}
        </g>
      ))}
    </g>
  )
}
