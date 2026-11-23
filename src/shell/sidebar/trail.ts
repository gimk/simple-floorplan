// Pure breadcrumb trail for the Inspect tab: Apartment › Room (code) › Wall / Vertex /
// Element / Tape / Pin. No store access here, so it is easy to test; Breadcrumb.tsx turns
// each crumb into a button and applies `select`.
import { roomWalls } from '../../model/geometry'
import type { PlanDoc, Selection } from '../../model/types'
import { KIND_LABEL } from '../../features/elements/geometry'

/** Tape/pin selection (own store, see features/annotations/selection.ts). */
export type AnnotSelection = { kind: 'tape' | 'pin'; id: string } | null

export type CrumbLevel = 'apartment' | 'room' | 'wall' | 'vertex' | 'element' | 'tape' | 'pin'

/** What clicking a crumb must select. */
export type CrumbSelect =
  | { kind: 'apartment' }
  | { kind: 'room'; roomId: string }
  | { kind: 'wall'; roomId: string; wallStart: string }
  | { kind: 'vertex'; roomId: string; vertexId: string }
  | { kind: 'element'; elementId: string }
  | { kind: 'tape'; id: string }
  | { kind: 'pin'; id: string }

export type Crumb = { level: CrumbLevel; text: string; select: CrumbSelect }

type TrailDoc = Pick<PlanDoc, 'rooms' | 'elements' | 'tapes' | 'pins'>

/** Room that holds the current selection (element -> its room, tape/pin -> its roomId). */
export function roomIdOfSelection(doc: TrailDoc, selection: Selection, annot: AnnotSelection): string | undefined {
  if (annot?.kind === 'tape') return doc.tapes.find((t) => t.id === annot.id)?.roomId
  if (annot?.kind === 'pin') return (doc.pins ?? []).find((p) => p.id === annot.id)?.roomId
  if (!selection) return undefined
  if (selection.kind === 'element') return doc.elements.find((e) => e.id === selection.elementId)?.roomId
  return selection.roomId
}

/**
 * Where Esc goes from the current selection (docs/sidebar-plan-3.md step 6): up one level.
 * A wall, a vertex or an element goes to its room; a room goes to nothing; a tape or a pin
 * drops its own selection and goes to its room. `kind: 'none'` means nothing is selected.
 */
export type ParentStep =
  | { kind: 'none' }
  | { kind: 'select'; selection: Selection; clearAnnot?: boolean }

export function parentSelection(doc: TrailDoc, selection: Selection, annot: AnnotSelection): ParentStep {
  /** Room of `roomId`, or nothing when the room is gone. */
  const roomSel = (roomId: string | undefined): Selection =>
    roomId && doc.rooms.some((r) => r.id === roomId) ? { kind: 'room', roomId } : null
  if (annot) return { kind: 'select', selection: roomSel(roomIdOfSelection(doc, null, annot)), clearAnnot: true }
  if (!selection) return { kind: 'none' }
  if (selection.kind === 'room') return { kind: 'select', selection: null }
  return { kind: 'select', selection: roomSel(roomIdOfSelection(doc, selection, null)) }
}

/** The crumbs to show, from the apartment down to the current selection. */
export function buildTrail(doc: TrailDoc, selection: Selection, annot: AnnotSelection): Crumb[] {
  const crumbs: Crumb[] = [{ level: 'apartment', text: 'Apartment', select: { kind: 'apartment' } }]
  const roomId = roomIdOfSelection(doc, selection, annot)
  const room = roomId ? doc.rooms.find((r) => r.id === roomId) : undefined
  if (room) {
    crumbs.push({ level: 'room', text: `${room.name} (${room.code})`, select: { kind: 'room', roomId: room.id } })
  }

  if (annot?.kind === 'tape' || annot?.kind === 'pin') {
    crumbs.push({ level: annot.kind, text: annot.kind === 'tape' ? 'Tape' : 'Pin', select: { kind: annot.kind, id: annot.id } })
    return crumbs
  }
  if (!selection) return crumbs

  if (selection.kind === 'element') {
    const el = doc.elements.find((e) => e.id === selection.elementId)
    crumbs.push({
      level: 'element',
      text: el ? `Element ${KIND_LABEL[el.kind]}` : 'Element',
      select: { kind: 'element', elementId: selection.elementId },
    })
    return crumbs
  }
  if (selection.kind === 'vertex') {
    crumbs.push({ level: 'vertex', text: 'Vertex', select: { kind: 'vertex', roomId: selection.roomId, vertexId: selection.vertexId } })
    return crumbs
  }
  if (selection.kind === 'wall') {
    const wall = room ? roomWalls(room).find((w) => w.start.id === selection.wallStart) : undefined
    crumbs.push({
      level: 'wall',
      text: room && wall ? `Wall ${room.code}-${wall.index + 1}` : 'Wall',
      select: { kind: 'wall', roomId: selection.roomId, wallStart: selection.wallStart },
    })
  }
  return crumbs
}
