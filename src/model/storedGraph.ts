// The STORED wall graph (docs/walls-plan.md, phase 5a). Pure, cm, y points down.
//
// `buildWallGraph(rooms)` derives nodes and walls from the rooms, but its ids change when a room
// joins a wall. `syncStoredGraph` gives the walls and nodes STABLE ids (W1, W2... / N1, N2...):
//   - a new wall takes the id of the previous wall that shares the most face keys
//     (roomId + ':' + wallStart). Each old id is used once. Ties: the lower old position, then the
//     lower new position (the graph order is deterministic, so the result is too);
//   - when a wall was split, the id goes to the LARGER part (a corner added on a wall makes the
//     first part keep the key, so a second pass moves the id to the longer part);
//   - a wall with no match gets 'W' + (highest W number + 1);
//   - a node keeps the id of the previous node at an end of the same wall (votes), then the
//     previous node at the same place (<= 1 cm); else 'N' + next number.
// The same arrays (reference equality) come back when nothing changed, so the store does not churn.
//
// The rooms stay the editing source: thickness, type and status stay in `room.walls`.
//
// NOTE: two in-line walls of one room, or a T junction on axis-aligned walls, are ONE graph wall
// (see wallGraph.ts), so a corner added in line on such a wall does not split it. The second pass
// matters for walls that are not horizontal or vertical: they are never grouped, so a corner added
// on a diagonal wall makes two walls, and the larger one keeps the id.
//
// LIMIT: the ids depend on the history. An old client that drops `nodes`/`walls` (undefined) gives
// the numbering of a fresh first build (W1..Wn in graph order). That equals the ids of the stored
// graph only until the first edit that adds, splits or removes a wall; after such edits the fresh
// numbering can differ. The server keeps the stored graph, so a client that has the fields never
// loses its ids. An id of a deleted wall can be used again (the highest number is read from the
// walls that exist).
import { buildWallGraph } from './wallGraph'
import type { Room, StoredFace, StoredNode, StoredWall } from './types'

type Prev = { nodes?: StoredNode[]; walls?: StoredWall[] } | undefined

/** Two points closer than this (cm) are at the same place. */
const SAME_PLACE_CM = 1

const idNumber = (id: string, prefix: string): number => {
  const m = new RegExp(`^${prefix}(\\d+)$`).exec(id)
  return m ? Number(m[1]) : 0
}

const faceKey = (f: StoredFace): string | null => (f.roomId !== undefined && f.wallStart !== undefined ? `${f.roomId}:${f.wallStart}` : null)

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

/** Distance from point p to the segment a-b. */
function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

const sameFace = (a: StoredFace, b: StoredFace) =>
  a.side === b.side && a.roomId === b.roomId && a.wallStart === b.wallStart && a.from === b.from && a.to === b.to

const sameWalls = (a: StoredWall[], b: StoredWall[]) =>
  a.length === b.length && a.every((w, i) => {
    const o = b[i]
    return w.id === o.id && w.a === o.a && w.b === o.b && w.faces.length === o.faces.length && w.faces.every((f, k) => sameFace(f, o.faces[k]))
  })

const sameNodes = (a: StoredNode[], b: StoredNode[]) =>
  a.length === b.length && a.every((n, i) => n.id === b[i].id && n.x === b[i].x && n.y === b[i].y)

/**
 * The stored graph of `rooms`, with the ids of `prev` where a wall or node is still the same.
 * `prev` may be undefined (first build, or an old client that dropped the fields).
 */
