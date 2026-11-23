// Keep on-site measurements on their wall when a room outline changes (cutout, slice, merge,
// corner added or removed). Labels are positional (CODE-n = n-th wall in corner order), so an
// outline change renumbers walls. A wall is identified by its two corner ids:
//   - a wall whose two corners are still next to each other (same order) keeps its value,
//     under its new label (possibly in another room, after a slice or a merge);
//   - a wall that was split or removed loses its value: it must be measured again.
// Thicknesses (CODE-n-T) follow their wall like CODE-n. Diagonals (CODE-D) follow their two corners; heights (CODE-H) follow the room, and rooms
// cut out of a measured room get its height too. Pure, no store imports.
import { labelRoomCode } from './survey'
import type { Measurement, PlanDoc, Room } from './types'

type Doc = Pick<PlanDoc, 'rooms' | 'measurements'>

/** Corner order, diagonal and code of every room: changes only when an outline changes. */
const topology = (rooms: Room[]) =>
  rooms.map((r) => `${r.id}|${r.code}|${r.vertices.map((v) => v.id).join(',')}|${r.diagonal?.join(',') ?? ''}`).join(';')

export type RelabelResult = {
  measurements: PlanDoc['measurements']
  /** Labels (before the change) whose wall was split or removed, in rooms that still exist. */
  dropped: string[]
}

/**
 * New measurements for `after`, or null when nothing needs to move: the outlines did not change,
 * or the change itself already edited the measurements (a value entered, a room code renamed).
 * `now` is the updatedAt of moved values, so the server's last-write-wins keeps them.
 */
export function relabelMeasurements(before: Doc, after: Doc, now: string): RelabelResult | null {
  if (after.measurements !== before.measurements) return null
  if (topology(before.rooms) === topology(after.rooms)) return null
  const m = before.measurements
  if (!Object.keys(m).length) return null

  // Where each wall (corner a -> corner b) is now.
  const walls = new Map<string, { room: Room; index: number }[]>()
  for (const r of after.rooms) {
    const n = r.vertices.length
    r.vertices.forEach((v, i) => {
      const k = v.id + '>' + r.vertices[(i + 1) % n].id
      walls.set(k, [...(walls.get(k) ?? []), { room: r, index: i }])
    })
  }
  const afterById = new Map(after.rooms.map((r) => [r.id, r]))
  const beforeIds = new Set(before.rooms.map((r) => r.id))
  const beforeCodes = new Set(before.rooms.map((r) => r.code))
  const codeOf = labelRoomCode

  const out: PlanDoc['measurements'] = {}
  const put = (label: string, src: Measurement, moved: boolean) => {
    const v: Measurement = moved ? { ...src, label, updatedAt: now } : src
    const cur = out[label]
    if (!cur || cur.updatedAt <= v.updatedAt) out[label] = v
  }
  // Values not tied to a room of the plan (old codes, tapes) stay as they are.
  for (const [label, v] of Object.entries(m)) if (!beforeCodes.has(codeOf(label))) put(label, v, false)

  const dropped: string[] = []
  for (const r of before.rooms) {
    const n = r.vertices.length
    const stillThere = afterById.has(r.id)
    const ids = new Set(r.vertices.map((v) => v.id))
    // Rooms that hold corners of this room now (the room itself, pieces cut out of it, a merged room).
    const heirs = after.rooms.filter((a) => a.id === r.id || a.vertices.some((v) => ids.has(v.id)))
    const lost = (label: string) => { if (stillThere || heirs.length) dropped.push(label) }

    r.vertices.forEach((v, i) => {
      // The wall length CODE-n and the wall thickness CODE-n-T follow the wall.
      for (const suffix of ['', '-T']) {
        const label = `${r.code}-${i + 1}${suffix}`
        const val = m[label]
        if (!val) continue
        const hits = walls.get(v.id + '>' + r.vertices[(i + 1) % n].id)
        const hit = hits?.find((h) => h.room.id === r.id) ?? hits?.[0]
        if (!hit) { lost(label); continue }
        const nl = `${hit.room.code}-${hit.index + 1}${suffix}`
        put(nl, val, nl !== label)
      }
    })

    const dLabel = `${r.code}-D`
    if (m[dLabel]) {
      const pair = r.diagonal ? new Set(r.diagonal.map((k) => r.vertices[k]?.id)) : null
      const same = (a: Room) => !!a.diagonal && !!pair && a.diagonal.every((k) => pair.has(a.vertices[k]?.id))
      const to = heirs.find((a) => a.id === r.id && same(a)) ?? heirs.find(same)
      if (to) put(`${to.code}-D`, m[dLabel], to.code !== r.code)
      else lost(dLabel)
    }

    const hLabel = `${r.code}-H`
    if (m[hLabel]) {
      for (const a of heirs) {
        // The room itself, and new rooms made from it (not an older room it was merged into).
        if (a.id !== r.id && beforeIds.has(a.id)) continue
        put(`${a.code}-H`, m[hLabel], a.code !== r.code || a.id !== r.id)
      }
    }
  }

  const same = Object.keys(out).length === Object.keys(m).length && Object.entries(out).every(([k, v]) => m[k] === v)
  return same ? null : { measurements: out, dropped }
}
