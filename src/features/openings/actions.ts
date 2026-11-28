// Store actions for openings (doors, windows). Each call is one undo step (or no step when nothing changes).
import { useDoc } from '../../model/store'
import type { Opening } from '../../model/types'

const findOpening = (artboardId: string, openingId: string) =>
  useDoc.getState().doc.artboards.find((a) => a.id === artboardId)?.openings.find((o) => o.id === openingId)

const mutate = (artboardId: string, openingId: string, fn: (o: Opening) => void) =>
  useDoc.getState().update((d) => { fn(d.artboards.find((a) => a.id === artboardId)!.openings.find((o) => o.id === openingId)!) })

export function addOpening(artboardId: string, opening: Opening): void {
  if (!useDoc.getState().doc.artboards.some((a) => a.id === artboardId)) return
  useDoc.getState().update((d) => { d.artboards.find((a) => a.id === artboardId)!.openings.push(opening) })
}

export function updateOpening(artboardId: string, openingId: string, patch: Partial<Omit<Opening, 'id'>>): void {
  if (!findOpening(artboardId, openingId)) return
  mutate(artboardId, openingId, (o) => {
    Object.assign(o, patch)
    if ('color' in patch && patch.color === undefined) delete o.color
  })
}

export function flipOpeningHinge(artboardId: string, openingId: string): void {
  const o = findOpening(artboardId, openingId)
  if (!o) return
  const next = (o.hinge ?? 'left') === 'left' ? 'right' : 'left'
  mutate(artboardId, openingId, (x) => { x.hinge = next })
}

export function flipOpeningSwing(artboardId: string, openingId: string): void {
  const o = findOpening(artboardId, openingId)
  if (!o) return
  const next = (o.swing ?? 'in') === 'in' ? 'out' : 'in'
  mutate(artboardId, openingId, (x) => { x.swing = next })
}

export function deleteOpening(artboardId: string, openingId: string): void {
  if (!findOpening(artboardId, openingId)) return
  useDoc.getState().update((d) => {
    const a = d.artboards.find((x) => x.id === artboardId)!
    a.openings = a.openings.filter((o) => o.id !== openingId)
  })
}
