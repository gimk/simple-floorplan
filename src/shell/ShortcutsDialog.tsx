// Keyboard shortcuts dialog (plan 7.2 #23): opened with `?` or the header button,
// closed with Esc, the close button, or a backdrop click.
import { useEffect, useRef, type RefObject } from 'react'
import { X } from 'lucide-react'

const ROWS: [string, string][] = [
  ['V / H / R / P / S / X / D / C / T / N', 'Select, Pan, Rectangle, Polygon, Slice, Cutout, Element, Calibrate, Tape, Pin'],
  ['Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z (or Ctrl+Y)', 'Undo · Redo'],
  ['Esc', 'Cancel in-progress points, then Select tool + clear selection'],
  ['0', 'Fit plan to view'],
  ['?', 'This shortcuts dialog'],
  ['Space + drag · middle-drag · two-finger drag', 'Pan'],
  ['Ctrl/Cmd + wheel · pinch', 'Zoom'],
  ['Alt (while drawing/dragging)', 'Bypass snap'],
  ['Drag a room (Select tool)', 'Move the room with its walls, cutouts and pins'],
  ['Shift + drag a room / wall / vertex', 'This room only: shared walls of other rooms do not follow'],
  ['Ctrl/Cmd + drag a corner', 'Resize the whole room from that corner (the opposite corner stays)'],
  ['Ctrl/Cmd + Shift + drag a corner', 'Resize the whole room with a uniform scale'],
  ['Enter / Backspace (Polygon tool)', 'Close room / remove last point'],
  ['Shift (Cutout tool)', 'Polygon cutout instead of rectangle'],
  ['Double-click a wall', 'Insert a vertex'],
  ['B (with a wall selected)', 'Toggle bearing / partition'],
  ['Delete / Backspace (with a selection)', 'Delete the selection'],
]

export function ShortcutsDialog({
  open,
  onClose,
  returnFocusTo,
}: {
  open: boolean
  onClose: () => void
  returnFocusTo?: RefObject<HTMLElement | null>
}) {
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        wasOpen.current = false
        const target = returnFocusTo?.current
        if (target && target.isConnected) target.focus()
      }
      return
    }
    wasOpen.current = true
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose, returnFocusTo])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/15 dark:bg-[#1b2128]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            autoFocus
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Close shortcuts dialog"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {ROWS.map(([keys, desc]) => (
              <tr key={keys} className="border-t border-black/5 dark:border-white/5">
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{keys}</td>
                <td className="px-2 py-1.5 opacity-80">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
