// Canvas View menu: a small eye button next to the zoom pill. It opens a popover with every
// layer, so the survey helpers (room codes, wall numbers) can be switched from the canvas.
// Click outside or Esc closes it; no browser dialog.
import { useEffect, useId, useRef, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { LayerCheckboxes, LayerModeRows } from './LayerControls'
import { MeasureDisplayControls } from './MeasureDisplayControls'

// 36 px target with a mouse, 44 px on a coarse pointer (same as the other canvas pills).
const BTN = 'flex h-9 min-w-9 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 max-md:h-11 max-md:min-w-11'

export type ViewMenuProps = {
  /** Start with the popover open (tests and screenshots). */
  defaultOpen?: boolean
}

/** Eye button + layer popover, drawn in screen space over the canvas. */
export function ViewMenu({ defaultOpen = false }: ViewMenuProps) {
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
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      btnRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    // Capture, so Esc closes the menu before the app clears the selection.
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={boxRef} className="pointer-events-auto relative shrink-0">
      <div className="flex items-center rounded-full border border-black/10 bg-white/95 px-1 py-1 shadow-md dark:border-white/15 dark:bg-[#1b2128]/95">
        <button
          ref={btnRef}
          type="button"
          className={BTN}
          aria-label="View settings"
          title="View settings"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <Eye size={16} />
        </button>
      </div>

      {open && (
        <div
          id={popId}
          role="dialog"
          aria-label="View settings"
          className="absolute bottom-full left-0 z-20 mb-2 max-h-[70vh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-black/10 bg-white p-3 shadow-xl max-md:fixed max-md:inset-x-2 max-md:bottom-2 max-md:left-auto max-md:mb-0 max-md:w-auto dark:border-white/15 dark:bg-[#1b2128]"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">Layers</h2>
            <button type="button" className={BTN} aria-label="Close view settings" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <LayerCheckboxes />
          <div className="my-2 h-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
          <LayerModeRows />
          <div className="my-2 h-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
          <h2 className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Measurements</h2>
          <MeasureDisplayControls />
        </div>
      )}
    </div>
  )
}
