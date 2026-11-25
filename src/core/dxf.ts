// Pure ASCII DXF R12 (AC1009) exporter for PlanDoc. Zero dependencies — safe for
// browser, Node, Cloudflare Workers and the CLI. World units are CENTIMETERS.
// DXF convention is y-up, so world y is flipped (yDxf = -yWorld); angles are
// measured CCW in DXF space. $INSUNITS = 5 (centimeters).
//
// Layers: ROOMS, WALLS_BEARING, WALLS_PARTITION, WALLS_EXTERIOR, DOORS, WINDOWS,
// STORAGE (standing fixtures), DIMENSIONS, TEXT.
// R12 has no LWPOLYLINE: room outlines are POLYLINE (closed, flag 70=1) + VERTEX
// + SEQEND; walls are pairs of LINE entities (both faces); door swings are ARC + leaf
// LINE; room labels and wall dimensions are TEXT.
import { labelPoint, roomAreaM2, roomWalls, type Wall } from '../model/geometry'
import type { ElementKind, PlanDoc, Room, Vec, WallElement } from '../model/types'
import { elementFrame, wallThickness } from '../features/elements/geometry'

export const DXF_LAYERS = [
  'ROOMS',
  'WALLS_BEARING',
  'WALLS_PARTITION',
  'WALLS_EXTERIOR',
  'DOORS',
  'WINDOWS',
  'STORAGE',
  'DIMENSIONS',
  'TEXT',
] as const

export type DxfOptions = {
  /** Include wall dimension lines + labels (DIMENSIONS layer). Default true. */
  dimensions?: boolean
}

// ---------- low-level ----------

type E = (code: number, value: string | number) => void

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)
const norm360 = (a: number) => ((a % 360) + 360) % 360
/** World vector -> DXF angle in degrees (y flipped). */
const angleOf = (v: Vec) => norm360((Math.atan2(-v.y, v.x) * 180) / Math.PI)
/** World point -> DXF point (y flipped). */
const P = (p: Vec) => ({ x: p.x, y: -p.y })

const escText = (s: string) => s.replace(/[\r\n]+/g, ' ')

// ---------- entity emitters ----------

function line(e: E, layer: string, a: Vec, b: Vec) {
  const pa = P(a)
  const pb = P(b)
  e(0, 'LINE')
  e(8, layer)
  e(10, fmt(pa.x))
  e(20, fmt(pa.y))
  e(11, fmt(pb.x))
  e(21, fmt(pb.y))
}

function text(e: E, layer: string, at: Vec, height: number, value: string) {
  const p = P(at)
  e(0, 'TEXT')
  e(8, layer)
  e(10, fmt(p.x))
  e(20, fmt(p.y))
  e(40, fmt(height))
  e(1, escText(value))
}

/** R12 closed polygon: POLYLINE + VERTEX per point + SEQEND. */
function polyline(e: E, layer: string, ring: Vec[], closed: boolean) {
  e(0, 'POLYLINE')
  e(8, layer)
  e(66, 1)
  e(70, closed ? 1 : 0)
  for (const v of ring) {
    const p = P(v)
    e(0, 'VERTEX')
    e(8, layer)
    e(10, fmt(p.x))
    e(20, fmt(p.y))
  }
  e(0, 'SEQEND')
}

function arc(e: E, layer: string, center: Vec, radius: number, startDeg: number, endDeg: number) {
  const c = P(center)
  e(0, 'ARC')
  e(8, layer)
  e(10, fmt(c.x))
  e(20, fmt(c.y))
  e(40, fmt(radius))
  e(50, fmt(norm360(startDeg)))
  e(51, fmt(norm360(endDeg)))
}

// ---------- geometry helpers ----------

const WALL_LAYER: Record<string, string> = {
  bearing: 'WALLS_BEARING',
  partition: 'WALLS_PARTITION',
  exterior: 'WALLS_EXTERIOR',
}

const KIND_LAYER: Record<ElementKind, string> = {
  door: 'DOORS',
  opening: 'DOORS',
  window: 'WINDOWS',
  radiator: 'STORAGE',
  other: 'STORAGE',
}

