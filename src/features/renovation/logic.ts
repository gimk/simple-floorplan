// Before / After renovation diff (docs/plan.md 7.4). Pure functions: no React, no store.
//
// Walls carry a renovation `status` (see WallProps in src/model/types.ts):
//   'existing' (default) — kept as it is,
//   'demolish'           — removed by the works,
//   'new'                — built by the works.
// The view chooses what to display, never what to store:
//   before — everything except the 'new' walls,
//   after  — nothing with a 'demolish' wall; rooms separated only by a demolished wall
//            are drawn (and counted) as one room,
//   both   — the plan as stored, with the demolished walls in red and the new ones in green.
//
// Merged outlines are computed here, for display only: the document keeps both rooms.
import polygonClipping from 'polygon-clipping'
import { cross, dot, innerWallLengths, roomAreaM2, roomWalls, sub } from '../../model/geometry'
import type { PlanDoc, Room, Vec, WallStatus, WallType } from '../../model/types'
import { wallProps } from '../rooms/walls'

export type RenovationView = 'before' | 'after' | 'both'

export const RENOVATION_VIEWS: readonly RenovationView[] = ['before', 'after', 'both']

export const RENOVATION_VIEW_LABELS: Record<RenovationView, string> = {
  before: 'Before',
  after: 'After',
  both: 'Both',
}

/** Closed ring of world points (cm). */
export type Ring = Vec[]
/** One polygon of the display outline: exterior ring first, then its holes. */
export type Piece = Ring[]

/** One room as displayed in the current renovation view (one or several real rooms). */
export type DisplayRoom = {
  /** Id of the first room of the group: the one a click selects. */
  id: string
  roomIds: string[]
  codes: string[]
  /** Room name, or "Séjour + Cuisine" for a merged group. */
  name: string
  /** Sum of the member room areas, m² (holes subtracted). */
  areaM2: number
  /** True when every member room is outdoor. */
  outdoor: boolean
  /** True when several rooms are shown as one (renovation 'after' view only). */
  merged: boolean
  /** Outline to draw. One piece, or several when the union has disjoint parts. */
  pieces: Piece[]
}

const toRing = (pts: Vec[]): [number, number][] => pts.map((p) => [p.x, p.y])
const fromRing = (r: [number, number][]): Ring => r.slice(0, -1).map(([x, y]) => ({ x, y }))
const asPolygon = (r: Room): [number, number][][] => [toRing(r.vertices), ...(r.holes ?? []).map(toRing)]

/** True when `r` has at least one wall with a renovation status. */
export function hasRenovationStatus(doc: Pick<PlanDoc, 'rooms'>): boolean {
  return doc.rooms.some((r) => Object.values(r.walls ?? {}).some((p) => p.status !== undefined))
}

export const isStructural = (type: WallType): boolean => type === 'bearing' || type === 'exterior'

/** How one wall is drawn in a given view. */
export type WallStyle = 'type' | 'demolish' | 'new'

export type WallAppearance = {
  /** False when the view hides this wall completely. */
  visible: boolean
  /** 'type' = normal structural styling (the wall type owns the fill). */
  style: WallStyle
  /** A bearing or exterior wall marked for demolition: red warning. */
  structural: boolean
}

/**
 * Appearance of one wall.
 *   before: everything except 'new'.   after: nothing with 'demolish'.
 *   both:   all walls, the demolished ones in red (style 'demolish', dashed).
 */
export function wallAppearance(type: WallType, status: WallStatus | undefined, view: RenovationView): WallAppearance {
  const st: WallStatus = status ?? 'existing'
  if (st === 'new') {
    return { visible: view !== 'before', style: 'new', structural: false }
  }
  if (st === 'demolish') {
    const structural = isStructural(type)
    if (view === 'after') return { visible: false, style: 'demolish', structural }
    return { visible: true, style: view === 'both' ? 'demolish' : 'type', structural }
  }
  return { visible: true, style: 'type', structural: false }
}

/** A shared wall segment between two rooms. */
export type DemolishedLink = { roomId: string; otherRoomId: string; wallStart: string; otherWallStart: string }

/** Parallel walls closer than `maxGapCm` that overlap by at least `minOverlapCm`. */
const sharesSegment = (a: { start: Vec; end: Vec; dir: Vec; length: number }, b: { start: Vec; end: Vec; dir: Vec; length: number }, maxGapCm: number, minOverlapCm: number): boolean => {
  if (a.length < 1 || b.length < 1) return false
  if (Math.abs(dot(a.dir, b.dir)) < 0.985) return false
  const perpA = Math.abs(cross(sub(b.start, a.start), a.dir))
  const perpB = Math.abs(cross(sub(b.end, a.start), a.dir))
  if (perpA > maxGapCm || perpB > maxGapCm) return false
  const t0 = dot(sub(b.start, a.start), a.dir)
  const t1 = dot(sub(b.end, a.start), a.dir)
  const lo = Math.max(0, Math.min(t0, t1))
  const hi = Math.min(a.length, Math.max(t0, t1))
  return hi - lo >= minOverlapCm
}

/**
 * Pairs of rooms separated by a wall marked for demolition.
 * A shared wall counts as demolished when EITHER side of it is marked:
 * the two rooms keep their own copy of that wall.
 */
