// Empty-state onboarding card (plan 7.2 #2): shown when the doc has no rooms and no
// background image. Rendered as an HTML overlay centered over the canvas.
import { BrickWall, House, ImagePlus, Square } from 'lucide-react'
import { useDoc, useUi } from '../model/store'
import { loadDemoApartment } from '../features/measure/demo'

/** Click the Background panel's import button (owned by another feature). */
function focusBackgroundImport() {
  const btn = document.querySelector<HTMLButtonElement>('button[data-action="import-background"]')
  btn?.click()
}

export function EmptyState() {
  const hasRooms = useDoc((s) => s.doc.rooms.length > 0)
  const hasBg = useDoc((s) => !!s.doc.background)
  const hasTraces = useDoc((s) => (s.doc.traces?.length ?? 0) > 0)
  const setTool = useUi((s) => s.setTool)
  // Tracing walls on a blank plan: the card must not cover the canvas.
  const drawing = useUi((s) => s.tool === 'wall' || s.tool === 'make-room')
  if (hasRooms || hasBg || hasTraces || drawing) return null

  const btn =
    'flex h-10 min-w-36 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-sm font-medium shadow-sm hover:bg-black/5 dark:border-white/15 dark:bg-[#232a32] dark:hover:bg-white/10'
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl border border-black/10 bg-white/95 p-6 text-center shadow-lg dark:border-white/15 dark:bg-[#1b2128]/95">
        <div className="text-base font-semibold">Start your floorplan</div>
        <div className="text-sm opacity-70">Import a plan image, draw a room or trace walls, or load the demo apartment.</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" className={`${btn} !border-orange-600/40`} onClick={focusBackgroundImport}>
            <ImagePlus size={16} /> Import a plan image
          </button>
          <button type="button" className={btn} onClick={() => setTool('rect')}>
            <Square size={16} /> Draw a rectangle room
          </button>
          <button type="button" className={btn} onClick={() => setTool('wall')}>
            <BrickWall size={16} /> Trace walls
          </button>
          <button type="button" className={btn} onClick={() => loadDemoApartment()}>
            <House size={16} /> Load demo apartment
          </button>
        </div>
      </div>
    </div>
  )
}
