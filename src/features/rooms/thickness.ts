// Measured wall thickness (survey ID CODE-n-T, measured at a door or window frame). Pure, cm.
// No store or DOM imports: the API worker (core/commands.ts) uses this file too.
import { roomWalls } from '../../model/geometry'
import { parseThicknessLabel } from '../../model/survey'
import type { PlanDoc, WallAlign } from '../../model/types'
import { otherSides } from '../../model/wallSides'
import { wallProps } from './walls'

export { otherSides }

/** Set the thickness of wall `index` of the room, and of the same wall seen from the next rooms. */
export function setWallThickness<D extends Pick<PlanDoc, 'rooms'>>(doc: D, roomId: string, index: number, cm: number): D {
  const room = doc.rooms.find((r) => r.id === roomId)
  const w = room && roomWalls(room)[index]
  if (!room || !w || !(cm > 0)) return doc
  const targets = [{ room, index }, ...otherSides(doc, room, index)]
  const byRoom = new Map<string, string[]>()
  for (const t of targets) {
    const start = t.room.vertices[t.index].id
    byRoom.set(t.room.id, [...(byRoom.get(t.room.id) ?? []), start])
  }
  let changed = false
  const rooms = doc.rooms.map((r) => {
    const starts = byRoom.get(r.id)
    if (!starts) return r
    const walls = { ...r.walls }
    for (const s of starts) {
      const p = wallProps(r, s)
      if (p.thicknessCm === cm) continue
      walls[s] = { ...p, thicknessCm: cm }
      changed = true
    }
    return { ...r, walls }
  })
  return changed ? { ...doc, rooms } : doc
}

const MIRROR: Record<WallAlign, WallAlign> = { room: 'other', center: 'center', other: 'room' }

/**
 * Set the line of wall `index` that lines up with the next walls. The other side of the wall
 * gets the mirrored value ("face in this room" there is "face in the other room" here).
 */
export function setWallAlign<D extends Pick<PlanDoc, 'rooms'>>(doc: D, roomId: string, index: number, align: WallAlign): D {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room || !room.vertices[index]) return doc
  const want = new Map<string, Map<string, WallAlign>>()
  const add = (rid: string, start: string, a: WallAlign) => want.set(rid, (want.get(rid) ?? new Map()).set(start, a))
  add(room.id, room.vertices[index].id, align)
  for (const o of otherSides(doc, room, index)) add(o.room.id, o.room.vertices[o.index].id, MIRROR[align])
  return {
    ...doc,
    rooms: doc.rooms.map((r) => {
      const m = want.get(r.id)
      if (!m) return r
      const walls = { ...r.walls }
      for (const [start, a] of m) {
        const { align: _old, ...rest } = wallProps(r, start)
        walls[start] = a === 'room' ? rest : { ...rest, align: a }
      }
      return { ...r, walls }
    }),
  }
}

/** A thickness value was entered for `label`: copy it to the wall props. Other labels: no change. */
export function applyThicknessLabel<D extends Pick<PlanDoc, 'rooms'>>(doc: D, label: string, cm: number): D {
  const t = parseThicknessLabel(label)
  const room = t && doc.rooms.find((r) => r.code === t.code)
  return room && t ? setWallThickness(doc, room.id, t.index, cm) : doc
}