export function syncStoredGraph(prev: Prev, rooms: Room[]): { nodes: StoredNode[]; walls: StoredWall[] } {
  const g = buildWallGraph(rooms)
  const prevWalls = prev?.walls ?? []
  const prevNodes = prev?.nodes ?? []

  // ---- face keys of each new wall, and the start vertex of each face ----
  const keysOfWall = g.walls.map(() => new Set<string>())
  const wallIndex = new Map(g.walls.map((w, i) => [w.id, i]))
  const wallStartOfFace = new Map<number, string>()
  for (const [roomId, refs] of Object.entries(g.roomFaces)) {
    for (const ref of refs) {
      for (const fi of ref.faceIndexes) {
        const face = g.faces[fi]
        const wi = face && wallIndex.get(face.wallId)
        if (wi === undefined) continue
        keysOfWall[wi].add(`${roomId}:${ref.wallStart}`)
        if (!wallStartOfFace.has(fi)) wallStartOfFace.set(fi, ref.wallStart)
      }
    }
  }

  // ---- pass 1: match new walls to old walls by shared face keys ----
  const oldKeys = prevWalls.map((w) => new Set(w.faces.map(faceKey).filter((k): k is string => k !== null)))
  const pairs: { n: number; o: number; score: number }[] = []
  keysOfWall.forEach((keys, n) => {
    oldKeys.forEach((ok, o) => {
      let score = 0
      for (const k of keys) if (ok.has(k)) score++
      if (score > 0) pairs.push({ n, o, score })
    })
  })
  pairs.sort((p, q) => q.score - p.score || p.o - q.o || p.n - q.n)
  const idOfNew: (string | null)[] = g.walls.map(() => null)
  const oldOfNew: number[] = g.walls.map(() => -1)
  const oldUsed = new Set<number>()
  for (const p of pairs) {
    if (idOfNew[p.n] !== null || oldUsed.has(p.o)) continue
    idOfNew[p.n] = prevWalls[p.o].id
    oldOfNew[p.n] = p.o
    oldUsed.add(p.o)
  }

  // ---- pass 2: a split wall keeps its id on the LARGER part ----
  const nodePos = new Map(g.nodes.map((n) => [n.id, n]))
  const prevNodePos = new Map(prevNodes.map((n) => [n.id, n]))
  const lengthOf = (n: number) => {
    const a = nodePos.get(g.walls[n].a), b = nodePos.get(g.walls[n].b)
    return a && b ? dist(a, b) : 0
  }
  const lies = (n: number, oldWall: StoredWall): boolean => {
    const oa = prevNodePos.get(oldWall.a), ob = prevNodePos.get(oldWall.b)
    const a = nodePos.get(g.walls[n].a), b = nodePos.get(g.walls[n].b)
    if (!oa || !ob || !a || !b) return false
    return distToSegment(a, oa, ob) <= SAME_PLACE_CM && distToSegment(b, oa, ob) <= SAME_PLACE_CM
  }
  const unmatched = g.walls.map((_, n) => n).filter((n) => idOfNew[n] === null)
  for (let n = 0; n < g.walls.length; n++) {
    const o = oldOfNew[n]
    if (o < 0 || !unmatched.length) continue
    // Only the walls that had no match before this pass can take the id.
    const len = lengthOf(n)
    const best = unmatched
      .filter((m) => idOfNew[m] === null && lengthOf(m) > len + 1e-6 && lies(m, prevWalls[o]) && lies(n, prevWalls[o]))
      .sort((p, q) => lengthOf(q) - lengthOf(p) || p - q)[0]
    if (best === undefined) continue
    idOfNew[best] = idOfNew[n]
    oldOfNew[best] = o
    idOfNew[n] = null
    oldOfNew[n] = -1
    unmatched.push(n)
  }

  // ---- ids for the walls with no match ----
  let nextW = 0
  for (const w of prevWalls) nextW = Math.max(nextW, idNumber(w.id, 'W'))
  for (const id of idOfNew) if (id) nextW = Math.max(nextW, idNumber(id, 'W'))
  const wallIds = idOfNew.map((id) => id ?? `W${++nextW}`)

  // ---- nodes: vote by the wall ends, then by place ----
  const votes = new Map<string, number>()
  const vote = (nId: string, oId: string) => votes.set(`${nId}\u0000${oId}`, (votes.get(`${nId}\u0000${oId}`) ?? 0) + 1)
  g.walls.forEach((w, n) => {
    const o = oldOfNew[n]
    if (o < 0) return
    // Both ends: a wall that is not axis-aligned any more can swap its a and b ends. The true pair
    // is the one that gets a vote from every wall at the node; place breaks the rest.
    vote(w.a, prevWalls[o].a)
    vote(w.b, prevWalls[o].b)
    vote(w.a, prevWalls[o].b)
    vote(w.b, prevWalls[o].a)
  })
  const nodeCand: { n: string; o: string; votes: number; d: number }[] = []
  for (const n of g.nodes) {
    for (const o of prevNodes) {
      const v = votes.get(`${n.id}\u0000${o.id}`) ?? 0
      const d = dist(n, o)
      if (v > 0 || d <= SAME_PLACE_CM) nodeCand.push({ n: n.id, o: o.id, votes: v, d })
    }
  }
  const nodeOrder = new Map(g.nodes.map((n, i) => [n.id, i]))
  const prevOrder = new Map(prevNodes.map((n, i) => [n.id, i]))
  nodeCand.sort((p, q) => q.votes - p.votes || p.d - q.d || prevOrder.get(p.o)! - prevOrder.get(q.o)! || nodeOrder.get(p.n)! - nodeOrder.get(q.n)!)
  const nodeId = new Map<string, string>()
  const nodeUsed = new Set<string>()
  for (const c of nodeCand) {
    if (nodeId.has(c.n) || nodeUsed.has(c.o)) continue
    nodeId.set(c.n, c.o)
    nodeUsed.add(c.o)
  }
  let nextN = 0
  for (const n of prevNodes) nextN = Math.max(nextN, idNumber(n.id, 'N'))
  for (const id of nodeId.values()) nextN = Math.max(nextN, idNumber(id, 'N'))
  for (const n of g.nodes) if (!nodeId.has(n.id)) nodeId.set(n.id, `N${++nextN}`)

  // ---- output ----
  const nodes: StoredNode[] = g.nodes.map((n) => ({ id: nodeId.get(n.id)!, x: n.x, y: n.y }))
  const walls: StoredWall[] = g.walls.map((w, n) => ({
    id: wallIds[n],
    a: nodeId.get(w.a)!,
    b: nodeId.get(w.b)!,
    faces: g.faces
      .map((f, fi) => ({ f, fi }))
      .filter(({ f }) => f.wallId === w.id)
      .map(({ f, fi }): StoredFace => {
        const out: StoredFace = { side: f.side, from: f.from, to: f.to }
        if (f.roomId !== undefined) {
          out.roomId = f.roomId
          const ws = wallStartOfFace.get(fi)
          if (ws !== undefined) out.wallStart = ws
        }
        return out
      }),
  }))

  // Same content: give back the previous arrays (no new reference, no churn).
  return {
    nodes: prev?.nodes && sameNodes(prev.nodes, nodes) ? prev.nodes : nodes,
    walls: prev?.walls && sameWalls(prev.walls, walls) ? prev.walls : walls,
  }
}

/** True when the doc has rooms but no stored walls (an old document, or an old client dropped them). */
export const needsGraph = (d: { rooms: Room[]; walls?: StoredWall[] }): boolean => d.rooms.length > 0 && !(d.walls && d.walls.length)