export function demolishedLinks(rooms: Room[], maxGapCm = 5, minOverlapCm = 10): DemolishedLink[] {
  const links: DemolishedLink[] = []
  for (let i = 0; i < rooms.length; i++) {
    const a = rooms[i]
    const wallsA = roomWalls(a)
    for (let j = i + 1; j < rooms.length; j++) {
      const b = rooms[j]
      const wallsB = roomWalls(b)
      for (const wa of wallsA) {
        let hit = false
        for (const wb of wallsB) {
          if (!sharesSegment(wa, wb, maxGapCm, minOverlapCm)) continue
          const demolished = wallProps(a, wa.start.id).status === 'demolish' || wallProps(b, wb.start.id).status === 'demolish'
          if (!demolished) continue
          links.push({ roomId: a.id, otherRoomId: b.id, wallStart: wa.start.id, otherWallStart: wb.start.id })
          hit = true
          break
        }
        if (hit) break
      }
    }
  }
  return links
}

/**
 * Groups of rooms that become one room once the demolished walls are gone.
 * Only groups of two rooms or more are returned, in document order.
 */
export function mergedGroups(rooms: Room[]): Room[][] {
  const links = demolishedLinks(rooms)
  if (!links.length) return []
  const parent = new Map<string, string>(rooms.map((r) => [r.id, r.id]))
  const find = (id: string): string => {
    let cur = id
    while (parent.get(cur) !== cur) cur = parent.get(cur) as string
    return cur
  }
  for (const l of links) {
    const ra = find(l.roomId)
    const rb = find(l.otherRoomId)
    if (ra !== rb) parent.set(rb, ra)
  }
  const byRoot = new Map<string, Room[]>()
  for (const r of rooms) {
    if (!parent.has(r.id)) continue
    const root = find(r.id)
    const list = byRoot.get(root)
    if (list) list.push(r)
    else byRoot.set(root, [r])
  }
  return [...byRoot.values()].filter((g) => g.length > 1)
}

const single = (r: Room): DisplayRoom => ({
  id: r.id,
  roomIds: [r.id],
  codes: [r.code],
  name: r.name,
  areaM2: roomAreaM2(r),
  outdoor: Boolean(r.outdoor),
  merged: false,
  pieces: [[r.vertices, ...(r.holes ?? [])]],
})

/** Union of the member outlines. Falls back to one piece per room if the union fails. */
function unionPieces(members: Room[]): Piece[] {
  try {
    const polys = members.map(asPolygon)
    const merged = polygonClipping.union(polys[0], ...polys.slice(1))
    const pieces = merged.map((poly) => poly.map(fromRing)).filter((p) => p.length > 0 && p[0].length >= 3)
    if (pieces.length) return pieces
  } catch {
    /* degenerate outline: keep the rooms apart */
  }
  return members.map((r) => [r.vertices, ...(r.holes ?? [])])
}

/** Floor under the demolished walls between the members, m² (one side of each wall counted). */
function demolishedFloorM2(members: Room[]): number {
  let cm2 = 0
  for (const l of demolishedLinks(members)) {
    const room = members.find((r) => r.id === l.roomId)
    if (!room) continue
    const w = roomWalls(room).find((x) => x.start.id === l.wallStart)
    if (!w) continue
    cm2 += innerWallLengths(room)[w.index] * wallProps(room, l.wallStart).thicknessCm
  }
  return cm2 / 10000
}

const group = (members: Room[]): DisplayRoom => ({
  id: members[0].id,
  roomIds: members.map((r) => r.id),
  codes: members.map((r) => r.code),
  // Combined name, e.g. "Séjour + Cuisine".
  name: members.map((r) => r.name).join(' + '),
  // Summed area: what the rooms are worth together, plus the floor under each demolished wall
  // (its inside face length × its thickness). Display only, the data is untouched.
  areaM2: members.reduce((s, r) => s + roomAreaM2(r), 0) + demolishedFloorM2(members),
  outdoor: members.every((r) => r.outdoor),
  merged: true,
  pieces: unionPieces(members),
})

/**
 * Rooms as displayed in a view.
 * 'before' and 'both' return one entry per room; 'after' returns the merged groups
 * (one entry per group of rooms separated only by demolished walls).
 */
export function renovationRooms(doc: Pick<PlanDoc, 'rooms'>, view: RenovationView): DisplayRoom[] {
  const rooms = doc.rooms
  if (view !== 'after') return rooms.map(single)

  const groups = mergedGroups(rooms)
  if (!groups.length) return rooms.map(single)

  const groupOf = new Map<string, Room[]>()
  for (const g of groups) for (const r of g) groupOf.set(r.id, g)

  const out: DisplayRoom[] = []
  const done = new Set<string>()
  for (const r of rooms) {
    if (done.has(r.id)) continue
    const g = groupOf.get(r.id)
    if (!g) {
      out.push(single(r))
      done.add(r.id)
      continue
    }
    for (const member of g) done.add(member.id)
    out.push(group(g))
  }
  return out
}

export type RenovationTotals = { areaM2: number; rooms: number }

/** Indoor totals of the before and after states, m² (outdoor rooms excluded). */
export function renovationTotals(doc: Pick<PlanDoc, 'rooms'>, view: RenovationView): RenovationTotals {
  const rooms = renovationRooms(doc, view).filter((d) => !d.outdoor)
  const areaM2 = Math.round(rooms.reduce((s, d) => s + d.areaM2, 0) * 100) / 100
  return { areaM2, rooms: rooms.length }
}

/** Before / after totals, or null when no wall has a renovation status. */
export function renovationSummary(
  doc: Pick<PlanDoc, 'rooms'>,
): { before: RenovationTotals; after: RenovationTotals } | null {
  if (!hasRenovationStatus(doc)) return null
  return { before: renovationTotals(doc, 'before'), after: renovationTotals(doc, 'after') }
}

/** SVG path of a display outline (holes cut out by the caller with fill-rule evenodd). */
export const piecesPath = (pieces: Piece[]): string =>
  pieces.map((p) => p.map((ring) => 'M' + ring.map((pt) => `${pt.x} ${pt.y}`).join('L') + 'Z').join('')).join('')
