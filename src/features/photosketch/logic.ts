// Pure helpers for sketch-on-photo dimension overlays (docs/plan.md 7.4).
// A mark is stored NORMALISED (0..1 inside the photo) so it stays on the right spot at
// any display size. Nothing here touches React or the DOM: the dialog and the tests share it.
import { fmtCm } from '../../model/geometry'
import { allSurveyIds } from '../../model/survey'
import type { PhotoMark, Pin, PlanDoc } from '../../model/types'

export type PhotoPoint = { x: number; y: number }
/** Size of the drawn photo, in CSS pixels. */
export type PhotoBox = { w: number; h: number }

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Pixel position inside the drawn photo -> normalised 0..1 (clamped inside the photo). */
export const normPoint = (x: number, y: number, box: PhotoBox): PhotoPoint => ({
  x: box.w > 0 ? clamp01(x / box.w) : 0,
  y: box.h > 0 ? clamp01(y / box.h) : 0,
})

/** Normalised 0..1 -> pixel position inside the drawn photo. */
export const pxPoint = (p: PhotoPoint, box: PhotoBox): PhotoPoint => ({ x: p.x * box.w, y: p.y * box.h })

/** Marks of one photo of one pin. */
export const marksOf = (pin: Pin | undefined, photoKey: string | null | undefined): PhotoMark[] =>
  (photoKey ? pin?.sketches?.[photoKey] : undefined) ?? []

/** Number of marks on all photos of a pin (thumbnail badge). */
export const marksCount = (pin: Pin | undefined): number =>
  Object.values(pin?.sketches ?? {}).reduce((n, list) => n + list.length, 0)

/** Index of a photo in `pin.photoKeys`, or -1. */
export const photoIndexOf = (pin: Pin, photoKey: string): number => pin.photoKeys.indexOf(photoKey)

/** Middle of the arrow, in the photo's pixel box (where the value label goes). */
export const markMiddle = (mark: PhotoMark, box: PhotoBox): PhotoPoint => ({
  x: ((mark.a.x + mark.b.x) / 2) * box.w,
  y: ((mark.a.y + mark.b.y) / 2) * box.h,
})

/** Length of the arrow in the drawn photo, in CSS pixels (0 for a degenerate mark). */
export const markPixelLength = (mark: PhotoMark, box: PhotoBox): number => {
  const a = pxPoint(mark.a, box), b = pxPoint(mark.b, box)
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Append one mark. */
export const withMark = (marks: PhotoMark[], mark: PhotoMark): PhotoMark[] => [...marks, mark]

/** Change one mark (ignored when the id is unknown). */
export const withPatchedMark = (marks: PhotoMark[], id: string, patch: Partial<PhotoMark>): PhotoMark[] =>
  marks.map((m) => (m.id === id ? { ...m, ...patch } : m))

/** Drop one mark. */
export const withoutMark = (marks: PhotoMark[], id: string): PhotoMark[] => marks.filter((m) => m.id !== id)

/**
 * The whole `sketches` record with the marks of one photo replaced. The photo key is
 * dropped when it has no marks left, and the record becomes undefined when it is empty
 * (so the field disappears from saved documents).
 */
export function withPhotoMarks(
  pin: Pin,
  photoKey: string,
  marks: PhotoMark[],
): Record<string, PhotoMark[]> | undefined {
  const next: Record<string, PhotoMark[]> = { ...(pin.sketches ?? {}) }
  if (marks.length) next[photoKey] = marks
  else delete next[photoKey]
  return Object.keys(next).length ? next : undefined
}

/** Survey ID behind a mark's label, if it still exists in the document. */
export const surveyOfMark = (mark: PhotoMark, doc: PlanDoc) =>
  mark.label ? allSurveyIds(doc).find((s) => s.label === mark.label) : undefined

/**
 * Value shown for a mark, in cm: the measured value of the linked survey ID, else the
 * planned value of that ID, else the value typed on the mark. Null when unknown.
 */
export function markValueCm(mark: PhotoMark, doc: PlanDoc): number | null {
  const survey = surveyOfMark(mark, doc)
  if (survey) {
    const measured = doc.measurements?.[survey.label]?.actualCm
    if (measured != null && Number.isFinite(measured) && measured > 0) return measured
    if (survey.plannedCm != null && Number.isFinite(survey.plannedCm) && survey.plannedCm > 0) return survey.plannedCm
  }
  const own = mark.valueCm
  return own != null && Number.isFinite(own) && own > 0 ? own : null
}

/** Value label drawn on the photo: "412,5 cm", "SE-2" when nothing is known, "" when empty. */
export function markLabelText(mark: PhotoMark, doc: PlanDoc): string {
  const cm = markValueCm(mark, doc)
  if (cm != null) return `${fmtCm(cm)} cm`
  return mark.label ?? ''
}

/** Text of a mark, for lists and exports: "SE-2 · 412,5 cm". */
export function markSummary(mark: PhotoMark, doc: PlanDoc): string {
  const cm = markValueCm(mark, doc)
  const value = cm != null ? `${fmtCm(cm)} cm` : ''
  if (mark.label && value) return `${mark.label} · ${value}`
  return mark.label ?? value
}

/** True when the linked survey ID has a measured value on site. */
export const markIsMeasured = (mark: PhotoMark, doc: PlanDoc): boolean =>
  !!mark.label && doc.measurements?.[mark.label]?.actualCm != null

/** Survey IDs of the pin's room (empty when the pin has no room). */
export function surveyOptionsForPin(pin: Pin, doc: PlanDoc): { value: string; label: string }[] {
  const room = pin.roomId ? doc.rooms.find((r) => r.id === pin.roomId) : undefined
  if (!room) return []
  return allSurveyIds(doc)
    .filter((s) => s.roomId === room.id)
    .map((s) => {
      const measured = doc.measurements?.[s.label]?.actualCm
      const cm = measured != null ? measured : s.plannedCm
      return { value: s.label, label: cm != null ? `${s.label} · ${fmtCm(cm)} cm` : s.label }
    })
}

/** One CSV row per mark, in pin order then photo order. */
export function markRows(doc: PlanDoc): {
  pin: number
  roomCode: string
  photoIndex: number
  valueCm: number | null
  label: string
  note: string
}[] {
  const out: { pin: number; roomCode: string; photoIndex: number; valueCm: number | null; label: string; note: string }[] = []
  ;(doc.pins ?? []).forEach((pin, i) => {
    const room = pin.roomId ? doc.rooms.find((r) => r.id === pin.roomId) : undefined
    pin.photoKeys.forEach((key, photoIndex) => {
      for (const mark of pin.sketches?.[key] ?? []) {
        const cm = markValueCm(mark, doc)
        out.push({
          pin: i + 1,
          roomCode: room?.code ?? '',
          photoIndex: photoIndex + 1,
          valueCm: cm != null ? Math.round(cm * 10) / 10 : null,
          label: mark.label ?? '',
          note: mark.note ?? '',
        })
      }
    })
  })
  return out
}
