// One dimension line on the plan, in the common dimension style (docs/measurements-plan.md):
// a thin line with a 45 degree tick at each end, and the value centred above the line on the side
// away from the wall. The layout comes from dimLine.ts (pure); this file only draws it.
//
// The line and its ticks never take a pointer event. The TEXT can be a target for one thing only:
// the double-click that types a new length (docs/measurements-plan.md section 4). `onTextDoubleClick`
// turns that on; `onTextPointerDown` lets a single press do what the plan does under the text
// (select or drag the room), so a click does not stop working when the text becomes clickable.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../../canvas/Viewport'
import { ESTIMATED_FILL, MEASURED_FILL, SOLVED_FILL } from '../../../shell/panel/styles'
import type { ValueState } from '../../solver/lookup'
import type { DimLine } from './dimLine'

const lineClass = 'stroke-slate-500 dark:stroke-slate-400'
const haloClass = 'stroke-[#f6f7f5] dark:stroke-[#12161b]'

/**
 * Colour of a value, from its state (docs/solver-plan.md): green = measured, purple = solved,
 * grey = estimated. One token set for the whole app (shell/panel/styles.ts).
 */
export const valueFill = (state: ValueState): string =>
  state === 'measured' ? MEASURED_FILL : state === 'solved' ? SOLVED_FILL : ESTIMATED_FILL

export type DimLineViewProps = {
  /** Layout of the line, from dimLine() / dimLineOfSpan(). */
  line: DimLine
  /** The value, e.g. "412" or "✓ 412 · 410,7". */
  text: string
  /** Measured value: green and bold (the common dimension style). */
  measured: boolean
  /**
   * State of the value (docs/solver-plan.md): green measured, purple solved, grey estimated. Absent:
   * the state follows `measured` (green when measured, grey otherwise).
   */
  state?: ValueState
  /** What the line belongs to: a wall length, the helper dimensions, or an outside chain row. */
  kind: 'wall' | 'helper' | 'outside'
  /** The wall or the face the line measures, for a test. */
  dimKey: string
  /** Double-click on the TEXT: opens the field that types the length of this face. */
  onTextDoubleClick?: () => void
  /** Press on the TEXT: the plan does under the text what a click there did before. */
  onTextPointerDown?: (e: ReactPointerEvent<SVGTextElement>) => void
  /** True while the field of that text is open: the field replaces the text (it is drawn above it). */
  hideText?: boolean
}

export function DimLineView({
  line, text, measured, state, kind, dimKey, onTextDoubleClick, onTextPointerDown, hideText,
}: DimLineViewProps) {
  const { px } = useViewport()
  // The text is a pointer target only when it does something (nothing by default: read only).
  const target = !!(onTextDoubleClick || onTextPointerDown)
  // Green measured, purple solved, grey estimated (docs/solver-plan.md).
  const shown: ValueState = state ?? (measured ? 'measured' : 'estimated')
  return (
    <g pointerEvents="none" data-dim={kind} data-dim-key={dimKey} data-dim-outside={line.outside ? '' : undefined}>
      <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} strokeWidth={px(1)} className={lineClass} />
      {line.ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth={px(1.5)} className={lineClass} />
      ))}
      {!hideText && (
        <text x={line.text.x} y={line.text.y} textAnchor="middle" dominantBaseline="middle"
          transform={`rotate(${line.angle} ${line.text.x} ${line.text.y})`} fontSize={px(11)}
          pointerEvents={target ? 'auto' : 'none'} style={target ? { cursor: 'text' } : undefined}
          onPointerDown={onTextPointerDown}
          onDoubleClick={onTextDoubleClick && ((e) => { e.stopPropagation(); onTextDoubleClick() })}
          data-dim-text={target ? dimKey : undefined} data-dim-state={shown}
          paintOrder="stroke" strokeWidth={px(3)} strokeLinejoin="round" fontWeight={measured ? 600 : undefined}
          className={`${haloClass} ${valueFill(shown)}`}>
          {text}
        </text>
      )}
    </g>
  )
}
