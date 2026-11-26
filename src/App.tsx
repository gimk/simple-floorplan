// v2 shell: top bar, left panel, SVG canvas, right Inspect panel, toast host.
import { Redo2, Undo2 } from 'lucide-react'
import { Viewport } from './canvas/Viewport'
import { ToastHost } from './features/toast'
import { CanvasGrid } from './shell/CanvasGrid'
import { Segmented } from './shell/panel'
import { initTheme } from './shell/theme'
import { useUi, type Mode } from './shell/uiStore'
import { ZoomControls } from './shell/ZoomControls'

initTheme()

const MODES: { value: Mode; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'design', label: 'Design' },
]

const BAR_BTN = 'flex h-9 w-9 items-center justify-center rounded-md text-zinc-300 hover:bg-white/10 disabled:opacity-40'

export default function App() {
  const mode = useUi((s) => s.mode)
  const setUi = useUi((s) => s.set)
  return (
    <div className="flex h-full flex-col bg-[#12161b] text-zinc-100">
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-white/10 bg-[#161b21] px-3">
        <h1 className="text-sm font-semibold">Simple Floorplan</h1>
        <Segmented
          ariaLabel="Mode"
          value={mode}
          options={MODES}
          onChange={(m) => setUi({ mode: m as Mode })}
          className="w-44"
        />
        <div className="flex justify-end gap-1">
          <button type="button" className={BAR_BTN} aria-label="Undo" title="Undo" disabled><Undo2 size={18} /></button>
          <button type="button" className={BAR_BTN} aria-label="Redo" title="Redo" disabled><Redo2 size={18} /></button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside aria-label="Left panel" data-testid="left-panel" className="hidden w-60 shrink-0 border-r border-white/10 bg-[#161b21] p-3 text-sm text-zinc-400 md:block">
          {mode === 'plan' ? 'Rooms and artboards' : 'Furniture'}
        </aside>
        <main className="relative min-w-0 flex-1">
          <Viewport>
            <CanvasGrid />
          </Viewport>
          <div className="pointer-events-none absolute bottom-3 left-3">
            <ZoomControls />
          </div>
        </main>
        <aside aria-label="Inspect" data-testid="inspect-panel" className="hidden w-70 shrink-0 border-l border-white/10 bg-[#161b21] p-3 text-sm text-zinc-400 lg:block">
          Inspect
        </aside>
      </div>
      <ToastHost />
    </div>
  )
}
