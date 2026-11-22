// Concise line-based text DSL (.sfp) for PlanDoc — bidirectional, diffable, ~10x fewer
// tokens than the equivalent JSON. Pure module: zero React/DOM, safe for browser, Node,
// Cloudflare Workers and the CLI. World units are CENTIMETERS (x right, y down).
//
// ── Grammar (EBNF-ish) ──────────────────────────────────────────────────────────
//   file      := header ( stmt | blank | comment )*
//   header    := "plan" STRING ( "version=" INT )? ( "unit=cm" )?
//   comment   := "#" ...end of line
//   stmt      := room | tape | pin | measure | apartment | ref   (top level)
//   apartment := "apartment" ( "ceiling" ( "=" )? num )*
//   ref       := "ref" SOURCE num ( STRING )? refAttr*
//   refAttr   := "id=" WORD | "room=" CODE | "date=" STRING | "note=" STRING
//   SOURCE    := dpe | carrez | boutin | deed | listing | other
//   room      := "room" CODE STRING shape attr* NL roomLine*
//   shape     := "poly(" pt ( WS pt )* ")"  |  "rect(" x "," y " " w "x" h ")"
//   pt        := ( ID ":" )? x "," y                 (WS = whitespace)
//   attr      := "id=" WORD | "ceiling=" num | "walk=" num | "outdoor" | "diag=" i "," j
//   roomLine  := INDENT ( wall | hole | element | measure | note | pin )
//   wall      := "wall" LABEL ( WALLTYPE | THICK | "locked" )*
//   hole      := "hole" "poly(" pt ( WS pt )* ")"
//   element   := KIND LABEL elemAttr*
//   KIND      := door | window | opening | cupboard | radiator | other
//   elemAttr  := "id=" WORD | "at=" num | "w=" num | "h=" num | "sill=" num
//              | "depth=" num | "hinge=" (start|end) | "swing=" (in|out)
//              | "note=" STRING | VARIANT          (VARIANT = bare word, e.g. "french")
//   measure   := "measure" pair ( WS pair )*        pair := LABEL (WS)? "=" (WS)? num
//   note      := "note" STRING
//   pin       := "pin" pinAttr*   pinAttr := "id=" WORD | "at(" x "," y ")" | "wall=" LABEL
//              | "wallid=" WORD | "room=" CODE | "text=" STRING | "photos=" WORD ("," WORD)*
//   tape      := "tape" tapeAttr*  tapeAttr := "id=" WORD | "from(" x "," y ")" | "to(" x "," y ")"
//              | "=" num | "label=" STRING | "note=" STRING | "room=" CODE
//   LABEL     := CODE "-" DIGITS          (wall survey label, e.g. "SE-2"; 1-based polygon order)
//   CODE      := [A-Za-z0-9_]+
//   STRING    := double-quoted, JSON escapes (\" \\ \n ...)
//   THICK     := num "cm"                 (e.g. "30cm")
//
// Wall labels map to polygon order: wall "SE-2" starts at vertices[1]. Vertex ids are
// regenerated deterministically on parse (v_<code>_<i>); the writer only emits an explicit
// id when it differs from that default, so text stays compact and stable across round-trips.
// Same for room ids (room_<code>), element ids (el_<code>_<wall>_<k>), pins (pin_<n>),
// tapes (tape_<n>). Measurements keep their baseDoc updatedAt when the label already exists.
//
// Example:
//   plan "Apartment 4B" version=1 unit=cm
//   room EN "Entry" rect(0,0 180x240) ceiling=265 walk=1
//     wall EN-1 exterior 30cm
//     door EN-1 at=40 w=90 h=204 single hinge=start swing=in
//     measure EN-1=181 EN-H=265
//     note "Electrical panel near EN-4"
//   room SE "Living Room" poly(180,0 600,0 600,420 180,420) ceiling=265 walk=2
//     wall SE-2 bearing 25cm
//     window SE-1 at=80 w=160 h=140 sill=90 french
//     measure SE-1=421 SE-D=594

import { roomWalls } from '../model/geometry'
import { surveyIds } from '../model/survey'
import type {
  ElementKind,
  ElementVariant,
  Pin,
  PlanDoc,
  Room,
  SurfaceReference,
  SurfaceReferenceSource,
  TapeMeasure,
  WallElement,
  WallProps,
  WallType,
  Vertex,
} from '../model/types'
import { parsePlan, type PlanDocV1 } from './schema'

// ---------- errors ----------

