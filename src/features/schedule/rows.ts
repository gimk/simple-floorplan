// Room schedule (docs/measurements-plan.md section 6): one row per room, a table of totals, the
// CSV text (French Excel: ';' between the cells, comma decimals) and a plain SVG table for the
// export (a `<g>` string that the export agent can put on the plan).
// Pure functions only: no React, no store. World units are cm, areas m², volumes m³.
import { roomAreaM2 } from '../../model/geometry'
import { roomsInWalkOrder } from '../../model/survey'
import type { PlanDoc, Room } from '../../model/types'
import { areaText, decimalText, metresText, roomPerimeterCm, wallProgress } from '../rooms/roomTag'

/** One line of the schedule: the values of one room. */
export type ScheduleRow = {
  roomId: string
  /** Survey code, e.g. "CU". */
  code: string
  /**
   * Name of the line. For a built-in storage it is "Storage (Bedroom 1)", or "<name> (Bedroom 1)"
   * when the storage has its own name (docs/storage-plan.md).
   */
  name: string
  /** True for a balcony or a terrace: the room is a row but stays out of the totals. */
  outdoor: boolean
  /**
   * True for a built-in storage room: it has its own line, just under the room it opens into, and
   * it is shown indented. Its area is in the totals but it does not count as a room.
   */
  storage: boolean
  /** Parent room of a storage line, when the parent is in the document. */
  parentRoomId?: string
  /** Floor area, m² (holes subtracted). */
  areaM2: number
  /** Perimeter on the inside faces, cm. */
  perimeterCm: number
  /** Ceiling height, cm: the room's own value, else the apartment default. Undefined when unknown. */
  ceilingCm?: number
  /** area x ceiling, m³. Undefined when the ceiling height is not known. */
  volumeM3?: number
  /** Walls of the room that have an on-site value. */
  measuredWalls: number
  /** Walls of the room. */
  walls: number
}

/** The totals of the rows, without the outdoor rooms. */
export type ScheduleTotals = {
  /** Rooms counted in the totals (the indoor rooms). */
  rooms: number
  /** Floor area of those rooms, m². */
  areaM2: number
  /** Volume of those rooms that have a ceiling height, m³. */
  volumeM3: number
  /** Indoor rooms with no ceiling height: they are not in `volumeM3`. */
  missingCeiling: number
  /** Measured walls of the indoor rooms. */
  measuredWalls: number
  /** Walls of the indoor rooms. */
  walls: number
}

export type Schedule = { rows: ScheduleRow[]; totals: ScheduleTotals }

/**
 * The document fields that the schedule reads. A full PlanDoc works; the whole plan is used so
 * that the walk order and the apartment default come from the same places as elsewhere.
 */
export type ScheduleDoc = Pick<PlanDoc, 'rooms' | 'measurements' | 'apartment'>

/** A height that can be used: a finite number above 0. A height of 0 counts as "no height". */
const positive = (v: number | undefined): number | undefined =>
  v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined

/** Ceiling height of a room, cm: its own value, else the apartment default. */
export const roomCeilingCm = (room: Room, defaultCeilingCm?: number): number | undefined =>
  positive(room.ceilingCm) ?? positive(defaultCeilingCm)

/** Volume of a room, m³: floor area x ceiling height. Undefined without a ceiling height. */
export const volumeM3 = (areaM2: number, ceilingCm: number | undefined): number | undefined => {
  const h = positive(ceilingCm)
  return h === undefined ? undefined : (areaM2 * h) / 100
}

/** Default name of a built-in storage room (features/storage/actions.ts). */
export const STORAGE_NAME = 'Storage'

/**
 * Name of a schedule line. A normal room keeps its own name. A built-in storage reads
 * "Storage (Bedroom 1)", or "<name> (Bedroom 1)" when the user gave it another name. Without a
 * parent room (deleted parent) the name stands alone.
 */
export function scheduleRowName(room: Room, parent?: Room): string {
  if (!room.storage) return room.name
  const own = room.name.trim() === '' ? STORAGE_NAME : room.name.trim()
  const parentName = parent?.name.trim() ?? ''
  return parentName === '' ? own : `${own} (${parentName})`
}

