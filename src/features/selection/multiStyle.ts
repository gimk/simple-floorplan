// Style logic of the mixed multi-selection Inspect card (MultiInspect.tsx): what several selected
// objects share, and how one edit writes them all at once. Pure: no store and no React, so the unit
// tests run in node.
// VISUAL ONLY, like the style clipboard: wall colour, opening colour, room floor (colour, pattern,
// angle) and furniture colour. No geometry and no identity field is ever touched.
// Units: cm and degrees.
import type { Artboard, FloorPattern, MultiTarget, OpeningKind } from '../../model/types'
import { styleOfTarget } from '../style/styleClipboard'

/** Objects a patch can address. Same four kinds as a multi-selection target. */
export type StyleKind = MultiTarget['kind']

/** A value several objects share, or `mixed` when they differ (then `value` is undefined). */
export type Shared<T> = { mixed: boolean; value: T | undefined }

/**
 * The value every entry of `values` shares. `mixed` is true as soon as two entries differ (strict
 * equality), and `value` is then undefined. An empty list is not mixed and has no value.
 */
export function sharedValue<T>(values: readonly T[]): Shared<T> {
  if (values.length === 0) return { mixed: false, value: undefined }
  const first = values[0]
  const mixed = values.some((v) => !Object.is(v, first))
  return { mixed, value: mixed ? undefined : first }
}

/** Colour of a wall or of an opening: absent means "no colour of its own". */
export type OptionalColor = Shared<string | undefined>

/** What the selected walls share: how many there are, and their colour. */
export type WallsStyle = { count: number; color: OptionalColor }

/** What the selected openings share: how many there are, their colour and their kinds. */
export type OpeningsStyle = {
  count: number
  color: OptionalColor
  /** Number of selected openings per kind; a kind that is absent has no key. */
  kinds: Partial<Record<OpeningKind, number>>
}

/** What the selected rooms share: how many there are, and their floor. */
export type RoomsStyle = {
  count: number
  /** Floor colour; undefined means no fill (the default canvas look). */
  fill: OptionalColor
  /** Floor pattern, normalised: a room without one counts as 'solid'. */
  floorPattern: Shared<FloorPattern>
  /** Floor pattern angle in degrees; a room without one counts as 0. */
  floorPatternAngleDeg: Shared<number>
}

/** What the selected furniture items share: how many there are, and their colour. */
export type FurnitureStyle = { count: number; color: Shared<string> }

/** Per-kind summary of a multi-selection. A kind that is not selected has no key at all. */
export type MultiStyleSummary = {
  walls?: WallsStyle
  openings?: OpeningsStyle
  rooms?: RoomsStyle
  furniture?: FurnitureStyle
}

/** Wall edge targets are only usable while the room still has that edge (undo can drop one). */
const edgeExists = (artboard: Artboard, roomId: string, edgeIndex: number): boolean => {
  const room = artboard.rooms.find((r) => r.id === roomId)
  return !!room && Number.isInteger(edgeIndex) && edgeIndex >= 0 && edgeIndex < room.vertices.length
}

/**
 * What the selected objects of `items` share on `artboard`, one entry per kind present. Objects
 * that no longer exist are not counted (a deleted room, an out-of-range wall edge, a missing
 * opening or furniture item). A furniture group member counts only when `items` holds it. A room
 * without a floor pattern counts as 'solid', and without an angle as 0 degrees.
 */
export function multiStyleSummary(artboard: Artboard, items: readonly MultiTarget[]): MultiStyleSummary {
  const summary: MultiStyleSummary = {}

  const wallColors: (string | undefined)[] = []
  const openingColors: (string | undefined)[] = []
  const openingKinds: Partial<Record<OpeningKind, number>> = {}
  const fills: (string | undefined)[] = []
  const patterns: FloorPattern[] = []
  const angles: number[] = []
  const furnitureColors: string[] = []

  for (const item of items) {
    switch (item.kind) {
      case 'wall': {
        if (!edgeExists(artboard, item.roomId, item.edgeIndex)) break
        const room = artboard.rooms.find((r) => r.id === item.roomId)
        wallColors.push(room?.wallColors?.[String(item.edgeIndex)])
        break
      }
      case 'opening': {
        const opening = artboard.openings.find((o) => o.id === item.openingId)
        if (!opening) break
        openingColors.push(opening.color)
        openingKinds[opening.kind] = (openingKinds[opening.kind] ?? 0) + 1
        break
      }
      case 'room': {
        const room = artboard.rooms.find((r) => r.id === item.roomId)
        if (!room) break
        fills.push(room.fill)
        patterns.push(room.floorPattern ?? 'solid')
        angles.push(room.floorPatternAngleDeg ?? 0)
        break
      }
      case 'furniture': {
        const found = artboard.furniture.find((f) => f.id === item.furnitureId)
        if (!found) break
        furnitureColors.push(found.color)
        break
      }
    }
  }

  if (wallColors.length > 0) summary.walls = { count: wallColors.length, color: sharedValue(wallColors) }
  if (openingColors.length > 0) {
    summary.openings = {
      count: openingColors.length,
      color: sharedValue(openingColors),
      kinds: openingKinds,
    }
  }
  if (fills.length > 0) {
    summary.rooms = {
      count: fills.length,
      fill: sharedValue(fills),
      floorPattern: sharedValue(patterns),
      floorPatternAngleDeg: sharedValue(angles),
    }
  }
  if (furnitureColors.length > 0) {
    summary.furniture = { count: furnitureColors.length, color: sharedValue(furnitureColors) }
  }
  return summary
}

/** Colour of a wall: undefined clears the paint of that wall. */
export type WallStylePatch = { color?: string }

