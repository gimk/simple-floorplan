// Compact floating tool bar: Plan mode has Select V, Rectangle R, Pen P, Cutout X, Tape M.
// Design mode has no drawing tools, so it shows a tiny pill with only Select V and Tape M.
// Keyboard: the bar is one tab stop (roving tabindex); Left / Right move between tools.
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { MousePointer2, PenTool, Ruler, Scissors, Square } from 'lucide-react'
import { useUi } from '../../shell/uiStore'
import type { Tool } from '../../shell/uiStore'

type ToolButton = { tool: Tool; label: string; key: string; icon: ReactNode; group: 'select' | 'draw' | 'measure' }
const ICON = 20
const TOOLS: ToolButton[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: <MousePointer2 size={ICON} aria-hidden="true" />, group: 'select' },
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: <Square size={ICON} aria-hidden="true" />, group: 'draw' },
  { tool: 'pen', label: 'Pen', key: 'P', icon: <PenTool size={ICON} aria-hidden="true" />, group: 'draw' },
  { tool: 'cutout', label: 'Cutout', key: 'X', icon: <Scissors size={ICON} aria-hidden="true" />, group: 'draw' },
  { tool: 'tape', label: 'Tape', key: 'M', icon: <Ruler size={ICON} aria-hidden="true" />, group: 'measure' },
]

/** Design mode can measure, but it draws no rooms: only Select and Tape. */
const DESIGN_TOOLS: typeof TOOLS = TOOLS.filter((t) => t.tool === 'select' || t.tool === 'tape')

export function PlanToolbar() {
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const set = useUi((s) => s.set)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode !== 'plan') return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      // 'M' is left to the app shortcut, which toggles the tape tool in both modes; a second
      // listener here would set it and the toggle would undo it at once.
      const t = TOOLS.find((x) => x.tool !== 'tape' && x.key.toLowerCase() === e.key.toLowerCase())
      if (t) set({ tool: t.tool })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, set])

  const tools = mode === 'plan' ? TOOLS : DESIGN_TOOLS
  // Roving tabindex: the active tool is the tab stop; if it is not in this bar, the first tool is.
  const stop = tools.some((t) => t.tool === tool) ? tool : tools[0].tool

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    const buttons = [...(barRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    if (buttons.length === 0) return
    const cur = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next = cur
    if (e.key === 'ArrowRight') next = (cur + 1 + buttons.length) % buttons.length
    else if (e.key === 'ArrowLeft') next = (cur - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') next = 0
    else next = buttons.length - 1
    e.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <div
      ref={barRef}
      data-testid="plan-toolbar"
      role="toolbar"
      aria-label={mode === 'plan' ? 'Plan tools' : 'Design tools'}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="pointer-events-auto absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-surface-2/95 p-1 shadow-xl backdrop-blur max-md:bottom-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {tools.map((t, i) => {
        const active = tool === t.tool
        const divider = i > 0 && tools[i - 1].group !== t.group
        return (
          <div key={t.tool} className="flex items-center gap-1">
            {divider && <div className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />}
            <button
              type="button"
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-keyshortcuts={t.key}
              aria-pressed={active}
              tabIndex={stop === t.tool ? 0 : -1}
              onClick={() => set({ tool: t.tool })}
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors pointer-coarse:h-11 pointer-coarse:w-11 ${
                active ? 'bg-orange-500/20 text-orange-300 ring-1 ring-inset ring-orange-400/50' : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              {t.icon}
              <span className="absolute bottom-0.5 right-1 text-[10px] leading-none text-slate-400 max-md:hidden" aria-hidden="true">
                {t.key}
              </span>
              {active && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-orange-400" aria-hidden="true" />
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
