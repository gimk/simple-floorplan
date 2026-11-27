// Convert a Simple Floorplan v1 export (joinville-plan.json bundle or a single v1 snapshot doc) to a v2 ProjectDoc.
import { parseProjectDoc, newId } from '../model/schema'
import type { Opening, OpeningKind, ProjectDoc, RefImage, Room, Vec } from '../model/types'
import { signedArea } from '../model/geometry'

export type ConvertV1Options = {
  refImageDataUrl?: string
  refImageName?: string
  refImageNaturalW?: number
  refImageNaturalH?: number
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isVec = (v: unknown): v is Vec => isRec(v) && isNum(v.x) && isNum(v.y)

/** A v1 snapshot doc: schemaVersion 1 or 2 with a rooms array. v2 docs use schemaVersion 3 and artboards. */
function isV1Doc(raw: unknown): raw is Rec {
  return isRec(raw) && (raw.schemaVersion === 1 || raw.schemaVersion === 2) && Array.isArray(raw.rooms)
}

/** A v1 bundle: { snapshots: [{ version, data }] }. */
function isV1Bundle(raw: unknown): raw is Rec {
  return isRec(raw) && Array.isArray(raw.snapshots) && raw.snapshots.some((s) => isRec(s) && isV1Doc(s.data))
}

export function isV1Export(raw: unknown): boolean {
  return isV1Bundle(raw) || isV1Doc(raw)
}

function latestV1Doc(raw: unknown): Rec {
  if (isV1Doc(raw)) return raw
  if (!isV1Bundle(raw)) throw new Error('Not a v1 floorplan export')
  const snaps = (raw.snapshots as unknown[]).filter((s): s is Rec => isRec(s) && isV1Doc(s.data))
  const ver = (s: Rec) => (isNum(s.version) ? s.version : -Infinity)
  const best = snaps.reduce((a, b) => (ver(b) >= ver(a) ? b : a))
  return best.data as Rec
}

const r2 = (n: number) => Math.round(n * 100) / 100

type V1Room = { id: string; name: string; vertices: { id: string; x: number; y: number }[] }

function readRooms(doc: Rec): V1Room[] {
  const out: V1Room[] = []
  for (const r of doc.rooms as unknown[]) {
    if (!isRec(r) || typeof r.id !== 'string' || !Array.isArray(r.vertices)) continue
    const vs = r.vertices.filter(isVec).map((v, i) => {
      const id = isRec(v) && typeof (v as Rec).id === 'string' ? ((v as Rec).id as string) : `${r.id}-v${i}`
      return { id, x: v.x, y: v.y }
    })
    if (vs.length < 3) continue
    out.push({ id: r.id, name: typeof r.name === 'string' ? r.name : '', vertices: vs })
  }
  return out
}

export function convertV1ToV2(raw: unknown, opts: ConvertV1Options = {}): ProjectDoc {
  const doc = latestV1Doc(raw)
  const rooms = readRooms(doc)
  if (rooms.length === 0) throw new Error('v1 export has no rooms')

  // Shift so the bounding box starts at (0, 0).
  let minX = Infinity, minY = Infinity
  for (const r of rooms) for (const v of r.vertices) { minX = Math.min(minX, v.x); minY = Math.min(minY, v.y) }

  // Openings first, in the original vertex order (edge i = vertex i -> i+1).
  const openings: Opening[] = []
  const byId = new Map(rooms.map((r) => [r.id, r]))
  const elements = Array.isArray(doc.elements) ? doc.elements : []
  for (const e of elements) {
    if (!isRec(e) || typeof e.roomId !== 'string' || typeof e.wallStart !== 'string' || !isNum(e.widthCm) || e.widthCm <= 0) continue
    const kind = e.kind
    if (kind !== 'door' && kind !== 'window' && kind !== 'opening') continue
    const room = byId.get(e.roomId)
    if (!room) continue
    const i = room.vertices.findIndex((v) => v.id === e.wallStart)
    if (i < 0) continue
    const a = room.vertices[i], b = room.vertices[(i + 1) % room.vertices.length]
    const dx = b.x - a.x, dy = b.y - a.y
    const L = Math.hypot(dx, dy)
    if (L === 0) continue
    const start = isNum(e.alongCm) ? e.alongCm : isNum(e.offsetCm) ? e.offsetCm : 0
    const t = (start + e.widthCm / 2) / L
    const o: Opening = {
      id: typeof e.id === 'string' && e.id ? e.id : newId(),
      kind: kind as OpeningKind,
      roomId: room.id,
      xCm: r2(a.x + dx * t - minX),
      yCm: r2(a.y + dy * t - minY),
      angleDeg: r2((Math.atan2(dy, dx) * 180) / Math.PI),
      widthCm: e.widthCm,
    }
    if (kind === 'door') {
      o.hinge = e.hinge === 'right' ? 'right' : 'left'
      o.swing = e.swing === 'out' ? 'out' : 'in'
    }
    const v = e.variant
    if (kind === 'door') {
      if (v === 'sliding') o.variant = 'bypass'
      else if (v === 'pocket' || v === 'bypass' || v === 'french') o.variant = v
    } else if (kind === 'window' && v === 'sliding') o.variant = 'sliding'
    if (isNum(e.heightCm) && e.heightCm > 0) o.heightCm = e.heightCm
    if (isNum(e.sillCm) && e.sillCm >= 0) o.sillCm = e.sillCm
    openings.push(o)
  }

  // Rooms: shift, then force clockwise on a y-down screen (positive signed area).
  const outRooms: Room[] = rooms.map((r) => {
    let vs = r.vertices.map((v) => ({ x: r2(v.x - minX), y: r2(v.y - minY) }))
    if (signedArea(vs) < 0) vs = vs.reverse()
    return { id: r.id, name: r.name, vertices: vs }
  })

  const artboard = {
    id: newId(),
    name: 'Plan A',
    xCm: 0,
    yCm: 0,
    ceilingHeightCm: isRec(doc.apartment) && isNum(doc.apartment.defaultCeilingCm) && doc.apartment.defaultCeilingCm > 0 ? doc.apartment.defaultCeilingCm : 250,
    precisionCm: 1 as const,
    rooms: outRooms,
    openings,
    furniture: [],
  }

  const refImages: RefImage[] = []
  const bg = doc.background
  if (isRec(bg) && opts.refImageDataUrl && isNum(bg.xCm) && isNum(bg.yCm) && isNum(bg.cmPerPx) && bg.cmPerPx > 0) {
    const w = opts.refImageNaturalW ?? (isNum(bg.naturalWidth) ? bg.naturalWidth : 0)
    const h = opts.refImageNaturalH ?? (isNum(bg.naturalHeight) ? bg.naturalHeight : 0)
    if (w > 0 && h > 0) {
      refImages.push({
        id: newId(),
        name: opts.refImageName ?? 'Reference scan',
        src: opts.refImageDataUrl,
        naturalWidth: w,
        naturalHeight: h,
        xCm: bg.xCm - minX,
        yCm: bg.yCm - minY,
        cmPerPx: bg.cmPerPx,
        rotationDeg: isNum(bg.rotationDeg) ? bg.rotationDeg : 0,
        opacity: isNum(bg.opacity) ? Math.min(1, Math.max(0, bg.opacity)) : 0.5,
        visible: typeof bg.visible === 'boolean' ? bg.visible : true,
        locked: typeof bg.locked === 'boolean' ? bg.locked : false,
      })
    }
  }

  const title = typeof doc.title === 'string' && doc.title.trim() ? doc.title : 'Imported v1 project'
  const res = parseProjectDoc({ schemaVersion: 3, id: newId(), title, refImages, artboards: [artboard] })
  if (!res.ok) throw new Error(`v1 conversion produced an invalid document: ${res.error}`)
  return res.doc
}
