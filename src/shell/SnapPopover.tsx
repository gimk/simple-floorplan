// Snap settings popover in the header (plan 7.2 #10): grid on/off, 1/5/10 cm step,
// angle snapping, vertex snapping.
import { useEffect, useRef, useState } from 'react'
import { Magnet } from 'lucide-react'
import { useUi } from '../model/store'

const STEPS = [1, 5, 10]

export function SnapPopover() {
  const snap = useUi((s) => s.snap)
  const set = useUi((s) => s.set)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const check = (k: 'grid' | 'angles' | 'vertices') => (
    <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={`snap-${k}`}
        className="h-4 w-4 accent-orange-600"
        checked={snap[k]}
        onChange={(e) => set({ snap: { ...snap, [k]: e.target.checked } })}
      />
      {k === 'grid' ? 'Grid' : k === 'angles' ? 'Angles (90°/45°)' : 'Vertices'}
    </label>
  )

  const anyOn = snap.grid || snap.angles || snap.vertices
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`relative flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 ${anyOn ? '' : 'opacity-60'}`}
        aria-label="Snap settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Snap settings"
        onClick={() => setOpen((o) => !o)}
      >
        <Magnet size={16} />
        {anyOn && <span className="h-1.5 w-1.5 rounded-full bg-orange-700 dark:bg-orange-400" aria-hidden="true" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-black/10 bg-white p-3 shadow-lg dark:border-white/15 dark:bg-[#1b2128]">
          <div className="mb-1 text-xs font-semibold uppercase opacity-60">Snap</div>
          {check('grid')}
          <div className={`ml-6 flex items-center gap-2 ${snap.grid ? '' : 'opacity-40'}`}>
            {STEPS.map((s) => (
              <label key={s} className="flex h-9 cursor-pointer items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="gridCm"
                  className="h-4 w-4 accent-orange-600"
                  disabled={!snap.grid}
                  checked={snap.gridCm === s}
                  onChange={() => set({ snap: { ...snap, gridCm: s } })}
                />
                {s} cm
              </label>
            ))}
          </div>
          {check('angles')}
          {check('vertices')}
        </div>
      )}
    </div>
  )
}
