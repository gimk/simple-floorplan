// Bottom tool-hint bar (plan 7.2 #9): one line of hints for the active tool.
import { useUi } from '../model/store'
import type { ToolId } from '../model/types'

const HINTS: Record<ToolId, string> = {
  select: 'Drag to move · double-click a wall to add a vertex · Del deletes the selection · B flips wall bearing',
  pan: 'Drag the canvas to pan · scroll to pan · Ctrl+scroll to zoom',
  rect: 'Drag on the canvas to draw a rectangle room · Alt bypasses snap',
  polygon: 'Click to add vertices · Enter closes the room · Backspace removes the last point · Esc cancels',
  slice: 'Drag a line across a room to split it into two · Esc cancels',
  cutout: 'Drag to carve a rectangular cutout · Shift+drag for a polygon cutout · Esc cancels',
  'place-element': 'Click a wall to place the selected door / window / storage on it',
  calibrate: 'Click two points on a known length (e.g. a wall), then enter the real size · Esc cancels',
  tape: 'Click two points to record a point-to-point distance · Esc cancels',
  pin: 'Click anywhere to drop a note / photo pin',
}

export function ToolHints() {
  const tool = useUi((s) => s.tool)
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[46%] -translate-x-1/2 truncate rounded-full border border-black/10 bg-white/90 px-3 py-1 text-xs opacity-80 shadow-sm dark:border-white/15 dark:bg-[#1b2128]/90 max-md:left-3 max-md:max-w-[calc(100%-7rem)] max-md:translate-x-0">
      {HINTS[tool]}
    </div>
  )
}
