// Top banner of Measuring Mode (docs/solver-plan.md, round 3): is the solver On or Off, and the
// colour legend that goes with it (grey Plan, green Measured, purple Solved) with its "?" tip.
// The tip uses the same popover as the Solve tab, so both look the same.
import { useEffect, useId, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import type { PlanDoc } from '../../model/types'
import { handleTipsKeyDown } from '../../shell/ToolHints'
import { ESTIMATED_TEXT, MEASURED_TEXT, SOLVED_BG, SOLVED_BORDER, SOLVED_TEXT } from '../../shell/panel/styles'
import type { ValueState } from '../solver/lookup'

/** Solver On: the solver runs when the user leaves Measuring Mode. */
export const SOLVER_ON_TEXT = 'Solver on. It fits the plan to your values when you leave Measuring Mode.'
/** Solver Off: only the Apply button (bottom of the mode) moves the plan. */
export const SOLVER_OFF_TEXT = 'Solver off. Your values change the plan only when you apply them (button at the bottom).'
/** Text of the legend "?" popover. */
export const LEGEND_TIP_TEXT =
  'Plan: the length drawn on the plan, an estimate. Measured: the value you typed. ' +
  'Solved: the length after the solver fitted the whole plan to all measured values. ' +
  'Turn the solver on or off in the Solve tab.'

/** One legend item: a dot and a word, both in the colour of its token. */
function LegendItem({ word, token, state }: { word: string; token: string; state: ValueState }) {
  return (
    <span data-value-state={state} className={`flex items-center gap-1 ${token}`}>
      <span aria-hidden="true" data-value-state={state} className={`h-2.5 w-2.5 flex-none rounded-full bg-current ${token}`} />
      {word}
    </span>
  )
}

/** Small "?" button and popover: what Plan, Measured and Solved mean. */
export function LegendTip({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (handleTipsKeyDown(e, () => setOpen(false))) btnRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        title="What the colours mean"
        aria-label="What the colours mean"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-black/5 hover:text-slate-800 pointer-coarse:h-9 pointer-coarse:w-9 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
      >
        <CircleHelp size={14} />
      </button>
      {open && (
        <div
          id={popId}
          role="dialog"
          aria-label="What the colours mean"
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-black/10 bg-white p-3 text-left text-xs shadow-xl dark:border-white/15 dark:bg-[#1b2128]"
        >
          <p className="leading-snug text-slate-600 dark:text-slate-300">{LEGEND_TIP_TEXT}</p>
        </div>
      )}
    </div>
  )
}

/** The legend under the banner text: Plan (grey), Measured (green), Solved (purple), and its tip. */
export function SolverLegend({ tipDefaultOpen = false }: { tipDefaultOpen?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium" data-solver-legend="">
      <LegendItem word="Plan" token={ESTIMATED_TEXT} state="estimated" />
      <LegendItem word="Measured" token={MEASURED_TEXT} state="measured" />
      <LegendItem word="Solved" token={SOLVED_TEXT} state="solved" />
      <LegendTip defaultOpen={tipDefaultOpen} />
    </div>
  )
}

/**
 * Solver state banner + legend, at the top of Measuring Mode (desktop panel and phone view).
 * Purple box when the solver is On, muted slate box when it is Off.
 */
export function SolverBanner({ doc, tipDefaultOpen = false }: { doc: PlanDoc; tipDefaultOpen?: boolean }) {
  const on = Boolean(doc.solver?.enabled)
  return (
    <div
      data-solver-banner={on ? 'on' : 'off'}
      data-value-state={on ? 'solved' : undefined}
      className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs ${
        on
          ? `${SOLVED_BG} ${SOLVED_TEXT} ${SOLVED_BORDER}`
          : 'border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-[#12161b] dark:text-slate-300'
      }`}
    >
      <p className="leading-snug">{on ? SOLVER_ON_TEXT : SOLVER_OFF_TEXT}</p>
      <SolverLegend tipDefaultOpen={tipDefaultOpen} />
    </div>
  )
}