/** One row per room, in the order of the measuring walk-through, plus the totals. */
export function scheduleRows(doc: ScheduleDoc): Schedule {
  // The same order as the survey list: roomsInWalkOrder() of model/survey.ts.
  const rooms = roomsInWalkOrder(doc as PlanDoc)
  const roomIds = new Set(rooms.map((r) => r.id))
  const byId = new Map(rooms.map((r) => [r.id, r]))
  // Built-in storages, grouped by parent room: each one gets its own line under its parent.
  const storagesOf = new Map<string, Room[]>()
  for (const r of rooms) {
    const parentId = r.storage?.parentRoomId
    if (!parentId || parentId === r.id) continue
    const list = storagesOf.get(parentId) ?? []
    list.push(r)
    storagesOf.set(parentId, list)
  }
  const lines: { room: Room; parent?: Room }[] = []
  const placed = new Set<string>()
  for (const room of rooms) {
    if (room.storage) {
      // A storage with a parent in the document comes with that parent (just below).
      const parent = room.storage.parentRoomId ? byId.get(room.storage.parentRoomId) : undefined
      if (parent && roomIds.has(parent.id) && parent.id !== room.id) continue
      lines.push({ room }) // orphan: its own line, without a parent name
      placed.add(room.id)
      continue
    }
    lines.push({ room })
    placed.add(room.id)
    for (const storage of storagesOf.get(room.id) ?? []) {
      if (placed.has(storage.id)) continue
      lines.push({ room: storage, parent: room })
      placed.add(storage.id)
    }
  }
  const rows = lines.map(({ room, parent }): ScheduleRow => {
    const areaM2 = roomAreaM2(room)
    const ceilingCm = roomCeilingCm(room, doc.apartment?.defaultCeilingCm)
    const progress = wallProgress([room], doc.measurements)
    return {
      roomId: room.id,
      code: room.code,
      name: scheduleRowName(room, parent),
      outdoor: !!room.outdoor,
      storage: !!room.storage,
      ...(parent ? { parentRoomId: parent.id } : {}),
      areaM2,
      perimeterCm: roomPerimeterCm(room),
      ceilingCm,
      volumeM3: volumeM3(areaM2, ceilingCm),
      measuredWalls: progress.measured,
      walls: progress.walls,
    }
  })
  return { rows, totals: totalsOf(rows) }
}

/** Totals of the indoor rows. An outdoor room changes nothing here. */
export function totalsOf(rows: readonly ScheduleRow[]): ScheduleTotals {
  const t: ScheduleTotals = { rooms: 0, areaM2: 0, volumeM3: 0, missingCeiling: 0, measuredWalls: 0, walls: 0 }
  for (const r of rows) {
    if (r.outdoor) continue
    // A built-in storage counts in the areas, its walls and the volume, but not as a room.
    if (!r.storage) t.rooms += 1
    t.areaM2 += r.areaM2
    if (r.volumeM3 === undefined) t.missingCeiling += 1
    else t.volumeM3 += r.volumeM3
    t.measuredWalls += r.measuredWalls
    t.walls += r.walls
  }
  return t
}

/** Decimals of the area in the texts (0, 1 or 2). The other values always keep two. */
const decimalsOf = (n: number | undefined) => Math.max(0, Math.min(2, n ?? 2))

/** Area for a text cell: "12,34". */
export const scheduleAreaText = (areaM2: number, areaDecimals?: number) =>
  areaText(areaM2, decimalsOf(areaDecimals))

/** Volume for a text cell: "30,85", or an empty cell when the ceiling height is not known. */
export const scheduleVolumeText = (v: number | undefined) => (v === undefined ? '' : decimalText(v, 2))

/** Progress for a text cell: "4/6", or "0/4" for a room with no measured wall. */
export const scheduleProgressText = (r: Pick<ScheduleRow, 'measuredWalls' | 'walls'>) =>
  `${r.measuredWalls}/${r.walls}`

// ---------------------------------------------------------------------------------------------
// CSV (French Excel: ';' between the cells, comma decimals)
// ---------------------------------------------------------------------------------------------

/** The header of the CSV, in the order of the cells below. */
export const CSV_HEADER = [
  'Code', 'Name', 'Area (m2)', 'Perimeter (m)', 'Ceiling (m)', 'Volume (m3)', 'Measured walls', 'Walls', 'Outdoor',
] as const

/** One CSV cell. Quotes when the text holds the separator, a quote or a line break (';' Excel). */
export const csvCell = (v: string): string => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** The cells of one row, in the same order as CSV_HEADER. An unknown value is an empty cell. */
export function csvRowCells(r: ScheduleRow, areaDecimals?: number): string[] {
  return [
    r.code,
    r.name,
    scheduleAreaText(r.areaM2, areaDecimals),
    metresText(r.perimeterCm),
    r.ceilingCm === undefined ? '' : metresText(r.ceilingCm),
    scheduleVolumeText(r.volumeM3),
    String(r.measuredWalls),
    String(r.walls),
    r.outdoor ? 'yes' : '',
  ]
}

export type CsvOptions = {
  /** Decimals of the area (0, 1 or 2); default 2. */
  areaDecimals?: number
  /** Adds a "Total" line at the end (indoor rooms only). */
  totals?: ScheduleTotals
}

/**
 * CSV text: a header line, one line per room in walk order, and the total line when `totals` is
 * given. Cells are separated by ';' and decimals use a comma, so Excel in French opens the file
 * in columns. Line break: CRLF.
 */
export function scheduleCsv(rows: readonly ScheduleRow[], opts: CsvOptions = {}): string {
  const lines = [CSV_HEADER.map(csvCell).join(';')]
  for (const r of rows) lines.push(csvRowCells(r, opts.areaDecimals).map(csvCell).join(';'))
  if (opts.totals) {
    const t = opts.totals
    lines.push([
      '', 'Total', scheduleAreaText(t.areaM2, opts.areaDecimals), '', '', decimalText(t.volumeM3, 2),
      String(t.measuredWalls), String(t.walls), '',
    ].map(csvCell).join(';'))
  }
  return lines.join('\r\n')
}

