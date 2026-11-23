// Move the focus to a survey input after the room card may still be opening.
import { inputId } from './actions'

/**
 * Focus the input of a survey label, scroll it into view. The card of the room can open on
 * the next render, so the search tries again for a few frames.
 */
export function focusMeasureField(label: string, tries = 10) {
  if (typeof document === 'undefined') return
  const el = document.getElementById(inputId(label)) as HTMLInputElement | null
  if (el) {
    el.focus()
    el.select?.()
    el.scrollIntoView?.({ block: 'center' })
    return
  }
  if (tries > 0 && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => focusMeasureField(label, tries - 1))
}

/** Room id of a canvas selection (room, vertex, wall), or null. */
export const selectionRoomId = (s: { kind: string; roomId?: string } | null): string | null =>
  s && s.kind !== 'element' && s.roomId ? s.roomId : null
