// Compact floating tool bar (Plan mode only): Select V, Rectangle R, Pen P, Cutout X.
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useUi } from '../../shell/uiStore'
import type { Tool } from '../../shell/uiStore'

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: <path {...stroke} d="M5 3l12 6-5 2-2 5z" /> },
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: <rect {...stroke} x="3.5" y="5" width="13" height="10" rx="1" /> },
  { tool: 'pen', label: 'Pen', key: 'P', icon: <path {...stroke} d="M4 16l1-4 8-8 3 3-8 8zM12 5l3 3" /> },
  { tool: 'cutout', label: 'Cutout', key: 'X', icon: <path {...stroke} d="M3.5 3.5h7v7h-7zM8 8h8.5v8.5H8z" strokeDasharray="2 2" /> },
]

export function PlanToolbar() {
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const set = useUi((s) => s.set)

  useEffect(() => {
    if (mode !== 'plan') return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (t) set({ tool: t.tool })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, set])

  if (mode !== 'plan') return null
  return (
    <div
      data-testid="plan-toolbar"
      role="toolbar"
      aria-label="Plan tools"
      className="pointer-events-auto fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 gap-1 rounded-xl border border-white/15 bg-[#12161b]/95 p-1 shadow-xl backdrop-blur"
    >
      {TOOLS.map((t) => {
        const active = tool === t.tool
        return (
          <button
            key={t.tool}
            type="button"
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            aria-pressed={active}
            onClick={() => set({ tool: t.tool })}
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              active ? 'bg-orange-500/20 text-orange-300' : 'text-slate-300 hover:bg-white/10'
            }`}
          >
            <svg viewBox="0 0 20 20" width="20" height="20">{t.icon}</svg>
            <span className="absolute bottom-0.5 right-1 text-[8px] leading-none text-slate-500">{t.key}</span>
          </button>
        )
      })}
    </div>
  )
}