/** Both wall faces as LINE pair. */
function emitWall(e: E, room: Room, wall: Wall) {
  const t = wallThickness(room, wall.start.id)
  const type = room.walls[wall.start.id]?.type ?? 'partition'
  const layer = WALL_LAYER[type]
  const h = t / 2
  const n = { x: -wall.dir.y, y: wall.dir.x } // perpendicular
  line(e, layer, { x: wall.start.x + n.x * h, y: wall.start.y + n.y * h }, { x: wall.end.x + n.x * h, y: wall.end.y + n.y * h })
  line(e, layer, { x: wall.start.x - n.x * h, y: wall.start.y - n.y * h }, { x: wall.end.x - n.x * h, y: wall.end.y - n.y * h })
}

function emitElement(e: E, room: Room, wall: Wall, el: WallElement) {
  const layer = KIND_LAYER[el.kind]
  const f = elementFrame(wall, el)
  const t = wallThickness(room, wall.start.id)

  if (el.kind === 'door') {
    // Hinge at near edge (hinge=start) or far edge (hinge=end) of the opening.
    const hinge = el.hinge === 'end' ? f.b : f.a
    const closedDir = el.hinge === 'end' ? { x: -f.dir.x, y: -f.dir.y } : f.dir
    const swingSide = el.swing === 'out' ? { x: -wall.inward.x, y: -wall.inward.y } : wall.inward
    // Open leaf = closed direction rotated 90° toward the swing side.
    const r1 = { x: -closedDir.y, y: closedDir.x }
    const r2 = { x: closedDir.y, y: -closedDir.x }
    const openDir = r1.x * swingSide.x + r1.y * swingSide.y >= r2.x * swingSide.x + r2.y * swingSide.y ? r1 : r2
    const a0 = angleOf(closedDir)
    const a1 = angleOf(openDir)
    const [start, end] = norm360(a1 - a0) === 90 ? [a0, a1] : [a1, a0]
    arc(e, layer, hinge, el.widthCm, start, end)
    line(e, layer, hinge, { x: hinge.x + openDir.x * el.widthCm, y: hinge.y + openDir.y * el.widthCm })
    return
  }

  if (el.kind === 'opening') {
    // Jambs across the wall thickness.
    const h = t / 2
    const n = { x: -f.dir.y, y: f.dir.x }
    line(e, layer, { x: f.a.x + n.x * h, y: f.a.y + n.y * h }, { x: f.a.x - n.x * h, y: f.a.y - n.y * h })
    line(e, layer, { x: f.b.x + n.x * h, y: f.b.y + n.y * h }, { x: f.b.x - n.x * h, y: f.b.y - n.y * h })
    return
  }

  if (el.kind === 'window') {
    // Both wall faces across the opening + center line.
    const h = t / 2
    const n = { x: -f.dir.y, y: f.dir.x }
    line(e, layer, { x: f.a.x + n.x * h, y: f.a.y + n.y * h }, { x: f.b.x + n.x * h, y: f.b.y + n.y * h })
    line(e, layer, { x: f.a.x - n.x * h, y: f.a.y - n.y * h }, { x: f.b.x - n.x * h, y: f.b.y - n.y * h })
    line(e, layer, f.a, f.b)
    return
  }

  // radiator / other: rectangle protruding inward by depthCm.
  const depth = el.depthCm ?? 30
  const a2 = { x: f.a.x + wall.inward.x * depth, y: f.a.y + wall.inward.y * depth }
  const b2 = { x: f.b.x + wall.inward.x * depth, y: f.b.y + wall.inward.y * depth }
  polyline(e, layer, [f.a, f.b, b2, a2], true)
}

