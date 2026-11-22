// Pure helpers for the "add a reference surface" form of the apartment panel.
// No React, no store: the panel keeps the draft in state and calls buildReference().
import type { SurfaceReference, SurfaceReferenceSource } from '../../model/types'

export type ReferenceDraft = {
  source: SurfaceReferenceSource
  /** Parsed by NumberField, so already a number or null (empty field). */
  surfaceM2: number | null
  /** Room code, '' for the whole apartment. */
  roomCode: string
  label: string
  date: string
  note: string
}

export const EMPTY_REFERENCE_DRAFT: ReferenceDraft = {
  source: 'dpe',
  surfaceM2: null,
  roomCode: '',
  label: '',
  date: '',
  note: '',
}

/**
 * Turn the form draft into a reference, or null when the surface is not a positive
 * number (the panel then shows its error message instead of adding the reference).
 * Optional text fields are trimmed and dropped when empty, like the old form did.
 */
export function buildReference(draft: ReferenceDraft, id: string): SurfaceReference | null {
  const surfaceM2 = draft.surfaceM2
  if (surfaceM2 === null || !Number.isFinite(surfaceM2) || surfaceM2 <= 0) return null
  const label = draft.label.trim()
  const note = draft.note.trim()
  return {
    id,
    source: draft.source,
    surfaceM2,
    ...(label ? { label } : {}),
    ...(draft.roomCode ? { roomCode: draft.roomCode } : {}),
    ...(draft.date ? { date: draft.date } : {}),
    ...(note ? { note } : {}),
  }
}

/** The draft after a successful add: the source and the room stay, the rest is cleared. */
export function draftAfterAdd(draft: ReferenceDraft): ReferenceDraft {
  return { ...draft, surfaceM2: null, label: '', date: '', note: '' }
}