export class DslParseError extends Error {
  readonly line: number
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`)
    this.name = 'DslParseError'
    this.line = line
  }
}

// ---------- deterministic ids ----------

const safe = (code: string) => code.replace(/[^A-Za-z0-9_]/g, '_')
const defaultRoomId = (code: string) => `room_${safe(code)}`
const defaultVertexId = (code: string, i: number) => `v_${safe(code)}_${i}`
const defaultHoleVertexId = (code: string, hi: number, i: number) => `v_${safe(code)}_h${hi}_${i}`
const defaultElementId = (code: string, wallIndex1: number, k: number) => `el_${safe(code)}_${wallIndex1}_${k}`
const defaultPinId = (n: number) => `pin_${n}`
const defaultTapeId = (n: number) => `tape_${n}`
const defaultReferenceId = (n: number) => `ref_${n}`

// ---------- number / string formatting ----------

/** Round to 2 decimals and trim: 412.5 -> "412.5", 400 -> "400". */
const fmtNum = (n: number): string => {
  const r = Math.round(n * 100) / 100
  return String(Object.is(r, -0) ? 0 : r)
}

const q = (s: string) => JSON.stringify(s)

// ---------- writer ----------

const DEFAULT_T: Record<WallType, number> = { partition: 10, bearing: 25, exterior: 30 }

const isDefaultWall = (p: WallProps | undefined): boolean =>
  !p || (p.type === 'partition' && p.thicknessCm === DEFAULT_T.partition && !p.locked)

/** True when the 4 vertices are exactly the canonical rect order (min,min)(max,min)(max,max)(min,max). */
function asRect(r: Room): { x: number; y: number; w: number; h: number } | null {
  const v = r.vertices
  if (v.length !== 4) return null
  const xs = v.map((p) => p.x)
  const ys = v.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const eps = 1e-9
  const ok =
    Math.abs(v[0].x - minX) < eps && Math.abs(v[0].y - minY) < eps &&
    Math.abs(v[1].x - maxX) < eps && Math.abs(v[1].y - minY) < eps &&
    Math.abs(v[2].x - maxX) < eps && Math.abs(v[2].y - maxY) < eps &&
    Math.abs(v[3].x - minX) < eps && Math.abs(v[3].y - maxY) < eps
  if (!ok || maxX - minX <= 0 || maxY - minY <= 0) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function fmtPt(v: Vertex, defaultId: string): string {
  const core = `${fmtNum(v.x)},${fmtNum(v.y)}`
  return v.id !== defaultId ? `${v.id}:${core}` : core
}

function fmtPoly(pts: Vertex[], idOf: (i: number) => string): string {
  return `poly(${pts.map((p, i) => fmtPt(p, idOf(i))).join(' ')})`
}

const ELEMENT_KINDS: ElementKind[] = ['door', 'window', 'opening', 'cupboard', 'radiator', 'other']
const VARIANTS = new Set<string>([
  'single', 'double', 'sliding', 'pocket',
  'standard', 'french', 'fixed',
  'wall-cabinet', 'recessed', 'wardrobe',
])

export function planToDsl(doc: PlanDoc): string {
  const out: string[] = []
  out.push(`plan ${q(doc.title ?? '')} version=1 unit=cm`)

  // Apartment data (optional): default ceiling height, then reference surfaces.
  const defaultCeiling = doc.apartment?.defaultCeilingCm
  if (defaultCeiling != null) out.push(`apartment ceiling ${fmtNum(defaultCeiling)}`)
  ;(doc.apartment?.references ?? []).forEach((r, i) => {
    const parts = ['ref', r.source, fmtNum(r.surfaceM2)]
    if (r.label != null) parts.push(q(r.label))
    if (r.id !== defaultReferenceId(i)) parts.push(`id=${r.id}`)
    if (r.roomCode != null) parts.push(`room=${r.roomCode}`)
    if (r.date != null) parts.push(`date=${q(r.date)}`)
    if (r.note != null) parts.push(`note=${q(r.note)}`)
    out.push(parts.join(' '))
  })

  const rooms = [...doc.rooms].sort((a, b) => a.walkOrder - b.walkOrder || a.code.localeCompare(b.code))
  const pins = doc.pins ?? []
  const tapes = doc.tapes ?? []

  // Global ordinals for deterministic pin/tape ids, in emission order.
  let pinCounter = 0
  let tapeCounter = 0

  // Measurements grouped by room code (label = "<CODE>-<suffix>"; codes contain no "-").
  const byRoom = new Map<string, [string, number][]>()
  const unmatched: [string, number][] = []
  for (const [label, m] of Object.entries(doc.measurements ?? {})) {
    const dash = label.lastIndexOf('-')
    const code = dash > 0 ? label.slice(0, dash) : ''
    const entry: [string, number] = [label, m.actualCm]
    if (code && rooms.some((r) => r.code === code)) {
      const arr = byRoom.get(code) ?? []
      arr.push(entry)
      byRoom.set(code, arr)
    } else {
      unmatched.push(entry)
    }
  }

  rooms.forEach((r, ri) => {
    out.push('')
    const rect = asRect(r)
    const shape = rect
      ? `rect(${fmtNum(rect.x)},${fmtNum(rect.y)} ${fmtNum(rect.w)}x${fmtNum(rect.h)})`
      : fmtPoly(r.vertices, (i) => defaultVertexId(r.code, i))
    const attrs: string[] = []
    if (r.id !== defaultRoomId(r.code)) attrs.push(`id=${r.id}`)
    if (r.ceilingCm != null) attrs.push(`ceiling=${fmtNum(r.ceilingCm)}`)
    if (r.walkOrder !== ri + 1) attrs.push(`walk=${fmtNum(r.walkOrder)}`)
    if (r.outdoor) attrs.push('outdoor')
    if (r.diagonal) attrs.push(`diag=${r.diagonal[0]},${r.diagonal[1]}`)
    out.push(`room ${r.code} ${q(r.name)} ${shape}${attrs.length ? ' ' + attrs.join(' ') : ''}`)

    // Walls (only non-default).
    const walls = roomWalls(r)
    walls.forEach((w) => {
      const p = r.walls[w.start.id]
      if (isDefaultWall(p)) return
      const label = `${r.code}-${w.index + 1}`
      const parts = [`wall ${label}`]
      if (p!.type !== 'partition' || p!.thicknessCm !== DEFAULT_T.partition || p!.locked) parts.push(p!.type)
      if (p!.thicknessCm !== DEFAULT_T[p!.type]) parts.push(`${fmtNum(p!.thicknessCm)}cm`)
      if (p!.locked) parts.push('locked')
      out.push(`  ${parts.join(' ')}`)
    })

    // Holes.
    ;(r.holes ?? []).forEach((hole, hi) => {
      out.push(`  hole ${fmtPoly(hole, (i) => defaultHoleVertexId(r.code, hi, i))}`)
    })

    // Elements in doc order; default id = per-wall ordinal in emission order.
    const perWallCount = new Map<string, number>()
    for (const el of doc.elements ?? []) {
      if (el.roomId !== r.id) continue
      const w = walls.find((ww) => ww.start.id === el.wallStart)
      if (!w) throw new Error(`planToDsl: element ${el.id} references unknown wallStart ${el.wallStart} in room ${r.code}`)
      const k = perWallCount.get(el.wallStart) ?? 0
      perWallCount.set(el.wallStart, k + 1)
      const parts = [el.kind, `${r.code}-${w.index + 1}`]
      if (el.id !== defaultElementId(r.code, w.index + 1, k)) parts.push(`id=${el.id}`)
      parts.push(`at=${fmtNum(el.offsetCm)}`, `w=${fmtNum(el.widthCm)}`)
      if (el.heightCm != null) parts.push(`h=${fmtNum(el.heightCm)}`)
      if (el.sillCm != null) parts.push(`sill=${fmtNum(el.sillCm)}`)
      if (el.depthCm != null) parts.push(`depth=${fmtNum(el.depthCm)}`)
      if (el.variant) parts.push(el.variant)
      if (el.hinge) parts.push(`hinge=${el.hinge}`)
      if (el.swing) parts.push(`swing=${el.swing}`)
      if (el.note) parts.push(`note=${q(el.note)}`)
      out.push(`  ${parts.join(' ')}`)
    }

    // Measurements for this room, in survey order (walls, diagonal, height).
    const roomMeas = byRoom.get(r.code)
    if (roomMeas && roomMeas.length) {
      const order = new Map(surveyIds(r).map((s, i) => [s.label, i]))
      roomMeas.sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999) || a[0].localeCompare(b[0]))
      out.push(`  measure ${roomMeas.map(([l, v]) => `${l}=${fmtNum(v)}`).join(' ')}`)
    }

    const note = doc.roomNotes?.[r.code]
    if (note) out.push(`  note ${q(note)}`)

    // Room pins in doc order.
    for (const p of pins) {
      if (p.roomId !== r.id) continue
      const parts = ['pin', `at(${fmtNum(p.at.x)},${fmtNum(p.at.y)})`]
      const id = defaultPinId(pinCounter++)
      if (p.id !== id) parts.push(`id=${p.id}`)
      if (p.wallStart) {
        const w = walls.find((ww) => ww.start.id === p.wallStart)
        if (w) parts.push(`wall=${r.code}-${w.index + 1}`)
        else parts.push(`wallid=${p.wallStart}`)
      }
      if (p.text) parts.push(`text=${q(p.text)}`)
      if (p.photoKeys.length) parts.push(`photos=${p.photoKeys.join(',')}`)
      out.push(`  ${parts.join(' ')}`)
    }
  })

  // Top-level measurements (labels not attached to a known room).
  if (unmatched.length) {
    out.push('')
    out.push(`measure ${unmatched.map(([l, v]) => `${l}=${fmtNum(v)}`).join(' ')}`)
  }

  // Global pins (no room).
  for (const p of pins) {
    if (p.roomId) continue
    const parts = ['pin', `at(${fmtNum(p.at.x)},${fmtNum(p.at.y)})`]
    const id = defaultPinId(pinCounter++)
    if (p.id !== id) parts.push(`id=${p.id}`)
    if (p.wallStart) parts.push(`wallid=${p.wallStart}`)
    if (p.text) parts.push(`text=${q(p.text)}`)
    if (p.photoKeys.length) parts.push(`photos=${p.photoKeys.join(',')}`)
    out.push(parts.join(' '))
  }

  // Tapes.
  for (const t of tapes) {
    const parts = ['tape', `from(${fmtNum(t.a.x)},${fmtNum(t.a.y)})`, `to(${fmtNum(t.b.x)},${fmtNum(t.b.y)})`]
    const id = defaultTapeId(tapeCounter++)
    if (t.id !== id) parts.push(`id=${t.id}`)
    if (t.actualCm != null) parts.push(`=${fmtNum(t.actualCm)}`)
    if (t.label) parts.push(`label=${q(t.label)}`)
    if (t.roomId) {
      const room = rooms.find((r) => r.id === t.roomId)
      if (room) parts.push(`room=${room.code}`)
    }
    if (t.note) parts.push(`note=${q(t.note)}`)
    out.push(parts.join(' '))
  }

  return out.join('\n') + '\n'
}

// ---------- parser ----------

const CODE_RE = /^[A-Za-z0-9_]+$/
const LABEL_RE = /^([A-Za-z0-9_]+)-([0-9]+)$/
/** Survey label: wall "SE-2", diagonal "SE-D", ceiling "SE-H". */
const MEAS_LABEL_RE = /^([A-Za-z0-9_]+)-([0-9]+|[DHdh])$/
const WALL_TYPES: WallType[] = ['bearing', 'partition', 'exterior']
const SURFACE_SOURCES: SurfaceReferenceSource[] = ['dpe', 'carrez', 'boutin', 'deed', 'listing', 'other']

type Tok =
  | { t: 'word'; v: string }
  | { t: 'num'; v: number; raw: string }
  | { t: 'str'; v: string }
  | { t: 'punct'; v: string }

/** Split one line into tokens. '=' , '(' , ')' , ',' are single punct tokens; quoted strings honoured. */
function tokenize(line: number, src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '#') break
    if (c === '"') {
      let j = i + 1
      let raw = '"'
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') { raw += src[j] + (src[j + 1] ?? ''); j += 2; continue }
        raw += src[j]; j++
      }
      if (j >= src.length) throw new DslParseError(line, 'unterminated string')
      raw += '"'
      let v: string
      try {
        v = JSON.parse(raw)
      } catch {
        throw new DslParseError(line, `invalid string escape in ${raw}`)
      }
      toks.push({ t: 'str', v })
      i = j + 1
      continue
    }
    if (c === '=' || c === '(' || c === ')' || c === ',' || c === ':') { toks.push({ t: 'punct', v: c }); i++; continue }
    // bare word: up to whitespace or punct
    let j = i
    while (j < src.length && !' \t\r#="(),:'.includes(src[j])) j++
    const w = src.slice(i, j)
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(w)) {
      const n = Number(w)
      if (!Number.isFinite(n)) throw new DslParseError(line, `invalid number "${w}"`)
      toks.push({ t: 'num', v: n, raw: w })
    } else {
      toks.push({ t: 'word', v: w })
    }
    i = j
  }
  return toks
}

class Cursor {
  toks: Tok[]
  line: number
  pos = 0
  constructor(line: number, toks: Tok[]) {
    this.line = line
    this.toks = toks
  }
  get done() { return this.pos >= this.toks.length }
  peek(): Tok | undefined { return this.toks[this.pos] }
  next(): Tok {
    const t = this.toks[this.pos]
    if (!t) throw new DslParseError(this.line, 'unexpected end of line')
    this.pos++
    return t
  }
  err(msg: string): DslParseError { return new DslParseError(this.line, msg) }
  expectPunct(v: string) {
    const t = this.next()
    if (t.t !== 'punct' || t.v !== v) throw this.err(`expected "${v}" but found ${tokDesc(t)}`)
  }
  word(): string {
    const t = this.next()
    if (t.t !== 'word') throw this.err(`expected a word but found ${tokDesc(t)}`)
    return t.v
  }
  num(): number {
    const t = this.next()
    if (t.t !== 'num') throw this.err(`expected a number but found ${tokDesc(t)}`)
    return t.v
  }
  str(): string {
    const t = this.next()
    if (t.t !== 'str') throw this.err(`expected a quoted string but found ${tokDesc(t)}`)
    return t.v
  }
  /** Optional "key=" value; returns true if consumed. */
  key(k: string): Tok | null {
    const save = this.pos
    const w = this.peek()
    if (w && w.t === 'word' && w.v === k) {
      this.pos++
      const eq = this.next()
      if (eq.t !== 'punct' || eq.v !== '=') { this.pos = save; return null }
      return this.next()
    }
    return null
  }
}

const tokDesc = (t: Tok | undefined) =>
  t === undefined ? 'end of line' : t.t === 'str' ? `string ${JSON.stringify(t.v)}` : t.t === 'num' ? `number ${t.raw}` : `"${t.v}"`

function parseLabel(line: number, v: string): { code: string; n: number } {
  const m = LABEL_RE.exec(v)
  if (!m) throw new DslParseError(line, `invalid wall label "${v}" (expected CODE-n, e.g. SE-2)`)
  return { code: m[1], n: Number(m[2]) }
}

function parsePointList(cur: Cursor, line: number, idOf: (i: number) => string): Vertex[] {
  cur.expectPunct('(')
  const pts: Vertex[] = []
  for (;;) {
    // optional id prefix: word followed by ':'
    let id = idOf(pts.length)
    const save = cur.pos
    const w = cur.peek()
    if (w && w.t === 'word') {
      cur.pos++
      const colon = cur.next()
      if (colon.t === 'punct' && colon.v === ':') {
        id = w.v
      } else {
        cur.pos = save
      }
    }
    const x = cur.num()
    cur.expectPunct(',')
    const y = cur.num()
    pts.push({ id, x, y })
    // Points are whitespace-separated; a comma between points is also accepted.
    const t = cur.peek()
    if (!t) throw new DslParseError(line, 'unterminated poly(...) — expected ")"')
    if (t.t === 'punct' && t.v === ')') break
    if (t.t === 'punct' && t.v === ',') { cur.next(); continue }
    if (t.t === 'num' || t.t === 'word') continue
    throw new DslParseError(line, `unexpected token ${tokDesc(t)} in poly(...)`)
  }
  cur.expectPunct(')')
  if (pts.length < 3) throw new DslParseError(line, 'polygon needs at least 3 points')
  return pts
}

export type DslToPlanOptions = { now?: string }

export function dslToPlan(text: string, baseDoc?: PlanDoc, opts: DslToPlanOptions = {}): PlanDocV1 {
  const now = opts.now ?? new Date().toISOString()
  const lines = text.split('\n')

  // First non-blank, non-comment line must be the header.
  let headerLine = -1
  let title = ''
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    headerLine = i + 1
    const cur = new Cursor(headerLine, tokenize(headerLine, lines[i]))
    const w = cur.word()
    if (w !== 'plan') throw new DslParseError(headerLine, `expected "plan" header but found "${w}"`)
    title = cur.str()
    while (!cur.done) {
      const kw = cur.word()
      cur.expectPunct('=')
      if (kw === 'version') {
        const v = cur.num()
        if (v !== 1) throw new DslParseError(headerLine, `unsupported version ${v} (only 1)`)
      } else if (kw === 'unit') {
        const u = cur.word()
        if (u !== 'cm') throw new DslParseError(headerLine, `unsupported unit "${u}" (only cm)`)
      } else {
        throw new DslParseError(headerLine, `unknown header attribute "${kw}"`)
      }
    }
    break
  }
  if (headerLine < 0) throw new DslParseError(1, 'missing "plan" header')

  const rooms: Room[] = []
  const elements: WallElement[] = []
  const measurements: PlanDoc['measurements'] = {}
  const roomNotes: Record<string, string> = {}
  const tapes: TapeMeasure[] = []
  const pins: Pin[] = []
  let pinCounter = 0
  let tapeCounter = 0
  let apartmentDefaultCeilingCm: number | undefined
  const references: SurfaceReference[] = []

  const seenCodes = new Set<string>()
  let currentRoom: Room | null = null

  const addMeasurement = (line: number, label: string, value: number, roomCode?: string) => {
    if (roomCode) {
      const m = MEAS_LABEL_RE.exec(label)
      if (!m || m[1] !== roomCode) throw new DslParseError(line, `measurement label "${label}" does not belong to room ${roomCode}`)
    }
    const prev = baseDoc?.measurements?.[label]
    measurements[label] = { label, actualCm: value, updatedAt: prev?.updatedAt ?? now }
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    if (lineNo === headerLine) continue
    const raw = lines[i]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indented = raw[0] === ' ' || raw[0] === '\t'
    const cur = new Cursor(lineNo, tokenize(lineNo, trimmed))
    const wTok = cur.peek()
    if (!wTok || wTok.t !== 'word') throw new DslParseError(lineNo, `expected a statement but found ${tokDesc(wTok)}`)
    const kw = wTok.v

    if (kw === 'room') {
      if (indented) throw new DslParseError(lineNo, '"room" must start at the beginning of a line')
      cur.next()
      const code = cur.word()
      if (!CODE_RE.test(code)) throw new DslParseError(lineNo, `invalid room code "${code}"`)
      if (seenCodes.has(code)) throw new DslParseError(lineNo, `duplicate room code "${code}"`)
      seenCodes.add(code)
      const name = cur.str()
      // shape
      let vertices: Vertex[]
      const shapeTok = cur.next()
      if (shapeTok.t !== 'word') throw cur.err(`expected poly(...) or rect(...) but found ${tokDesc(shapeTok)}`)
      if (shapeTok.v === 'poly') {
        vertices = parsePointList(cur, lineNo, (k) => defaultVertexId(code, k))
      } else if (shapeTok.v === 'rect') {
        cur.expectPunct('(')
        const x = cur.num()
        cur.expectPunct(',')
        const y = cur.num()
        // Accept both "400x300" (single token) and "400 x 300".
        let w: number
        let h: number
        const sizeTok = cur.next()
        const m = sizeTok.t === 'word' ? /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(sizeTok.v) : null
        if (m) {
          w = Number(m[1])
          h = Number(m[2])
        } else {
          if (sizeTok.t !== 'num') throw cur.err(`expected "WxH" but found ${tokDesc(sizeTok)}`)
          w = sizeTok.v
          const xTok = cur.next()
          if (xTok.t !== 'word' || xTok.v.toLowerCase() !== 'x') throw cur.err(`expected "x" (width x height) but found ${tokDesc(xTok)}`)
          h = cur.num()
        }
        cur.expectPunct(')')
        if (w <= 0 || h <= 0) throw new DslParseError(lineNo, 'rect width and height must be positive')
        vertices = [
          { id: defaultVertexId(code, 0), x, y },
          { id: defaultVertexId(code, 1), x: x + w, y },
          { id: defaultVertexId(code, 2), x: x + w, y: y + h },
          { id: defaultVertexId(code, 3), x, y: y + h },
        ]
      } else {
        throw new DslParseError(lineNo, `expected poly(...) or rect(...) but found "${shapeTok.v}"`)
      }
      const room: Room = {
        id: defaultRoomId(code),
        code,
        name,
        vertices,
        holes: [],
        walls: {},
        walkOrder: rooms.length + 1,
      }
      // attrs ("outdoor" is a flag without "=")
      while (!cur.done) {
        const aTok = cur.next()
        if (aTok.t !== 'word') throw cur.err(`expected a room attribute but found ${tokDesc(aTok)}`)
        if (aTok.v === 'outdoor') {
          room.outdoor = true
          continue
        }
        cur.expectPunct('=')
        if (aTok.v === 'id') {
          const idTok = cur.next()
          if (idTok.t !== 'word') throw cur.err(`expected a room id but found ${tokDesc(idTok)}`)
          room.id = idTok.v
        } else if (aTok.v === 'ceiling') room.ceilingCm = cur.num()
        else if (aTok.v === 'walk') room.walkOrder = cur.num()
        else if (aTok.v === 'diag') {
          const a = cur.num()
          cur.expectPunct(',')
          const b = cur.num()
          room.diagonal = [Math.trunc(a), Math.trunc(b)]
        } else {
          throw new DslParseError(lineNo, `unknown room attribute "${aTok.v}"`)
        }
      }
      rooms.push(room)
      currentRoom = room
      continue
    }

    if (indented && !currentRoom) {
      throw new DslParseError(lineNo, 'indented line outside of a room block')
    }

    if (kw === 'wall') {
      if (!indented || !currentRoom) throw new DslParseError(lineNo, '"wall" must be indented inside a room block')
      cur.next()
      const label = parseLabel(lineNo, cur.word())
      if (label.code !== currentRoom.code) throw new DslParseError(lineNo, `wall label "${label.code}-${label.n}" does not belong to room ${currentRoom.code}`)
      if (label.n < 1 || label.n > currentRoom.vertices.length) {
        throw new DslParseError(lineNo, `wall ${label.code}-${label.n} out of range (room has ${currentRoom.vertices.length} walls)`)
      }
      let props: WallProps | null = null
      while (!cur.done) {
        const t = cur.next()
        if (t.t === 'word' && WALL_TYPES.includes(t.v as WallType)) {
          props = props ?? { type: 'partition', thicknessCm: 10 }
          props.type = t.v as WallType
          props.thicknessCm = DEFAULT_T[t.v as WallType]
        } else if (t.t === 'word' && /^\d+(\.\d+)?cm$/.test(t.v)) {
          props = props ?? { type: 'partition', thicknessCm: 10 }
          props.thicknessCm = Number(t.v.slice(0, -2))
        } else if (t.t === 'word' && t.v === 'locked') {
          props = props ?? { type: 'partition', thicknessCm: 10 }
          props.locked = true
        } else {
          throw new DslParseError(lineNo, `unexpected token ${tokDesc(t)} in wall line`)
        }
      }
      if (props) currentRoom.walls[currentRoom.vertices[label.n - 1].id] = props
      continue
    }

    if (kw === 'hole') {
      if (!indented || !currentRoom) throw new DslParseError(lineNo, '"hole" must be indented inside a room block')
      cur.next()
      const hTok = cur.word()
      if (hTok !== 'poly') throw new DslParseError(lineNo, `expected poly(...) after "hole" but found "${hTok}"`)
      const room = currentRoom
      const hi = room.holes.length
      room.holes.push(parsePointList(cur, lineNo, (k) => defaultHoleVertexId(room.code, hi, k)))
      continue
    }

    if (ELEMENT_KINDS.includes(kw as ElementKind)) {
      if (!indented || !currentRoom) throw new DslParseError(lineNo, `"${kw}" must be indented inside a room block`)
      cur.next()
      const kind = kw as ElementKind
      const label = parseLabel(lineNo, cur.word())
      if (label.code !== currentRoom.code) throw new DslParseError(lineNo, `element wall "${label.code}-${label.n}" does not belong to room ${currentRoom.code}`)
      if (label.n < 1 || label.n > currentRoom.vertices.length) {
        throw new DslParseError(lineNo, `element wall ${label.code}-${label.n} out of range`)
      }
      const room = currentRoom
      const wallStart = room.vertices[label.n - 1].id
      const el: WallElement = {
        id: '',
        roomId: room.id,
        wallStart,
        kind,
        offsetCm: 0,
        widthCm: 0,
        createdAt: now,
        updatedAt: now,
      }
      const k = elements.filter((e) => e.roomId === room.id && e.wallStart === wallStart).length
      el.id = defaultElementId(room.code, label.n, k)
      while (!cur.done) {
        const t = cur.peek()
        const keyTok = t
        if (keyTok && keyTok.t === 'word' && ['id', 'at', 'w', 'h', 'sill', 'depth', 'hinge', 'swing', 'note'].includes(keyTok.v)) {
          cur.next()
          cur.expectPunct('=')
          const v = cur.next()
          switch (keyTok.v) {
            case 'id':
              if (v.t !== 'word') throw cur.err(`expected element id but found ${tokDesc(v)}`)
              el.id = v.v
              break
            case 'at': case 'w': case 'h': case 'sill': case 'depth': {
              if (v.t !== 'num') throw cur.err(`expected a number for ${keyTok.v}= but found ${tokDesc(v)}`)
              if (keyTok.v === 'at') el.offsetCm = v.v
              else if (keyTok.v === 'w') el.widthCm = v.v
              else if (keyTok.v === 'h') el.heightCm = v.v
              else if (keyTok.v === 'sill') el.sillCm = v.v
              else el.depthCm = v.v
              break
            }
            case 'hinge':
              if (v.t !== 'word' || (v.v !== 'start' && v.v !== 'end')) throw cur.err('hinge must be start|end')
              el.hinge = v.v
              break
            case 'swing':
              if (v.t !== 'word' || (v.v !== 'in' && v.v !== 'out')) throw cur.err('swing must be in|out')
              el.swing = v.v
              break
            case 'note':
              if (v.t !== 'str') throw cur.err(`expected a quoted string for note= but found ${tokDesc(v)}`)
              el.note = v.v
              break
          }
        } else if (t && t.t === 'word' && VARIANTS.has(t.v)) {
          cur.next()
          el.variant = t.v as ElementVariant
        } else {
          throw new DslParseError(lineNo, `unexpected token ${tokDesc(t)} in ${kind} line`)
        }
      }
      if (!(el.widthCm > 0)) throw new DslParseError(lineNo, `${kind} on ${label.code}-${label.n} needs w=<positive width>`)
      const prev = baseDoc?.elements?.find((e) => e.id === el.id)
      if (prev) {
        el.createdAt = prev.createdAt
        el.updatedAt = prev.updatedAt
      }
      elements.push(el)
      continue
    }

    if (kw === 'measure') {
      cur.next()
      const roomCode = indented ? currentRoom?.code : undefined
      if (indented && !currentRoom) throw new DslParseError(lineNo, '"measure" must be inside a room block or at top level')
      let any = false
      while (!cur.done) {
        const labelTok = cur.next()
        if (labelTok.t !== 'word') throw cur.err(`expected a survey label but found ${tokDesc(labelTok)}`)
        const label = labelTok.v
        if (!MEAS_LABEL_RE.test(label)) throw new DslParseError(lineNo, `invalid measurement label "${label}" (expected CODE-n, CODE-D or CODE-H)`)
        cur.expectPunct('=')
        const v = cur.num()
        if (!(v > 0)) throw new DslParseError(lineNo, `measurement ${label} must be positive`)
        addMeasurement(lineNo, label, v, roomCode)
        any = true
      }
      if (!any) throw new DslParseError(lineNo, '"measure" needs at least one LABEL=value pair')
      continue
    }

    if (kw === 'note') {
      if (!indented || !currentRoom) throw new DslParseError(lineNo, '"note" must be indented inside a room block')
      cur.next()
      roomNotes[currentRoom.code] = cur.str()
      if (!cur.done) throw cur.err('unexpected trailing tokens after note string')
      continue
    }

    if (kw === 'pin') {
      cur.next()
      const pin: Pin = {
        id: defaultPinId(pinCounter++),
        at: { x: 0, y: 0 },
        photoKeys: [],
        createdAt: now,
        updatedAt: now,
      }
      let hasAt = false
      while (!cur.done) {
        const t = cur.peek()
        if (t && t.t === 'word' && ['id', 'wall', 'wallid', 'room', 'text', 'photos'].includes(t.v)) {
          cur.next()
          cur.expectPunct('=')
          const v = cur.next()
          switch (t.v) {
            case 'id':
              if (v.t !== 'word') throw cur.err(`expected pin id but found ${tokDesc(v)}`)
              pin.id = v.v
              break
            case 'wall': {
              if (v.t !== 'word') throw cur.err('wall= expects a label like SE-2')
              const label = parseLabel(lineNo, v.v)
              const room = indented ? currentRoom : rooms.find((r) => r.code === label.code)
              if (!room) throw new DslParseError(lineNo, `pin wall "${v.v}" references unknown room ${label.code}`)
              if (label.n < 1 || label.n > room.vertices.length) throw new DslParseError(lineNo, `pin wall ${v.v} out of range`)
              pin.wallStart = room.vertices[label.n - 1].id
              if (!indented) pin.roomId = room.id
              break
            }
            case 'wallid':
              if (v.t !== 'word') throw cur.err('wallid= expects a raw vertex id')
              pin.wallStart = v.v
              break
            case 'room': {
              if (v.t !== 'word') throw cur.err('room= expects a room code')
              const room = rooms.find((r) => r.code === v.v)
              if (!room) throw new DslParseError(lineNo, `pin references unknown room "${v.v}"`)
              pin.roomId = room.id
              break
            }
            case 'text':
              if (v.t !== 'str') throw cur.err(`expected a quoted string for text= but found ${tokDesc(v)}`)
              pin.text = v.v
              break
            case 'photos': {
              const keys: string[] = []
              for (;;) {
                const k = cur.next()
                if (k.t !== 'word' && k.t !== 'str') throw cur.err(`expected a photo key but found ${tokDesc(k)}`)
                keys.push(k.t === 'str' ? k.v : k.v)
                const nx = cur.peek()
                if (nx && nx.t === 'punct' && nx.v === ',') { cur.next(); continue }
                break
              }
              pin.photoKeys = keys
              break
            }
          }
        } else if (t && t.t === 'word' && t.v === 'at') {
          cur.next()
          cur.expectPunct('(')
          const x = cur.num()
          cur.expectPunct(',')
          const y = cur.num()
          cur.expectPunct(')')
          pin.at = { x, y }
          hasAt = true
        } else {
          throw new DslParseError(lineNo, `unexpected token ${tokDesc(t)} in pin line`)
        }
      }
      if (!hasAt) throw new DslParseError(lineNo, 'pin needs at(x,y)')
      if (indented && currentRoom) {
        pin.roomId = currentRoom.id
      }
      const prev = baseDoc?.pins?.find((p) => p.id === pin.id)
      if (prev) {
        pin.createdAt = prev.createdAt
        pin.updatedAt = prev.updatedAt
      }
      pins.push(pin)
      continue
    }

    if (kw === 'tape') {
      if (indented) throw new DslParseError(lineNo, '"tape" must start at the beginning of a line')
      cur.next()
      const tape: TapeMeasure = { id: defaultTapeId(tapeCounter++), a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }
      let hasFrom = false
      let hasTo = false
      while (!cur.done) {
        const t = cur.peek()
        if (t && t.t === 'punct' && t.v === '=') {
          cur.next()
          tape.actualCm = cur.num()
        } else if (t && t.t === 'word' && t.v === 'from') {
          cur.next()
          cur.expectPunct('(')
          const x = cur.num()
          cur.expectPunct(',')
          const y = cur.num()
          cur.expectPunct(')')
          tape.a = { x, y }
          hasFrom = true
        } else if (t && t.t === 'word' && t.v === 'to') {
          cur.next()
          cur.expectPunct('(')
          const x = cur.num()
          cur.expectPunct(',')
          const y = cur.num()
          cur.expectPunct(')')
          tape.b = { x, y }
          hasTo = true
        } else if (t && t.t === 'word' && ['id', 'label', 'note', 'room'].includes(t.v)) {
          cur.next()
          cur.expectPunct('=')
          const v = cur.next()
          switch (t.v) {
            case 'id':
              if (v.t !== 'word') throw cur.err(`expected tape id but found ${tokDesc(v)}`)
              tape.id = v.v
              break
            case 'label':
              if (v.t !== 'str') throw cur.err(`expected a quoted string for label= but found ${tokDesc(v)}`)
              tape.label = v.v
              break
            case 'note':
              if (v.t !== 'str') throw cur.err(`expected a quoted string for note= but found ${tokDesc(v)}`)
              tape.note = v.v
              break
            case 'room': {
              if (v.t !== 'word') throw cur.err('room= expects a room code')
              const room = rooms.find((r) => r.code === v.v)
              if (!room) throw new DslParseError(lineNo, `tape references unknown room "${v.v}"`)
              tape.roomId = room.id
              break
            }
          }
        } else {
          throw new DslParseError(lineNo, `unexpected token ${tokDesc(t)} in tape line`)
        }
      }
      if (!hasFrom || !hasTo) throw new DslParseError(lineNo, 'tape needs from(x,y) and to(x,y)')
      tapes.push(tape)
      continue
    }

    if (kw === 'apartment') {
      if (indented) throw new DslParseError(lineNo, '"apartment" must start at the beginning of a line')
      cur.next()
      if (cur.done) throw new DslParseError(lineNo, '"apartment" needs at least one attribute (e.g. "apartment ceiling 250")')
      while (!cur.done) {
        const aTok = cur.next()
        if (aTok.t !== 'word') throw cur.err(`expected an apartment attribute but found ${tokDesc(aTok)}`)
        if (aTok.v !== 'ceiling') throw new DslParseError(lineNo, `unknown apartment attribute "${aTok.v}"`)
        // Accept both "ceiling 250" and "ceiling=250".
        const eq = cur.peek()
        if (eq && eq.t === 'punct' && eq.v === '=') cur.next()
        const cm = cur.num()
        if (!(cm > 0)) throw new DslParseError(lineNo, 'apartment ceiling must be positive')
        apartmentDefaultCeilingCm = cm
      }
      continue
    }

    if (kw === 'ref') {
      if (indented) throw new DslParseError(lineNo, '"ref" must start at the beginning of a line')
      cur.next()
      const srcTok = cur.next()
      if (srcTok.t !== 'word' || !SURFACE_SOURCES.includes(srcTok.v as SurfaceReferenceSource)) {
        throw new DslParseError(
          lineNo,
          `invalid reference source ${tokDesc(srcTok)} (expected ${SURFACE_SOURCES.join(', ')})`,
        )
      }
      const surfaceM2 = cur.num()
      if (!(surfaceM2 > 0)) throw new DslParseError(lineNo, 'reference surface must be positive')
      const ref: SurfaceReference = {
        id: defaultReferenceId(references.length),
        source: srcTok.v as SurfaceReferenceSource,
        surfaceM2,
      }
      // Optional positional label right after the surface.
      const maybeLabel = cur.peek()
      if (maybeLabel && maybeLabel.t === 'str') {
        cur.next()
        ref.label = maybeLabel.v
      }
      while (!cur.done) {
        const t = cur.next()
        if (t.t !== 'word') throw cur.err(`expected a reference attribute but found ${tokDesc(t)}`)
        cur.expectPunct('=')
        const v = cur.next()
        if (t.v === 'id') {
          if (v.t !== 'word') throw cur.err(`expected a reference id but found ${tokDesc(v)}`)
          ref.id = v.v
        } else if (t.v === 'room') {
          if (v.t !== 'word') throw cur.err('room= expects a room code')
          ref.roomCode = v.v
        } else if (t.v === 'date') {
          if (v.t !== 'str' && v.t !== 'word') throw cur.err(`expected a date for date= but found ${tokDesc(v)}`)
          ref.date = v.v
        } else if (t.v === 'note') {
          if (v.t !== 'str') throw cur.err(`expected a quoted string for note= but found ${tokDesc(v)}`)
          ref.note = v.v
        } else {
          throw new DslParseError(lineNo, `unknown reference attribute "${t.v}"`)
        }
      }
      references.push(ref)
      continue
    }

    throw new DslParseError(lineNo, `unknown statement "${kw}"`)
  }

  const doc = parsePlan({
    schemaVersion: 1,
    projectId: baseDoc?.projectId ?? 'local',
    title,
    background: baseDoc?.background,
    rooms,
    elements,
    measurements,
    roomNotes,
    tapes,
    pins,
    ...(apartmentDefaultCeilingCm !== undefined || references.length > 0
      ? {
          apartment: {
            ...(apartmentDefaultCeilingCm !== undefined ? { defaultCeilingCm: apartmentDefaultCeilingCm } : {}),
            references,
          },
        }
      : {}),
  })
  return doc
}
