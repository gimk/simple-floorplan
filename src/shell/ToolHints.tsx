// Bottom tool-hint bar (plan 7.2 #9): one line of hints for the active tool.
import { useDoc, useUi } from '../model/store'
import type { ToolId } from '../model/types'
import { isV2Doc } from '../model/v2/targets'
import { useToast } from '../features/toast'

const HINTS: Record<ToolId, string> = {
  select: 'Drag room to move · Shift+click = add to selection · drag on empty space = box select · Shift+drag = this room only (do not move shared walls) · Ctrl/Cmd+drag corner = resize room (+Shift uniform) · Alt = no snap · double-click a wall adds a vertex · Delete/Backspace deletes',
  pan: 'Drag the canvas to pan · scroll to pan · Ctrl/Cmd+scroll to zoom',
  rect: 'Drag on the canvas to draw a rectangle room · Alt bypasses snap',
  polygon: 'Click to add vertices · Enter closes the room · Backspace removes the last point · Esc cancels',
  wall: 'Click to start a wall, each click adds a segment · double-click or Enter ends · Backspace removes the last point · Esc cancels · Alt = no snap',
  'make-room': 'Click inside an area closed by walls to make a room · the area under the pointer is previewed · Esc = Select',
  slice: 'Click two points across a room to split it into two · Esc cancels',
  cutout: 'Drag to carve a rectangular cutout · Shift+click to start a polygon cutout · Esc cancels',
  'place-element': 'Click a wall to place the selected door / window / storage on it',
  calibrate: 'Click two points on a known length (e.g. a wall), then enter the real size · Esc cancels',
  tape: 'Click two points to record a point-to-point distance · Esc cancels',
  pin: 'Click anywhere to drop a note / photo pin',
}

/** Select tool hint for v2 documents (Shift+drag on a floor draws a selection box). */
const SELECT_V2_HINT =
  'Drag room to move · Shift+click = add or remove room/wall · drag on empty space = box select · Shift+drag on floor = box add to selection · Ctrl/Cmd+drag corner = resize room (+Shift uniform) · Alt = no snap · double-click a wall adds a vertex · Delete/Backspace deletes'

/** Measuring Mode has no editing tool: its own hint. */
const MEASURE_HINT = 'Click a wall to type its length · hover a wall to find its field · drag to pan · scroll to zoom'

export function ToolHints() {
  const tool = useUi((s) => s.tool)
  const measuring = useUi((s) => s.mode === 'measure')
  const v2 = useDoc((s) => isV2Doc(s.doc))
  const hasToast = useToast((s) => s.toasts.length > 0)
  const hint = measuring ? MEASURE_HINT : tool === 'select' && v2 ? SELECT_V2_HINT : HINTS[tool]
  return (
    <div className={`pointer-events-none min-w-[280px] max-w-full flex-1${hasToast ? ' max-md:hidden' : ''}`}>
      <div className="w-fit max-w-full rounded-2xl border border-black/10 bg-white/90 px-3 py-1 text-xs leading-snug opacity-80 shadow-sm dark:border-white/15 dark:bg-[#1b2128]/90">
        {hint}
      </div>
    </div>
  )
}
