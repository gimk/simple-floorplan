// One dimension line on the plan, in the common dimension style (docs/measurements-plan.md):
// a thin line with a 45 degree tick at each end, and the value centred above the line on the side
// away from the wall. The layout comes from dimLine.ts (pure); this file only draws it.
//
// The line and its ticks never take a pointer event. The TEXT can be a target for two things only:
// the double-click that types a new length (docs/measurements-plan.md section 4), which
// `onTextDoubleClick` turns on, and the hover that shows the full breakdown of a measured value that
// the plan does not fit (`onTextPointerEnter` / `onTextPointerLeave`). `onTextPointerDown` lets a
// single press do what the plan does under the text (select or drag the room), so a click does not
// stop working when the text becomes clickable.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../../canvas/Viewport'
import { ESTIMATED_FILL, MEASURED_FILL, MISMATCH_FILL, SOLVED_FILL } from '../../../shell/panel/styles'
import type { ValueState } from '../../solver/lookup'
import type { DimLine } from './dimLine'

const lineClass = 'stroke-slate-500 dark:stroke-slate-400'
const haloClass = 'stroke-[#f6f7f5] dark:stroke-[#12161b]'

/**
 * Colour of a value, from its state (docs/solver-plan.md): green = measured, purple = solved,
 * grey = estimated, amber = measured but the plan does not fit it (`mismatch`). One token set for
 * the whole app (shell/panel/styles.ts).
 */
export const valueFill = (state: ValueState, mismatch = false): string =>
  state === 'measured' && mismatch
    ? MISMATCH_FILL
    : state === 'measured'
      ? MEASURED_FILL
      : state === 'solved'
        ? SOLVED_FILL
        : ESTIMATED_FILL

export type DimLineViewProps = {
  /** Layout of the line, from dimLine() / dimLineOfSpan(). */
  line: DimLine
  /** The value, e.g. "412", "✓ 412" (it fits) or "~412" (it does not). */
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
  /**
   * The value is measured on site but the plan does not fit it (`fitsPlan`): amber, and the text
   * starts with "~". The breakdown of the value goes under it on hover and on selection.
   */
  mismatch?: boolean
  /** Pointer enters the TEXT: the plan shows the breakdown of a measured value that does not fit. */
  onTextPointerEnter?: () => void
  /** Pointer leaves the TEXT: the breakdown goes, when it is still this text that holds it. */
  onTextPointerLeave?: () => void
}

export function DimLineView({
  line, text, measured, state, kind, dimKey, onTextDoubleClick, onTextPointerDown, hideText,
  mismatch, onTextPointerEnter, onTextPointerLeave,
}: DimLineViewProps) {
  const { px } = useViewport()
  // The text is a pointer target only when it does something (nothing by default: read only).
  const target = !!(onTextDoubleClick || onTextPointerDown)
  // A label that only shows a breakdown on hover takes the pointer, but it is not a text to type.
  const hot = target || !!onTextPointerEnter || !!onTextPointerLeave
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
          pointerEvents={hot ? 'auto' : 'none'} style={target ? { cursor: 'text' } : undefined}
          onPointerDown={onTextPointerDown}
          onPointerEnter={onTextPointerEnter}
          onPointerLeave={onTextPointerLeave}
          onDoubleClick={onTextDoubleClick && ((e) => { e.stopPropagation(); onTextDoubleClick() })}
          data-dim-text={target ? dimKey : undefined} data-dim-state={shown}
          data-dim-mismatch={mismatch ? '' : undefined}
          paintOrder="stroke" strokeWidth={px(3)} strokeLinejoin="round" fontWeight={measured ? 600 : undefined}
          className={`${haloClass} ${valueFill(shown, mismatch)}`}>
          {text}
        </text>
      )}
    </g>
  )
}
