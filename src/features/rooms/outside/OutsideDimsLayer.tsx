// Outside dimension chains around the plan (docs/measurements-plan.md section 3): for each straight
// run of outside faces, a CHAIN row (one segment per outside span, cut at the wall ends and at the
// T junctions) and an OVERALL row, both outside the wall band, in the common dimension style of the
// plan (thin line, 45 degree ticks, text centred above the line, always up).
// Pure geometry: outside/outsideDims.ts.
import { useMemo } from 'react'
import { useViewport } from '../../../canvas/Viewport'
import { dist, fmtCm } from '../../../model/geometry'
import { measuredText, planPrecision } from '../../../model/precision'
import { useDoc, useUi } from '../../../model/store'
import type { Vec } from '../../../model/types'
import { isV2Doc } from '../../../model/v2/targets'
import { useIsDesktop } from '../../../shell/useDesktop'
import { outsideDims } from './outsideDims'

/** Distance of the chain row and the overall row from the outer face line, screen px. */
const ROW_CHAIN_PX = 28
const ROW_OVERALL_PX = 52
/** Start of the extension lines off the face, and the 45 degree tick and text sizes, screen px. */
const GAP_PX = 4
const TICK_PX = 8
const TEXT_OFF_PX = 7
/** Width of one character of the dimension text, screen px (approximation, no canvas measure). */
const CHAR_PX = 6.2

const RAD = Math.PI / 180

const unit = (v: Vec): Vec => {
  const len = Math.hypot(v.x, v.y)
  return len < 1e-9 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len }
}

const moved = (p: Vec, n: Vec, d: number): Vec => ({ x: p.x + n.x * d, y: p.y + n.y * d })

type DimProps = {
  a: Vec
  b: Vec
  /** Unit normal of the run, away from the wall: the side the text and the rows go. */
  normal: Vec
  /** Distance of the dimension line from the face line, cm (from px()). */
  offset: number
  text: string
  /** Measured value: bold green text instead of the calculated grey one. */
  measured: boolean
  px: (n: number) => number
}

/**
 * One dimension line of the common style: a thin line between the two points of the face, a 45
 * degree tick at each end, and the text centred on the line, offset on the far side of the wall.
 * Too short to read: nothing. Text wider than the line: past the end of the line.
 */
function DimLine({ a, b, normal, offset, text, measured, px }: DimProps) {
  const len = dist(a, b)
  if (len < px(12)) return null
  const dir = unit({ x: b.x - a.x, y: b.y - a.y })
  const from = moved(a, normal, offset)
  const to = moved(b, normal, offset)
  // Text always up: the angle of the line, turned into -90..90 degrees.
  const raw = Math.atan2(dir.y, dir.x) / RAD
  const angle = raw > 90 ? raw - 180 : raw < -90 ? raw + 180 : raw
  // 45 degree tick, centred on an end point (half of it on each side of the line).
  const tick = { x: Math.cos((raw - 45) * RAD) * px(TICK_PX) / 2, y: Math.sin((raw - 45) * RAD) * px(TICK_PX) / 2 }
  const width = text.length * px(CHAR_PX)
  const middle = moved({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, normal, px(TEXT_OFF_PX))
  // No room between the ticks: the text goes past the end of the line.
  const at = width > len - px(8)
    ? moved(moved(to, dir, width / 2 + px(4)), normal, px(TEXT_OFF_PX))
    : middle
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={px(1)}
        className="stroke-slate-500 dark:stroke-slate-400" />
      {[from, to].map((p, i) => (
        <line key={i} x1={p.x - tick.x} y1={p.y - tick.y} x2={p.x + tick.x} y2={p.y + tick.y}
          strokeWidth={px(1.5)} className="stroke-slate-500 dark:stroke-slate-400" />
      ))}
      <text x={at.x} y={at.y} textAnchor="middle" dominantBaseline="middle" fontSize={px(11)}
        transform={`rotate(${angle} ${at.x} ${at.y})`} paintOrder="stroke" strokeWidth={px(3)}
        strokeLinejoin="round" fontWeight={measured ? 600 : undefined}
        className={`stroke-[#f6f7f5] dark:stroke-[#12161b] ${measured ? 'fill-emerald-700 dark:fill-emerald-400' : 'fill-slate-600 dark:fill-slate-300'}`}>
        {text}
      </text>
    </g>
  )
}

/**
 * Outside dimension chains of a v2 document: rows outside the wall band, one chain row and one
 * overall row per straight run of outside faces. Read only: no hit area, no pointer events.
 * Not drawn when the dimensions layer or the outside dimensions layer is off, and (on a phone) in
 * Measuring Mode, where the plan is cleaned for the survey.
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
  const isDesktop = useIsDesktop()
  const { px } = useViewport()
  const runs = useMemo(
    () => (v2 ? outsideDims({ rooms, nodes, walls, measurements }) : []),
    [v2, rooms, nodes, walls, measurements],
  )
  if (!v2 || !dimensions || !outside) return null
  if (mode === 'measure' && !isDesktop) return null
  if (!runs.length) return null

  return (
    <g data-outside-dims="" pointerEvents="none">
      {runs.map((run) => {
        const last = run.points.length - 1
        return (
          <g key={run.key} data-outside-run={run.key}>
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
            {run.segments.map((seg, i) => {
              const measured = (seg.measuredCm ?? 0) > 0
              const text = measured && seg.measuredCm !== null
                ? measuredText(seg.measuredCm, seg.lengthCm, step)
                : fmtCm(seg.lengthCm)
              return (
                <g key={i} data-outside-seg={seg.label ?? String(i)}>
                  <DimLine a={seg.a} b={seg.b} normal={run.normal} offset={px(ROW_CHAIN_PX)}
                    text={text} measured={measured} px={px} />
                </g>
              )
            })}
            <g data-outside-overall="">
              <DimLine a={run.a} b={run.b} normal={run.normal} offset={px(ROW_OVERALL_PX)}
                text={fmtCm(run.overallCm)} measured={false} px={px} />
            </g>
          </g>
        )
      })}
    </g>
  )
}