/** Colour of a door, window or opening: undefined goes back to the default colours. */
export type OpeningStylePatch = { color?: string }

/** Floor of a room: undefined clears the field (a 'solid' pattern and 0 degrees store nothing). */
export type RoomStylePatch = { fill?: string; floorPattern?: FloorPattern; floorPatternAngleDeg?: number }

/** Colour of a furniture item (always a colour, a piece of furniture has no default one). */
export type FurnitureStylePatch = { color: string }

/** The patch type of each kind. */
export type StylePatchOf = {
  wall: WallStylePatch
  opening: OpeningStylePatch
  room: RoomStylePatch
  furniture: FurnitureStylePatch
}

/** True when the patch names `key`, so that field is written. An absent field is left untouched. */
const names = (patch: object, key: string): boolean => key in patch

/** Write a wall colour: undefined removes the key, and the map itself when it becomes empty. */
function writeWalls(artboard: Artboard, items: readonly MultiTarget[], patch: WallStylePatch): number {
  if (!names(patch, 'color')) return 0
  let written = 0
  for (const item of items) {
    if (item.kind !== 'wall') continue
    const current = styleOfTarget(artboard, item)
    // null: the room is gone or the edge index is out of range.
    if (!current || current.kind !== 'wall' || current.color === patch.color) continue
    const room = artboard.rooms.find((r) => r.id === item.roomId)
    if (!room) continue
    const key = String(item.edgeIndex)
    if (patch.color === undefined) {
      if (!room.wallColors) continue
      delete room.wallColors[key]
      if (Object.keys(room.wallColors).length === 0) delete room.wallColors
    } else {
      room.wallColors = { ...room.wallColors, [key]: patch.color }
    }
    written++
  }
  return written
}

/** Write an opening colour: undefined removes the field. */
function writeOpenings(artboard: Artboard, items: readonly MultiTarget[], patch: OpeningStylePatch): number {
  if (!names(patch, 'color')) return 0
  let written = 0
  for (const item of items) {
    if (item.kind !== 'opening') continue
    const current = styleOfTarget(artboard, item)
    if (!current || current.kind !== 'opening' || current.color === patch.color) continue
    const opening = artboard.openings.find((o) => o.id === item.openingId)
    if (!opening) continue
    if (patch.color === undefined) delete opening.color
    else opening.color = patch.color
    written++
  }
  return written
}

/** Write the floor fields named by the patch. undefined removes the field. */
function writeRooms(artboard: Artboard, items: readonly MultiTarget[], patch: RoomStylePatch): number {
  let written = 0
  for (const item of items) {
    if (item.kind !== 'room') continue
    const artboardRoom = artboard.rooms.find((r) => r.id === item.roomId)
    if (!artboardRoom) continue
    let changed = false
    if (names(patch, 'fill') && artboardRoom.fill !== patch.fill) {
      if (patch.fill === undefined) delete artboardRoom.fill
      else artboardRoom.fill = patch.fill
      changed = true
    }
    if (names(patch, 'floorPattern') && artboardRoom.floorPattern !== patch.floorPattern) {
      if (patch.floorPattern === undefined) delete artboardRoom.floorPattern
      else artboardRoom.floorPattern = patch.floorPattern
      changed = true
    }
    if (names(patch, 'floorPatternAngleDeg') && artboardRoom.floorPatternAngleDeg !== patch.floorPatternAngleDeg) {
      if (patch.floorPatternAngleDeg === undefined) delete artboardRoom.floorPatternAngleDeg
      else artboardRoom.floorPatternAngleDeg = patch.floorPatternAngleDeg
      changed = true
    }
    if (changed) written++
  }
  return written
}

/** Write a furniture colour. */
function writeFurniture(artboard: Artboard, items: readonly MultiTarget[], patch: FurnitureStylePatch): number {
  let written = 0
  for (const item of items) {
    if (item.kind !== 'furniture') continue
    const found = artboard.furniture.find((f) => f.id === item.furnitureId)
    if (!found || found.color === patch.color) continue
    found.color = patch.color
    written++
  }
  return written
}

/**
 * Write `patch` to every item of `kind` inside a document draft, and return how many items it
 * changed. Only the fields the patch names are written, so another field of the same object keeps
 * its value; a named field set to undefined DELETES it (a wall colour key, and the whole wallColors
 * map when it becomes empty). Items of another kind, objects that no longer exist, out-of-range wall
 * edges and items that already hold the wanted value are skipped, so no undo step is wasted.
 */
export function applyStylePatch(
  artboard: Artboard,
  items: readonly MultiTarget[],
  kind: 'wall',
  patch: WallStylePatch,
): number
export function applyStylePatch(
  artboard: Artboard,
  items: readonly MultiTarget[],
  kind: 'opening',
  patch: OpeningStylePatch,
): number
export function applyStylePatch(
  artboard: Artboard,
  items: readonly MultiTarget[],
  kind: 'room',
  patch: RoomStylePatch,
): number
export function applyStylePatch(
  artboard: Artboard,
  items: readonly MultiTarget[],
  kind: 'furniture',
  patch: FurnitureStylePatch,
): number
export function applyStylePatch(
  artboard: Artboard,
  items: readonly MultiTarget[],
  kind: StyleKind,
  patch: WallStylePatch | OpeningStylePatch | RoomStylePatch | FurnitureStylePatch,
): number {
  switch (kind) {
    case 'wall':
      return writeWalls(artboard, items, patch as WallStylePatch)
    case 'opening':
      return writeOpenings(artboard, items, patch as OpeningStylePatch)
    case 'room':
      return writeRooms(artboard, items, patch as RoomStylePatch)
    case 'furniture':
      return writeFurniture(artboard, items, patch as FurnitureStylePatch)
  }
}

