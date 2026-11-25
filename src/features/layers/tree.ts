// Layers tree (pure): the rooms of the plan, each with its walls, its doors and windows and its
// storage rooms, then the stored walls that no room uses. No React, no store, lengths in cm.
import { innerWallLengths, roomAreaM2, roomWalls } from '../../model/geometry'
import type { SelItem } from '../../model/selection'
import type { PlanDoc, Room, StoredWall, WallType } from '../../model/types'
import { wallValueLabel } from '../../model/wallValues'
import { isV2Doc } from '../../model/v2/targets'
import { KIND_LABEL } from '../elements/geometry'
import { verifiedWalls } from '../rooms/apply'
import { wallProps } from '../rooms/walls'

export type LayerWarning = 'overlap' | 'short'

export type LayerNode = {
  /** Stable key, unique in the tree. */
  key: string
  type: 'room' | 'group' | 'wall' | 'element'
  /** Text of the row (without the unit parts): "R1 Cuisine", "Walls", "R1-1", "Door 90". */
  label: string
  /** Selection set by a click; absent on a group. */
  sel?: SelItem
  /** Survey label shown on the canvas when the row is hovered (walls of a room). */
  hoverLabel?: string
  children: LayerNode[]
  // room
  areaM2?: number
  // wall
  lengthCm?: number
  measured?: boolean
  locked?: boolean
  wallType?: WallType
  /** Stored wall behind a wall row. */
  wallId?: string
  warnings?: LayerWarning[]
  // element
  widthCm?: number
}

export type LayerTree = {
  /** Top-level rows: the rooms by walk order, then the group "Walls without a room" when it has walls. */
  nodes: LayerNode[]
  /** Number of wall rows that carry a warning (a stored wall counts once). */
  issueCount: number
}

/** Smallest overlap (cm) that is a duplicate, and shortest wall (cm) that is not degenerate. */
export const OVERLAP_MIN_CM = 1
export const SHORT_WALL_CM = 1
/** Distance (cm) under which two wall lines are the same line. */
const SAME_LINE_CM = 0.5

type Pt = { x: number; y: number }

/** Warnings per stored wall id: collinear overlap with another stored wall, or a length under 1 cm. */
export function wallWarnings(doc: Pick<PlanDoc, 'nodes' | 'walls'>): Map<string, LayerWarning[]> {
  const out = new Map<string, LayerWarning[]>()
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n as Pt]))
  const segs = (doc.walls ?? []).flatMap((w) => {
    const a = nodes.get(w.a), b = nodes.get(w.b)
    return a && b ? [{ id: w.id, a, b, len: Math.hypot(b.x - a.x, b.y - a.y) }] : []
  })
  const add = (id: string, w: LayerWarning) => {
    const cur = out.get(id) ?? []
    if (!cur.includes(w)) out.set(id, [...cur, w])
  }
  for (const s of segs) if (s.len < SHORT_WALL_CM) add(s.id, 'short')
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s.len < SHORT_WALL_CM) continue
    const ux = (s.b.x - s.a.x) / s.len, uy = (s.b.y - s.a.y) / s.len
    for (let j = i + 1; j < segs.length; j++) {
      const t = segs[j]
      if (t.len < SHORT_WALL_CM) continue
      const off = (p: Pt) => Math.abs((p.x - s.a.x) * uy - (p.y - s.a.y) * ux)
      if (off(t.a) > SAME_LINE_CM || off(t.b) > SAME_LINE_CM) continue
      const along = (p: Pt) => (p.x - s.a.x) * ux + (p.y - s.a.y) * uy
      const lo = Math.max(0, Math.min(along(t.a), along(t.b)))
      const hi = Math.min(s.len, Math.max(along(t.a), along(t.b)))
      if (hi - lo > OVERLAP_MIN_CM) {
        add(s.id, 'overlap')
        add(t.id, 'overlap')
      }
    }
  }
  return out
}

const storedLength = (doc: PlanDoc, w: StoredWall): number | null => {
  const a = doc.nodes?.find((n) => n.id === w.a), b = doc.nodes?.find((n) => n.id === w.b)
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : null
}

/** The `walkOrder` sort, stable. */
const byWalk = (a: Room, b: Room) => a.walkOrder - b.walkOrder

