// Move the focus to a survey input after the room card may still be opening.
// Shared by the desktop measure panel and the full-screen Measuring Mode (review finding 16):
// both remember the last field that had the focus, and both show every room again when the next
// field is in a room that the filter hides.
import { useEffect, useRef, type RefObject } from 'react'
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

/** A focused survey field has an id of the form `m-SE-3`: the label is the part after `m-`. */
const FIELD_PREFIX = 'm-'

/** Label of a field element id, or null when the element is not a survey field. */
export const labelOfFieldId = (id: string | undefined): string | null =>
  id && id.startsWith(FIELD_PREFIX) ? id.slice(FIELD_PREFIX.length) : null

/** The label the "Next unmeasured" jump starts from: the focused field, else the last one. */
export function startLabel(focusedId: string | undefined, lastLabel: string | null): string | null {
  return labelOfFieldId(focusedId) ?? lastLabel
}

/**
 * Remember the last survey field that had the focus, so "Next unmeasured" continues after it and
 * not from the first missing value of the plan.
 */
export function useLastFocusedLabel(): RefObject<string | null> {
  const ref = useRef<string | null>(null)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onFocusIn = (e: FocusEvent) => {
      const label = labelOfFieldId(e.target instanceof HTMLElement ? e.target.id : undefined)
      if (label) ref.current = label
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])
  return ref
}

/**
 * Focus the field of `label`. When that field is not on the page (its room is hidden by the
 * filter), call `showAll` first and try again on the next frame.
 */
export function jumpToMeasureField(label: string, showAll: () => void) {
  const el = typeof document === 'undefined' ? null : document.getElementById(inputId(label))
  if (el) {
    focusMeasureField(label)
    return
  }
  showAll()
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => focusMeasureField(label))
  else focusMeasureField(label)
}