// ---------------------------------------------------------------------------------------------
// SVG table (for the export: a `<g>` that the caller puts on the plan)
// ---------------------------------------------------------------------------------------------

export type SvgTableOptions = {
  /** Left edge of the table, cm (world units of the export). */
  x: number
  /** Top edge of the table (the top of the header line), cm. */
  y: number
  /** Font size, cm. Every offset of the table is a multiple of it. */
  fontSize: number
  /** Decimals of the area (0, 1 or 2); default 2. */
  areaDecimals?: number
  /** Adds a "Total" line at the foot of the table. */
  totals?: ScheduleTotals
}

type SvgColumn = { label: string; width: number; align: 'left' | 'right' }

/** Columns of the SVG table. Widths are multiples of the font size. */
export const SVG_COLUMNS: readonly SvgColumn[] = [
  { label: 'Code', width: 4, align: 'left' },
  { label: 'Name', width: 14, align: 'left' },
  { label: 'Area m²', width: 7, align: 'right' },
  { label: 'Perimeter m', width: 8, align: 'right' },
  { label: 'Ceiling m', width: 7, align: 'right' },
  { label: 'Volume m³', width: 8, align: 'right' },
  { label: 'Measured', width: 7, align: 'right' },
]

/** Text for the SVG: the five characters that must not come out raw. */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A number in an SVG attribute: two decimals at most, so the string stays short. */
const num = (v: number) => String(Math.round(v * 100) / 100)

const INK = '#0f172a'
const MUTED_INK = '#475569'
const RULE = '#94a3b8'

/**
 * A plain table as an SVG `<g>` string: a header line, one line per room, a rule under the header
 * and a rule at the foot, and the total line when `totals` is given. Row height is 1.6 x the font
 * size, so the caller can compute the height with `scheduleTableHeight()`.
 */
export function scheduleSvgTable(rows: readonly ScheduleRow[], o: SvgTableOptions): string {
  const fs = o.fontSize
  const rowH = fs * 1.6
  const pad = fs * 0.5
  const width = SVG_COLUMNS.reduce((s, c) => s + c.width, 0) * fs
  // Left edge of every column.
  const lefts: number[] = []
  let acc = 0
  for (const c of SVG_COLUMNS) {
    lefts.push(o.x + acc * fs)
    acc += c.width
  }
  const out: string[] = []
  out.push(`<g class="room-schedule" font-family="Helvetica, Arial, sans-serif" font-size="${num(fs)}" fill="${INK}">`)
  // One line of cells: text of each column, aligned as the column says.
  const line = (cells: readonly string[], top: number, bold: boolean) => {
    const baseline = top + rowH * 0.7
    cells.forEach((cell, i) => {
      if (cell === '') return
      const col = SVG_COLUMNS[i]
      const anchor = col.align === 'right' ? 'end' : 'start'
      const x = col.align === 'right' ? lefts[i] + col.width * fs - pad : lefts[i] + pad
      out.push(
        `<text x="${num(x)}" y="${num(baseline)}" text-anchor="${anchor}"` +
          `${bold ? ' font-weight="600"' : ''}>${esc(cell)}</text>`,
      )
    })
  }
  line(SVG_COLUMNS.map((c) => c.label), o.y, true)
  out.push(`<line x1="${num(o.x)}" y1="${num(o.y + rowH)}" x2="${num(o.x + width)}" y2="${num(o.y + rowH)}" stroke="${RULE}" stroke-width="${num(Math.max(fs * 0.06, 0.01))}"/>`)
  let top = o.y + rowH
  for (const r of rows) {
    line(
      [
        r.code, r.name, scheduleAreaText(r.areaM2, o.areaDecimals), metresText(r.perimeterCm),
        r.ceilingCm === undefined ? '' : metresText(r.ceilingCm), scheduleVolumeText(r.volumeM3),
        scheduleProgressText(r),
      ],
      top,
      false,
    )
    top += rowH
  }
  if (o.totals) {
    const t = o.totals
    line(
      [
        '', `Total (${t.rooms} rooms)`, scheduleAreaText(t.areaM2, o.areaDecimals), '', '',
        decimalText(t.volumeM3, 2), scheduleProgressText(t),
      ],
      top,
      true,
    )
    top += rowH
  }
  out.push(`<line x1="${num(o.x)}" y1="${num(top)}" x2="${num(o.x + width)}" y2="${num(top)}" stroke="${RULE}" stroke-width="${num(Math.max(fs * 0.06, 0.01))}"/>`)
  out.push('</g>')
  return out.join('')
}

/** Width of the SVG table, cm, for a given font size. */
export const scheduleTableWidth = (fontSize: number) =>
  SVG_COLUMNS.reduce((s, c) => s + c.width, 0) * fontSize

/** Height of the SVG table, cm: header, rows, and the total line when `withTotals`. */
export const scheduleTableHeight = (rowCount: number, fontSize: number, withTotals = false) =>
  (rowCount + 1 + (withTotals ? 1 : 0)) * fontSize * 1.6

/** Muted ink used by the caller when it writes the title of the table. */
export const SCHEDULE_MUTED_INK = MUTED_INK