/** Simple dimension: extension lines + dimension line offset outward, with a label. */
function emitDimension(e: E, room: Room, wall: Wall, index: number) {
  const label = `${room.code}-${index + 1}`
  const out = { x: -wall.inward.x, y: -wall.inward.y }
  const ext = 5
  const off = 14
  const p = (v: Vec, d: number) => ({ x: v.x + out.x * d, y: v.y + out.y * d })
  line(e, 'DIMENSIONS', p(wall.start, 0), p(wall.start, off + ext))
  line(e, 'DIMENSIONS', p(wall.end, 0), p(wall.end, off + ext))
  line(e, 'DIMENSIONS', p(wall.start, off), p(wall.end, off))
  text(
    e,
    'DIMENSIONS',
    { x: (wall.start.x + wall.end.x) / 2 + out.x * (off + 8), y: (wall.start.y + wall.end.y) / 2 + out.y * (off + 8) },
    8,
    `${label} ${fmt(wall.length)}`,
  )
}

// ---------- main ----------

export function planToDxf(doc: PlanDoc, opts: DxfOptions = {}): string {
  const withDims = opts.dimensions !== false
  const lines: string[] = []
  const e: E = (code, value) => {
    lines.push(String(code), String(value))
  }

  // Bounds (world) for $EXTMIN/$EXTMAX.
  const pts: Vec[] = doc.rooms.flatMap((r) => [...r.vertices, ...(r.holes ?? []).flat()])
  if (doc.elements?.length) {
    for (const el of doc.elements) {
      const room = doc.rooms.find((r) => r.id === el.roomId)
      const wall = room ? roomWalls(room).find((w) => w.start.id === el.wallStart) : undefined
      if (room && wall) {
        const f = elementFrame(wall, el)
        pts.push(f.a, f.b)
      }
    }
  }
  const minX = pts.length ? Math.min(...pts.map((p) => p.x)) : 0
  const maxX = pts.length ? Math.max(...pts.map((p) => p.x)) : 400
  const minY = pts.length ? Math.min(...pts.map((p) => p.y)) : 0
  const maxY = pts.length ? Math.max(...pts.map((p) => p.y)) : 300

  // HEADER
  e(999, 'Simple Floorplan DXF R12 export — units: centimeters, y axis flipped (DXF y-up)')
  e(0, 'SECTION')
  e(2, 'HEADER')
  e(9, '$ACADVER')
  e(1, 'AC1009')
  e(9, '$INSUNITS')
  e(70, 5) // 5 = centimeters
  e(9, '$EXTMIN')
  e(10, fmt(minX))
  e(20, fmt(-maxY))
  e(30, '0.0')
  e(9, '$EXTMAX')
  e(10, fmt(maxX))
  e(20, fmt(-minY))
  e(30, '0.0')
  e(0, 'ENDSEC')

  // TABLES (layers)
  e(0, 'SECTION')
  e(2, 'TABLES')
  e(0, 'TABLE')
  e(2, 'LAYER')
  e(70, DXF_LAYERS.length)
  for (const name of DXF_LAYERS) {
    e(0, 'LAYER')
    e(2, name)
    e(70, 0)
    e(62, 7)
    e(6, 'CONTINUOUS')
  }
  e(0, 'ENDTAB')
  e(0, 'ENDSEC')

  // ENTITIES
  e(0, 'SECTION')
  e(2, 'ENTITIES')

  for (const room of doc.rooms) {
    polyline(e, 'ROOMS', room.vertices, true)
    for (const hole of room.holes ?? []) polyline(e, 'ROOMS', hole, true)

    const walls = roomWalls(room)
    for (const wall of walls) emitWall(e, room, wall)
    if (withDims) walls.forEach((wall, i) => emitDimension(e, room, wall, i))

    // Room label inside the room, at its widest place.
    const c = labelPoint([room.vertices, ...(room.holes ?? [])])
    text(e, 'TEXT', c, 15, `${room.code} ${room.name} ${String(Math.round(roomAreaM2(room) * 100) / 100)} m2`)
  }

  for (const el of doc.elements ?? []) {
    const room = doc.rooms.find((r) => r.id === el.roomId)
    if (!room) continue
    const wall = roomWalls(room).find((w) => w.start.id === el.wallStart)
    if (!wall) continue
    emitElement(e, room, wall, el)
  }

  e(0, 'ENDSEC')
  e(0, 'EOF')
  return lines.join('\n') + '\n'
}
