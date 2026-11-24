// One dimension line on the plan, in the common dimension style (docs/measurements-plan.md):
// a thin line with a 45 degree tick at each end, and the value centred above the line on the side
// away from the wall. The layout comes from dimLine.ts (pure); this file only draws it.
import { useViewport } from '../../../canvas/Viewport'
import type { DimLine } from './dimLine'

const lineClass = 'stroke-slate-500 dark:stroke-slate-400'
const haloClass = 'stroke-[#f6f7f5] dark:stroke-[#12161b]'
const calculatedText = 'fill-slate-600 dark:fill-slate-300'
const measuredTextClass = 'fill-emerald-700 dark:fill-emerald-400'

export type DimLineViewProps = {
  /** Layout of the line, from dimLine() / dimLineOfSpan(). */
  line: DimLine
  /** The value, e.g. "412" or "✓ 412 · 410,7". */
  text: string
  /** Measured value: green and bold (the common dimension style). */
  measured: boolean
  /** What the line belongs to: a wall length, the helper dimensions, or an outside chain row. */
  kind: 'wall' | 'helper' | 'outside'
  /** The wall or the face the line measures, for a test. */
  dimKey: string
}

export function DimLineView({ line, text, measured, kind, dimKey }: DimLineViewProps) {
  const { px } = useViewport()
  return (
    <g pointerEvents="none" data-dim={kind} data-dim-key={dimKey} data-dim-outside={line.outside ? '' : undefined}>
      <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} strokeWidth={px(1)} className={lineClass} />
      {line.ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth={px(1.5)} className={lineClass} />
      ))}
      <text x={line.text.x} y={line.text.y} textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(${line.angle} ${line.text.x} ${line.text.y})`} fontSize={px(11)} pointerEvents="none"
        paintOrder="stroke" strokeWidth={px(3)} strokeLinejoin="round" fontWeight={measured ? 600 : undefined}
        className={`${haloClass} ${measured ? measuredTextClass : calculatedText}`}>
        {text}
      </text>
    </g>
  )
}
