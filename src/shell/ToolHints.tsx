// Bottom tool-hint bar (plan 7.2 #9): one line of hints for the active tool.
// On a phone the bar keeps ONE line (the rest is cut with an ellipsis) and a tap opens the full
// text (docs/ui-test-report-r2.md R2-9, suggestion 4). Desktop is unchanged.
import { useState } from 'react'
import { useDoc, useUi } from '../model/store'
import type { ToolId } from '../model/types'
import { isV2Doc } from '../model/v2/targets'
import { useToast } from '../features/toast'
import { useIsDesktop } from './useDesktop'

const HINTS: Record<ToolId, string> = {
  select: 'Drag room to move · Shift+click = add to selection · drag on empty space = box select · Shift+drag = this room only (do not move shared walls) · Ctrl/Cmd+drag corner = resize room (+Shift uniform) · Alt = no snap · double-click a wall adds a vertex · double-click a length to type the measured value · Delete/Backspace deletes',
  pan: 'Drag the canvas to pan · scroll to pan · Ctrl/Cmd+scroll to zoom',
  rect: 'Drag on the canvas to draw a rectangle room · Alt bypasses snap',
  polygon: 'Click to add vertices · Enter closes the room · Backspace removes the last point · Esc cancels',
  wall: 'Click to start a wall, each click adds a segment · type a length, Tab = angle, Enter places it · S = centre / side A / side B · double-click or Enter ends · Backspace removes the last point · Esc cancels · Alt = no snap',
  'make-room': 'Click inside an area closed by walls to make a room · the area under the pointer is previewed · Esc = Select',
  slice: 'Click two points across a room to split it into two · Esc cancels',
  cutout: 'Drag to carve a rectangular cutout · Shift+click to start a polygon cutout · Esc cancels',
  'place-element': 'Click a wall to place the selected door / window on it',
  'place-storage': 'Click a room wall to place built-in storage on its outer side · Esc = Select',
  calibrate: 'Click two points on a known length (e.g. a wall), then enter the real size · Esc cancels',
  tape: 'Click two points to record a point-to-point distance · Esc cancels',
  pin: 'Click anywhere to drop a note / photo pin',
}

/** Select tool hint for v2 documents (Shift+drag on a floor draws a selection box). */
const SELECT_V2_HINT =
  'Drag room to move · Shift+click = add or remove room/wall · drag on empty space = box select · Shift+drag on floor = box add to selection · Ctrl/Cmd+drag corner = resize room (+Shift uniform) · Alt = no snap · double-click a wall adds a vertex · double-click a length to type the measured value · Delete/Backspace deletes'

/** Measuring Mode has no editing tool: its own hint. */
const MEASURE_HINT = 'Click a wall to type its length · hover a wall to find its field · drag to pan · scroll to zoom'

const BOX =
  'rounded-2xl border border-black/10 bg-white/90 px-3 py-1 text-xs leading-snug opacity-80 shadow-sm dark:border-white/15 dark:bg-[#1b2128]/90'

export type ToolHintsViewProps = {
  hint: string
  /** Phone: one line, cut with an ellipsis, and a tap opens the full text. */
  compact: boolean
  /** A toast covers the bottom of the screen on phones: hide the bar. */
  hiddenWhileToast?: boolean
}

/** The bar itself. Pure enough to render without the stores (tests, screenshots). */
export function ToolHintsView({ hint, compact, hiddenWhileToast = false }: ToolHintsViewProps) {
  const [open, setOpen] = useState(false)
  const hide = hiddenWhileToast ? ' max-md:hidden' : ''
  if (compact) {
    return (
      // Open: the bar takes its own full-width row, so the text does not wrap in a narrow column.
      <div className={`min-w-0 max-w-full flex-1${open ? ' basis-full' : ''}${hide}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-label="Tool hints"
          data-tool-hints-expanded={open || undefined}
          onClick={() => setOpen((v) => !v)}
          className={`pointer-events-auto block max-w-full text-left ${open ? 'w-full' : ''} ${BOX}`}
        >
          <span className={`block ${open ? '' : 'truncate'}`}>{hint}</span>
        </button>
      </div>
    )
  }
  return (
    <div className={`pointer-events-none min-w-[280px] max-w-full flex-1${hide}`}>
      <div className={`w-fit max-w-full ${BOX}`}>{hint}</div>
    </div>
  )
}

export function ToolHints() {
  const tool = useUi((s) => s.tool)
  const measuring = useUi((s) => s.mode === 'measure')
  const v2 = useDoc((s) => isV2Doc(s.doc))
  const hasToast = useToast((s) => s.toasts.length > 0)
  const isDesktop = useIsDesktop()
  const hint = measuring ? MEASURE_HINT : tool === 'select' && v2 ? SELECT_V2_HINT : HINTS[tool]
  return <ToolHintsView hint={hint} compact={!isDesktop} hiddenWhileToast={hasToast} />
}
