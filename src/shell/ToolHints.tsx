// Tool tips button and popover: a small "?" button at the right end of the floating tool bar
// (or next to ZoomControls in Measuring Mode) that opens a compact tips popover above the bar.
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { useDoc, useUi } from '../model/store'
import type { ToolId } from '../model/types'
import { isV2Doc } from '../model/v2/targets'
import { TOOLS } from './tools'

export type ToolTip = {
  keys: string
  action: string
}

export const TOOL_TIPS: Record<ToolId, ToolTip[]> = {
  select: [
    { keys: 'Shift+click', action: 'Add to selection' },
    { keys: 'Shift+drag', action: 'Move this room only (shared walls stay)' },
    { keys: 'Ctrl/Cmd+drag corner', action: 'Resize room (+Shift: uniform)' },
    { keys: 'Alt', action: 'No snap' },
    { keys: 'Double-click wall', action: 'Add a corner' },
    { keys: 'Double-click length', action: 'Type the measured value' },
  ],
  pan: [
    { keys: 'Ctrl/Cmd+scroll', action: 'Zoom' },
  ],
  rect: [
    { keys: 'Alt', action: 'No snap' },
  ],
  polygon: [
    { keys: 'Enter', action: 'Close the room' },
    { keys: 'Backspace', action: 'Remove the last point' },
  ],
  wall: [
    { keys: 'Type a number', action: 'Exact length' },
    { keys: 'Tab', action: 'Angle' },
    { keys: 'S', action: 'Centre / side A / side B' },
    { keys: 'Enter or double-click', action: 'End the wall' },
    { keys: 'Backspace', action: 'Remove the last point' },
    { keys: 'Alt', action: 'No snap' },
  ],
  'make-room': [
    { keys: 'Click', action: 'Inside an area closed by walls' },
  ],
  slice: [
    { keys: 'Click 2 points', action: 'Split the room' },
  ],
  cutout: [
    { keys: 'Shift+click', action: 'Start a polygon cutout' },
  ],
  'place-element': [],
  'place-storage': [
    { keys: 'Click a wall', action: 'Storage on its outer side' },
  ],
  calibrate: [
    { keys: 'Click 2 points', action: 'Then type the real length' },
  ],
  tape: [],
  pin: [],
}

/** Select tool tips for v2 documents (Shift+drag on a floor draws a selection box). */
export const SELECT_V2_TIPS: ToolTip[] = [
  { keys: 'Shift+click', action: 'Add or remove room / wall' },
  { keys: 'Shift+drag on floor', action: 'Box add to selection' },
  { keys: 'Ctrl/Cmd+drag corner', action: 'Resize room (+Shift: uniform)' },
  { keys: 'Alt', action: 'No snap' },
  { keys: 'Double-click wall', action: 'Add a corner' },
  { keys: 'Double-click length', action: 'Type the measured value' },
]

/** Measuring Mode has no editing tool: its own tip. */
export const MEASURE_TIPS: ToolTip[] = [
  { keys: 'Hover a wall', action: 'Find its field' },
]

export function getToolTips(tool: ToolId, opts?: { v2?: boolean; measuring?: boolean }): ToolTip[] {
  if (opts?.measuring) return MEASURE_TIPS
  if (tool === 'select' && opts?.v2) return SELECT_V2_TIPS
  return TOOL_TIPS[tool]
}

export function getToolTitle(tool: ToolId, measuring = false): string {
  if (measuring) return 'Measuring Mode'
  return TOOLS.find((t) => t.id === tool)?.label ?? tool
}

/** Close the tips popover on Escape before the app handles it. Returns true if handled. */
export function handleTipsKeyDown(
  e: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>,
  onClose: () => void,
): boolean {
  if (e.key !== 'Escape') return false
  e.preventDefault()
  e.stopPropagation()
  onClose()
  return true
}

export type ToolTipsButtonProps = {
  /** Opens the full keyboard shortcuts dialog from the popover footer. */
  onOpenShortcuts?: () => void
  /** Render inside its own floating pill (Measuring Mode) instead of after a toolbar separator. */
  pill?: boolean
  /** Start open (for tests only; never set in production). */
  defaultOpen?: boolean
}

export function ToolTipsButton({ onOpenShortcuts, pill = false, defaultOpen = false }: ToolTipsButtonProps) {
  const tool = useUi((s) => s.tool)
  const measuring = useUi((s) => s.mode === 'measure')
  const v2 = useDoc((s) => isV2Doc(s.doc))
  const items = getToolTips(tool, { v2, measuring })
  const title = getToolTitle(tool, measuring)

  const [open, setOpen] = useState(defaultOpen)
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popId = useId()

  // Close on tool or mode change.
  useEffect(() => {
    setOpen(false)
  }, [tool, measuring])

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

  if (items.length === 0) return null

  const button = (
    <button
      ref={btnRef}
      type="button"
      title="Tips for this tool"
      aria-label="Tips for this tool"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? popId : undefined}
      onClick={() => setOpen((v) => !v)}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-black/5 hover:text-slate-800 max-md:h-11 max-md:w-11 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
    >
      <CircleHelp size={16} />
    </button>
  )

  return (
    <>
      {!pill && <div className="mx-0.5 h-5 w-px shrink-0 bg-black/10 dark:bg-white/15" aria-hidden="true" />}
      <div ref={boxRef} className="pointer-events-auto relative shrink-0">
        {pill ? (
          <div className="flex items-center rounded-full border border-black/10 bg-white/95 p-1 shadow-md dark:border-white/15 dark:bg-[#1b2128]/95">
            {button}
          </div>
        ) : (
          button
        )}
        {open && (
          <div
            id={popId}
            role="dialog"
            aria-label={`${title} tips`}
            className="absolute bottom-full right-0 z-20 mb-2 w-[min(320px,calc(100vw-16px))] max-w-[320px] rounded-lg border border-black/10 bg-white p-3 text-left shadow-xl dark:border-white/15 dark:bg-[#1b2128]"
          >
            <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">{title}</div>
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
              {items.map((item) => (
                <Fragment key={item.keys}>
                  <dt className="shrink-0">
                    <kbd className="inline-block rounded border border-black/15 bg-black/[0.03] px-1.5 py-0.5 font-mono text-[11px] leading-tight text-slate-700 dark:border-white/20 dark:bg-white/[0.06] dark:text-slate-200">
                      {item.keys}
                    </kbd>
                  </dt>
                  <dd className="text-xs leading-snug text-slate-700 dark:text-slate-200">{item.action}</dd>
                </Fragment>
              ))}
            </dl>
            {onOpenShortcuts && (
              <div className="mt-2.5 border-t border-black/10 pt-2 dark:border-white/10">
                <button
                  type="button"
                  className="text-xs font-medium text-orange-700 hover:underline dark:text-orange-400"
                  onClick={() => {
                    setOpen(false)
                    onOpenShortcuts()
                  }}
                >
                  All shortcuts
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
