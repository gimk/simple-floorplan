// Canvas View menu: a small eye button next to the zoom pill. It opens a popover with every
// layer and every measurement setting, so the survey helpers (room codes, wall numbers) can be
// switched from the canvas.
// Click outside or Esc closes it; no browser dialog.
//
// Layout (visual review V-4): on a wide screen the popover is TWO columns (Layers left,
// Measurements right) of 520 px, each column its own scroll box with a fade hint at the bottom
// while it holds more content below (the app hides scroll bars, so a bare clipped column gave no
// clue). On a phone it is a full-width bottom sheet with ONE column, scrolled as a whole.
// There is no ancestor that would make `position: fixed` resolve against it (no transform, filter,
// backdrop-filter or containment on the way up: checked App.tsx, the pill row and Viewport), so
// the sheet needs no portal.
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Eye, X } from 'lucide-react'
import { LayerCheckboxes, LayerModeRows } from './LayerControls'
import { MeasureDisplayControls } from './MeasureDisplayControls'

// 36 px target with a mouse, 44 px on a coarse pointer (same as the other canvas pills).
const BTN = 'flex h-9 min-w-9 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 max-md:h-11 max-md:min-w-11'

/**
 * True when a scroll box holds more content below its visible part, which is what shows the fade
 * hint. The app hides every scroll bar (`index.css`), so this hint is the only sign of a scroll.
 * 2 px of slack, so a rounding difference never shows the fade on a box that fits.
 */
export function moreBelow(m: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight > 2
}

/**
 * Follow a scroll box and say when it has more content below. The listener is only added while the
 * menu is open. Nothing happens on the server (`renderToString`): no ref, no scroll, no hint.
 */
function useMoreBelow<T extends HTMLElement>(active: boolean): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    const update = () => setMore(moreBelow(el))
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [active])
  return [ref, more]
}

/**
 * The hint under a scroll box: a hairline and a fade of the popover background, so the last row
 * fades out and the user sees that the column continues. `sticky bottom-0` keeps it at the bottom
 * edge while the box scrolls. `aria-hidden`: it is a visual hint, the content is the information.
 */
function ScrollFade({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div
      aria-hidden="true"
      data-scroll-fade=""
      className="pointer-events-none sticky bottom-0 -mt-4 h-4 border-t border-black/10 bg-gradient-to-t from-white to-transparent dark:border-white/15 dark:from-[#1b2128]"
    />
  )
}

/**
 * One titled column of the popover. A wide screen gives it its own scroll box (`md:overflow-y-auto`,
 * so the two columns scroll apart) and a phone lets it grow: the sheet itself scrolls.
 */
function Column({ title, tag, active, className, children }: {
  title: string
  tag: string
  active: boolean
  className: string
  children: ReactNode
}) {
  const [ref, more] = useMoreBelow<HTMLDivElement>(active)
  return (
    <div className={`flex flex-col ${className}`} data-view-column={tag}>
      <h2 className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{title}</h2>
      <div ref={ref} className="md:min-h-0 md:overflow-y-auto md:pr-1">
        {children}
        <ScrollFade show={more} />
      </div>
    </div>
  )
}

/** The open popover: the header, then the two columns (one on a phone, where the sheet scrolls). */
function ViewSettingsPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [ref, more] = useMoreBelow<HTMLDivElement>(true)
  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label="View settings"
      data-view-panel=""
      // Wide: 520 px, two columns, capped height. Phone: a bottom sheet at full width, which
      // scrolls as one column. `max-md:inset-x-2` sets both left and right, so no `left-auto`
      // (that one turned the sheet into a narrow right-floating box, visual review V-4).
      className="absolute bottom-full left-0 z-20 mb-2 max-h-[75vh] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-black/10 bg-white p-3 shadow-xl md:flex md:max-h-[min(80vh,640px)] md:w-[520px] md:flex-col md:overflow-hidden max-md:fixed max-md:inset-x-2 max-md:bottom-2 max-md:mb-0 max-md:w-auto max-md:max-w-none max-md:rounded-xl max-md:shadow-2xl dark:border-white/15 dark:bg-[#1b2128]"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">View</h2>
        <button type="button" className={BTN} aria-label="Close view settings" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-3 md:min-h-0 md:flex-1 md:flex-row md:gap-4">
        <Column title="Layers" tag="layers" active className="md:min-h-0 md:min-w-0 md:flex-1">
          <LayerCheckboxes />
          <div className="my-2 h-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
          <LayerModeRows />
        </Column>
        {/* A thin rule between the two columns on a wide screen only. */}
        <div className="hidden w-px shrink-0 self-stretch bg-black/10 md:block dark:bg-white/15" aria-hidden="true" />
        <Column title="Measurements" tag="measurements" active className="md:min-h-0 md:min-w-0 md:flex-1">
          <MeasureDisplayControls />
        </Column>
      </div>
      <ScrollFade show={more} />
    </div>
  )
}

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

      {open && <ViewSettingsPanel id={popId} onClose={() => setOpen(false)} />}
    </div>
  )
}