export function buildLayerTree(doc: PlanDoc): LayerTree {
  const warnings = wallWarnings(doc)
  const v2 = isV2Doc(doc)
  const storedById = new Map((doc.walls ?? []).map((w) => [w.id, w]))
  const roomIds = new Set(doc.rooms.map((r) => r.id))
  // Distinct warned walls: a stored wall counts once even when two rooms list it.
  const issues = new Set<string>()
  const countIssue = (key: string, w: LayerWarning[]) => {
    if (w.length) issues.add(key)
  }

  /** Stored wall behind the wall of `room` that starts at `wallStart` (face match, else the v2 cycle). */
  const storedOf = (room: Room, wallStart: string, index: number): StoredWall | undefined => {
    const viaFace = (doc.walls ?? []).find((w) => w.faces.some((f) => f.roomId === room.id && f.wallStart === wallStart))
    if (viaFace) return viaFace
    const id = room.cycle?.[index]?.wallId
    return id ? storedById.get(id) : undefined
  }

  const roomNode = (room: Room, seen: Set<string>): LayerNode => {
    seen.add(room.id)
    const verified = new Map(verifiedWalls(doc, room).map((v) => [v.wallStart, v.cm]))
    const inner = innerWallLengths(room)
    const wallNodes: LayerNode[] = roomWalls(room).map((w) => {
      const props = wallProps(room, w.start.id)
      const label = `${room.code}-${w.index + 1}`
      const stored = storedOf(room, w.start.id, w.index)
      const warn = [...(stored ? (warnings.get(stored.id) ?? []) : [])]
      if (!stored && inner[w.index] < SHORT_WALL_CM) warn.push('short')
      countIssue(stored?.id ?? `wall:${room.id}:${w.start.id}`, warn)
      return {
        key: `wall:${room.id}:${w.start.id}`,
        type: 'wall' as const,
        label,
        sel: stored && v2
          ? { kind: 'storedWall' as const, wallId: stored.id }
          : { kind: 'wall' as const, roomId: room.id, wallStart: w.start.id },
        hoverLabel: label,
        children: [],
        lengthCm: inner[w.index],
        measured: verified.has(w.start.id),
        locked: !!(stored && v2 ? stored.locked : props.locked),
        wallType: (stored && v2 ? stored.type : undefined) ?? props.type,
        wallId: stored?.id,
        warnings: warn,
      }
    })
    const wallOrder = new Map(roomWalls(room).map((w) => [w.start.id, w.index]))
    const elementNodes: LayerNode[] = (doc.elements ?? [])
      .filter((e) => e.roomId === room.id)
      .sort((a, b) => (wallOrder.get(a.wallStart) ?? 1e9) - (wallOrder.get(b.wallStart) ?? 1e9) || a.offsetCm - b.offsetCm)
      .map((e) => ({
        key: `element:${e.id}`,
        type: 'element' as const,
        label: KIND_LABEL[e.kind] ?? e.kind,
        sel: { kind: 'element' as const, elementId: e.id },
        children: [],
        widthCm: e.widthCm,
      }))
    const storageRooms = doc.rooms.filter((r) => r.storage?.parentRoomId === room.id && !seen.has(r.id)).sort(byWalk)
    const children: LayerNode[] = [
      { key: `group:${room.id}:walls`, type: 'group', label: 'Walls', children: wallNodes },
      { key: `group:${room.id}:elements`, type: 'group', label: 'Doors & windows', children: elementNodes },
    ]
    if (storageRooms.length) {
      children.push({
        key: `group:${room.id}:storage`,
        type: 'group',
        label: 'Storage',
        children: storageRooms.map((r) => roomNode(r, seen)),
      })
    }
    return {
      key: `room:${room.id}`,
      type: 'room',
      label: `${room.code} ${room.name}`.trim(),
      sel: { kind: 'room', roomId: room.id },
      children,
      areaM2: roomAreaM2(room),
    }
  }

  const seen = new Set<string>()
  // A storage room goes under its parent; one whose parent is gone stays at the top.
  const top = doc.rooms.filter((r) => !(r.storage && roomIds.has(r.storage.parentRoomId))).sort(byWalk)
  const nodes = top.map((r) => roomNode(r, seen))

  // Stored walls that no room cycle uses.
  const used = new Set<string>()
  for (const r of doc.rooms) for (const f of r.cycle ?? []) used.add(f.wallId)
  for (const w of doc.walls ?? []) if (w.faces.some((f) => f.roomId !== undefined && roomIds.has(f.roomId))) used.add(w.id)
  const free = (doc.walls ?? []).filter((w) => !used.has(w.id))
  if (free.length) {
    nodes.push({
      key: 'group:no-room',
      type: 'group',
      label: 'Walls without a room',
      children: free.map((w) => {
        const warn = warnings.get(w.id) ?? []
        countIssue(w.id, warn)
        return {
          key: `storedWall:${w.id}`,
          type: 'wall' as const,
          label: w.id,
          sel: { kind: 'storedWall' as const, wallId: w.id },
          children: [],
          lengthCm: storedLength(doc, w) ?? 0,
          measured: doc.measurements[wallValueLabel(w.id, 'centre')] != null,
          locked: !!w.locked,
          wallType: w.type ?? 'partition',
          wallId: w.id,
          warnings: warn,
        }
      }),
    })
  }
  // issueCount = number of distinct warned stored walls (+ room walls without a stored wall).
  const issueCount = issues.size
  return { nodes, issueCount }
}

/** Keys of the nodes on the way to the first node with `key` (the node itself excluded); [] when absent. */
export function ancestorKeys(nodes: LayerNode[], key: string, path: string[] = []): string[] {
  for (const n of nodes) {
    if (n.key === key) return path
    const r = ancestorKeys(n.children, key, [...path, n.key])
    if (r.length) return r
  }
  return []
}

/** Keys of every node that passes `match` (a stored wall can appear under two rooms). */
export function findKeys(nodes: LayerNode[], match: (n: LayerNode) => boolean): string[] {
  return nodes.flatMap((n) => [...(match(n) ? [n.key] : []), ...findKeys(n.children, match)])
}

/** Keep the rows whose label matches `query` (case-insensitive), their ancestors, and everything under a matching room/group. */
export function filterTree(nodes: LayerNode[], query: string): LayerNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const walk = (list: LayerNode[]): LayerNode[] =>
    list.flatMap((n) => {
      if (n.label.toLowerCase().includes(q) || (n.wallId ?? '').toLowerCase() === q) {
        return n.type === 'room' || n.type === 'group' ? [{ ...n, children: n.children }] : [n]
      }
      const kids = walk(n.children)
      return kids.length ? [{ ...n, children: kids }] : []
    })
  return walk(nodes)
}
