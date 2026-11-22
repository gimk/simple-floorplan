// Pure row builders for the lists of the room panel: the walls of a room, the elements
// of a room, and the elements of one wall. No React, no store, units are cm.
import { roomWalls } from '../../model/geometry'
import type { PlanDoc, Room, WallElement, WallType } from '../../model/types'
import { KIND_LABEL, VARIANT_LABEL } from '../elements/geometry'
import { verifiedWalls } from './apply'
import { wallProps } from './walls'

/** Wall type label (segmented control, type chips). */
export const WALL_TYPE_LABEL: Record<WallType, string> = {
  bearing: 'Bearing',
  partition: 'Partition',
  exterior: 'Exterior',
}

/** Small colour chip classes per wall type, light + dark. */
export const WALL_TYPE_CHIP: Record<WallType, string> = {
  bearing: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  partition: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  exterior: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
}

type DocWalls = Pick<PlanDoc, 'measurements'>

/** Survey label of the wall that starts at `wallStart`, e.g. "SE-2"; null when gone. */
export function wallLabel(room: Room, wallStart: string): string | null {
  const wall = roomWalls(room).find((w) => w.start.id === wallStart)
  return wall ? `${room.code}-${wall.index + 1}` : null
}

export type WallRow = {
  /** Start vertex id: the store key of the wall. */
  wallStart: string
  index: number
  /** Survey label, e.g. "SE-2". */
  label: string
  type: WallType
  typeLabel: string
  /** Length of the drawn wall, in cm. */
  lengthCm: number
  /** On-site value when the wall was measured, else null. */
  verifiedCm: number | null
  locked: boolean
}

/** One row per wall of the room, in polygon order. */
export function wallRows(doc: DocWalls, room: Room): WallRow[] {
  const verified = new Map(verifiedWalls(doc, room).map((v) => [v.wallStart, v.cm]))
  return roomWalls(room).map((w) => {
    const props = wallProps(room, w.start.id)
    return {
      wallStart: w.start.id,
      index: w.index,
      label: `${room.code}-${w.index + 1}`,
      type: props.type,
      typeLabel: WALL_TYPE_LABEL[props.type],
      lengthCm: w.length,
      verifiedCm: verified.get(w.start.id) ?? null,
      locked: !!props.locked,
    }
  })
}

export type ElementRow = {
  id: string
  /** "Door", "Window", ... */
  kindLabel: string
  /** "Single swing", ... ; null when the element has no variant. */
  variantLabel: string | null
  /** Start vertex id of the host wall. */
  wallStart: string
  /** Survey label of the host wall, e.g. "SE-2"; null when the wall is gone. */
  wallLabel: string | null
  widthCm: number
  /** Distance from the start vertex to the near edge of the element, in cm. */
  offsetCm: number
}

const toRow = (room: Room, el: WallElement): ElementRow => ({
  id: el.id,
  kindLabel: KIND_LABEL[el.kind],
  variantLabel: el.variant ? VARIANT_LABEL[el.variant] ?? null : null,
  wallStart: el.wallStart,
  wallLabel: wallLabel(room, el.wallStart),
  widthCm: el.widthCm,
  offsetCm: el.offsetCm,
})

/** Row order: wall polygon order first, then distance from the wall start. */
const sortRows = (room: Room, rows: ElementRow[]): ElementRow[] => {
  const order = new Map(roomWalls(room).map((w) => [w.start.id, w.index]))
  return [...rows].sort((a, b) => {
    const ai = order.get(a.wallStart) ?? Number.MAX_SAFE_INTEGER
    const bi = order.get(b.wallStart) ?? Number.MAX_SAFE_INTEGER
    return ai - bi || a.offsetCm - b.offsetCm
  })
}

type DocElements = Pick<PlanDoc, 'elements'>

/** Doors, windows and fixtures that belong to this room. */
export function elementRows(doc: DocElements, room: Room): ElementRow[] {
  const rows = (doc.elements ?? []).filter((e) => e.roomId === room.id).map((e) => toRow(room, e))
  return sortRows(room, rows)
}

/** Elements that sit on one wall of the room. */
export function wallElementRows(doc: DocElements, room: Room, wallStart: string): ElementRow[] {
  const rows = (doc.elements ?? []).filter((e) => e.roomId === room.id && e.wallStart === wallStart).map((e) => toRow(room, e))
  return sortRows(room, rows)
}
