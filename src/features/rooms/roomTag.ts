// The room tag (docs/measurements-plan.md section 2): the title of the label (code + name) and the
// rows of values that the user turns on in the View menu (area, perimeter, ceiling height, survey
// progress). Pure functions here, so the rules are tested without a canvas; the drawing stays in
// features/rooms/RoomsOverlay.tsx.
import { dist, innerWallLengths } from '../../model/geometry'
import { surveyIds } from '../../model/survey'
import type { RoomTagFields } from '../../model/store'
import type { Measurement, Room, Vec } from '../../model/types'

/** What the tag of one room (or of a group of rooms merged in the After view) says. */
export type RoomTagInput = {
  /** Name of the room, or the combined name of a merged group ("Séjour + Cuisine"). */
  name: string
  /** Codes of the room; several when rooms are merged in the After view. */
  codes: string[]
  /** Floor area, m² (holes subtracted). */
  areaM2: number
  /** Perimeter of the outline on its inside faces, cm. */
  perimeterCm: number
  /** Ceiling height of the room, cm. Undefined when the room has none. */
  ceilingCm?: number
  /** Walls of the room that have a measured value. */
  measuredWalls: number
  /** Walls of the room. */
  walls: number
}

export type RoomTagLines = {
  /** The title line of the tag: the room code (optional) and the name (optional). */
  title: { code?: string; name?: string }
  /** One line per value, in the order the View menu lists them. */
  rows: string[]
}

/** A number with a comma decimal separator and `decimals` digits: 12.345 -> "12,35". */
export const decimalText = (v: number, decimals: number) => v.toFixed(Math.max(0, Math.min(3, decimals))).replace('.', ',')

/** Area as the tag writes it: "12,34". */
export const areaText = (areaM2: number, decimals: number) => decimalText(areaM2, decimals)

/** A length in cm written in metres with two decimals: 1420 -> "14,20". */
export const metresText = (cm: number) => decimalText(cm / 100, 2)

/**
 * The lines of the tag. The title is empty when the user turned off both the code and the name;
 * a row is present only when its check box is on AND the document has a value for it (a room
 * without a ceiling height shows no height row). The area precision (0, 1 or 2 decimals) comes
 * from `areaDecimals`; the perimeter and the height always keep two decimals.
 */
export function roomTagLines(
  input: RoomTagInput,
  fields: RoomTagFields,
  opts: { showCodes?: boolean } = {},
): RoomTagLines {
  // The layer `roomCodes` still decides when codes are shown at all (auto / on / off).
  const showCodes = opts.showCodes ?? true
  const code = fields.code && showCodes && input.codes.length > 0 ? input.codes.join(' ') : undefined
  const name = fields.name && input.name !== '' ? input.name : undefined
  const rows: string[] = []
  if (fields.area) rows.push(`${areaText(input.areaM2, fields.areaDecimals)} m²`)
  if (fields.perimeter) rows.push(`P ${metresText(input.perimeterCm)} m`)
  if (fields.ceiling && input.ceilingCm !== undefined && input.ceilingCm > 0) rows.push(`H ${metresText(input.ceilingCm)} m`)
  if (fields.progress && input.walls > 0) rows.push(`${input.measuredWalls}/${input.walls} walls`)
  return { title: { code, name }, rows }
}

/** Length of a closed ring, cm. */
export const ringPerimeter = (pts: Vec[]) =>
  pts.reduce((s, p, i) => s + dist(p, pts[(i + 1) % pts.length]), 0)

/** Perimeter of a room on its inside faces, cm: the sum of the lengths of its wall faces. */
export const roomPerimeterCm = (r: Room) => innerWallLengths(r).reduce((s, v) => s + v, 0)

/**
 * Perimeter of the outline of a merged display item, cm: the sum of the outer rings of its pieces.
 * A merged group has one outline, so this is the perimeter of the rooms taken together.
 */
export const outlinePerimeterCm = (pieces: Vec[][][]) =>
  pieces.reduce((s, p) => s + (p[0] && p[0].length >= 3 ? ringPerimeter(p[0]) : 0), 0)

export type WallProgress = { measured: number; walls: number }

/**
 * Survey progress of one room or of a group of rooms: the walls that have a measured value, over
 * the walls they have (the survey IDs of kind 'wall').
 */
export function wallProgress(rooms: Room[], measurements: Record<string, Measurement>): WallProgress {
  let measured = 0, walls = 0
  for (const r of rooms) {
    for (const id of surveyIds(r)) {
      if (id.kind !== 'wall') continue
      walls += 1
      const m = measurements[id.label]
      if (m && m.actualCm > 0) measured += 1
    }
  }
  return { measured, walls }
}

/**
 * Ceiling height of the tag, cm. A single room uses its own field. Rooms merged in the After view
 * share one value only when they all have the same height; otherwise the row is left out rather
 * than showing a height that is not true for the group.
 */
export function tagCeilingCm(rooms: Room[]): number | undefined {
  if (rooms.length === 0) return undefined
  const own = rooms.map((r) => (r.ceilingCm !== undefined && r.ceilingCm > 0 ? r.ceilingCm : undefined))
  const first = own[0]
  if (first === undefined) return undefined
  return own.every((v) => v === first) ? first : undefined
}
