// Bottom tool-hint bar (plan 7.2 #9): one line of hints for the active tool.
import { useUi } from '../model/store'
import type { ToolId } from '../model/types'

const HINTS: Record<ToolId, string> = {
  select: 'Drag room to move · Shift+click = add to selection · Shift+drag = this room only (do not move shared walls) · Ctrl/Cmd+drag corner = resize room (+Shift uniform) · Alt = no snap · double-click a wall adds a vertex · Delete/Backspace deletes',
  pan: 'Drag the canvas to pan · scroll to pan · Ctrl/Cmd+scroll to zoom',
  rect: 'Drag on the canvas to draw a rectangle room · Alt bypasses snap',
  polygon: 'Click to add vertices · Enter closes the room · Backspace removes the last point · Esc cancels',
  slice: 'Click two points across a room to split it into two · Esc cancels',
  cutout: 'Drag to carve a rectangular cutout · Shift+click to start a polygon cutout · Esc cancels',
  'place-element': 'Click a wall to place the selected door / window / storage on it',
  calibrate: 'Click two points on a known length (e.g. a wall), then enter the real size · Esc cancels',
  tape: 'Click two points to record a point-to-point distance · Esc cancels',
  pin: 'Click anywhere to drop a note / photo pin',
}

export function ToolHints() {
  const tool = useUi((s) => s.tool)
  return (
    <div className="pointer-events-none min-w-[280px] max-w-full flex-1">
      <div className="w-fit max-w-full rounded-2xl border border-black/10 bg-white/90 px-3 py-1 text-xs leading-snug opacity-80 shadow-sm dark:border-white/15 dark:bg-[#1b2128]/90">
        {HINTS[tool]}
      </div>
    </div>
  )
}
