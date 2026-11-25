// Builds a CLEAN standalone SVG of the plan (no editor chrome). Units in the viewBox are cm.
// The measurements (wall dimension lines, room tags, outside chains) are written like the plan:
// the SVG text of each one comes from `svgDims.ts` (pure), with the fixed "paper zoom" of the
// export (see the comment at the top of that file).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { roomWalls, wallByStart } from '../../model/geometry'
import { planPrecision } from '../../model/precision'
import type { CanvasUnits, DimStyle, RoomTagFields } from '../../model/store'
import { DEFAULT_UNITS } from '../../model/units'
import type { PlanDoc, Room, Vec, WallType } from '../../model/types'
import { elementFrame, wallThickness } from '../elements/geometry'
import { COLORS, ElementSymbol } from '../elements/Symbol'
import { scheduleRows, scheduleSvgTable, scheduleTableHeight } from '../schedule/rows'
import {
  esc,
  exportOutsideRuns,
  num,
  outsideExtentPoints,
  outsideExportHidden,
  outsideRunSvg,
  paperZoom,
  planDimsLayout,
  roomWallDimsSvg,
  type PlanDimsLayout,
} from './svgDims'

/** The measurement settings of the export, taken from `useUi.getState()` when the user exports. */
export type SvgMeasureOptions = {
  /** Wall lengths: dimension lines with ticks ('lines', default) or the old text only ('text'). */
  dimStyle?: DimStyle
  /** Rows of the room tag. Default: the defaults of the app (code, name, area). */
  roomTag?: RoomTagFields
  /** Units of the lengths. Default: centimetres, 1 decimal (what `fmtCm` gives). */
  units?: CanvasUnits
  /** Outside (facade) chains and overall lengths. v2 documents only. Default: off. */
  outside?: boolean
  /** Write the survey label of a value ("SE-2") in front of it. Default: on, as the old export. */
  surveyLabels?: boolean
  /** Room schedule table under the legend (docs/measurements-plan.md section 6). Default: off. */
  schedule?: boolean
}

export type SvgOptions = {
  /** Include the background image. `backgroundHref` should be a data: URL so the file is standalone. */
  background?: boolean
  backgroundHref?: string
  /** Date label; default today (ISO yyyy-mm-dd). */
  date?: string
} & SvgMeasureOptions

/** The room tag of the app before the user changes anything (see `useUi` in model/store.ts). */
export const DEFAULT_TAG_FIELDS: RoomTagFields = {
  code: true, name: true, area: true, perimeter: false, ceiling: false, progress: false, areaDecimals: 2,
}

export type SvgResult = {
  svg: string
  /** viewBox size in cm */
  width: number
  height: number
  /** Font size used (cm) */
  fontSize: number
  /**
   * The wall values and the room tags that were drawn, after the declutter pass (visual review
   * V-1..V-7): a test reads the boxes of the values from here, without a browser.
   */
  layout?: PlanDimsLayout
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const pathOf = (rings: Vec[][]) => rings.map((r) => 'M' + r.map((p) => `${num(p.x)} ${num(p.y)}`).join('L') + 'Z').join('')

const WALL_STROKE: Record<WallType, string> = { bearing: '#0f172a', exterior: '#0f172a', partition: '#94a3b8' }
const DEFAULT_T: Record<WallType, number> = { partition: 10, bearing: 25, exterior: 30 }
const VERIFIED = '#15803d'

const wallInfo = (r: Room, startId: string) => {
  const p = r.walls[startId]
  const type: WallType = p?.type ?? 'partition'
  return { type, t: p && p.thicknessCm > 0 ? p.thicknessCm : DEFAULT_T[type] }
}

export function planBounds(doc: PlanDoc, opts: SvgOptions = {}) {
  const pts: Vec[] = doc.rooms.flatMap((r) => r.vertices)
  const bg = doc.background
  if (opts.background && bg && bg.visible) {
    const w = bg.naturalWidth * bg.cmPerPx, h = bg.naturalHeight * bg.cmPerPx
    pts.push({ x: bg.xCm, y: bg.yCm }, { x: bg.xCm + w, y: bg.yCm + h })
  }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 }
  return {
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
  }
}

export function buildPlanSvg(doc: PlanDoc, opts: SvgOptions = {}): SvgResult {
  // ----- measurement settings (they come from the UI at export time; the function stays pure) -----
  const dimStyle: DimStyle = opts.dimStyle ?? 'lines'
  const tagFields = opts.roomTag ?? DEFAULT_TAG_FIELDS
  const units = opts.units ?? DEFAULT_UNITS
  const surveyLabels = opts.surveyLabels ?? true
  const step = planPrecision(doc)
  // Outside chains: a v2 document has stored walls, and the option can be off.
  const runs = exportOutsideRuns(doc, opts.outside === true)

  // ----- bounds -----
  // The outside rows and their texts go OUTSIDE the wall band, so the box grows by what they reach
  // (they would be cut off by the viewBox otherwise). One pass is enough: the rows only depend on
  // the font size, which moves a little when the box grows.
  const fit = (bb: { minX: number; minY: number; maxX: number; maxY: number }) =>
    clamp(Math.max(Math.max(bb.maxX - bb.minX, 100), Math.max(bb.maxY - bb.minY, 100)) / 60, 8, 30)
  const base = planBounds(doc, opts)
  const b = outsideExtentPoints(runs, paperZoom(fit(base))).reduce(
    (acc, q) => ({
      minX: Math.min(acc.minX, q.x), minY: Math.min(acc.minY, q.y),
      maxX: Math.max(acc.maxX, q.x), maxY: Math.max(acc.maxY, q.y),
    }),
    base,
  )
  const cw = Math.max(b.maxX - b.minX, 100)
  const fs = fit(b)
  const m = fs * 4
  const W = Math.max(cw + 2 * m, fs * 48)
  const cx = (b.minX + b.maxX) / 2
  const x0 = cx - W / 2
  const topH = fs * 5
  const y0 = b.minY - m / 2 - topH
  // The "paper zoom" of the measurements: screen px per cm of the paper. It makes the dimension
  // text of the plan (px(11)) exactly the size the export writes a wall length (fs * 0.75); see the
  // comment at the top of svgDims.ts.
  const zoom = paperZoom(fs)

  // ----- footer: scale bar + wrapped legend -----
  const planBottom = b.maxY + m / 2
  const parts: string[] = []
  const footTop = planBottom + fs
  const bar: string[] = []
  const sbx = x0 + fs * 2, sby = footTop + fs * 1.6
  bar.push(`<g id="scale-bar" font-size="${num(fs * 0.9)}" fill="#0f172a">`)
  ;[0, 1].forEach((i) => {
    bar.push(`<rect x="${num(sbx + i * 100)}" y="${num(sby)}" width="100" height="${num(fs * 0.5)}" fill="${i ? '#fff' : '#0f172a'}" stroke="#0f172a" stroke-width="${num(fs * 0.08)}"/>`)
  })
  bar.push(`<text x="${num(sbx)}" y="${num(sby - fs * 0.35)}" text-anchor="middle">0</text>`)
  bar.push(`<text x="${num(sbx + 100)}" y="${num(sby - fs * 0.35)}" text-anchor="middle">1 m</text>`)
  bar.push(`<text x="${num(sbx + 200)}" y="${num(sby - fs * 0.35)}" text-anchor="middle">2 m</text>`)
  bar.push('</g>')

  const legendItems: { label: string; draw: (x: number, y: number) => string }[] = [
    { label: 'Bearing wall', draw: (x, y) => wallSwatch(x, y, fs, 'bearing') },
    { label: 'Partition wall', draw: (x, y) => wallSwatch(x, y, fs, 'partition') },
    { label: 'Exterior wall', draw: (x, y) => wallSwatch(x, y, fs, 'exterior') },
    { label: 'Door', draw: (x, y) => swatchLine(x, y, fs, COLORS.door, true) },
    { label: 'Window', draw: (x, y) => swatchLine(x, y, fs, COLORS.window, false) },
    { label: 'Storage', draw: (x, y) => `<rect x="${num(x)}" y="${num(y - fs * 0.35)}" width="${num(fs * 2)}" height="${num(fs * 0.7)}" fill="#6b728018" stroke="${COLORS.cupboard}" stroke-width="${num(fs * 0.08)}"/>` },
    { label: 'Radiator', draw: (x, y) => `<rect x="${num(x)}" y="${num(y - fs * 0.25)}" width="${num(fs * 2)}" height="${num(fs * 0.5)}" fill="#dc262622" stroke="${COLORS.radiator}" stroke-width="${num(fs * 0.08)}"/>` },
    { label: 'Verified on site', draw: (x, y) => `<text x="${num(x)}" y="${num(y + fs * 0.3)}" fill="${VERIFIED}" font-size="${num(fs * 0.9)}">123</text>` },
  ]
  const entryW = fs * 10
  const perRow = Math.max(1, Math.floor((W - fs * 4) / entryW))
  const legTop = sby + fs * 2.6
  const leg: string[] = [`<g id="legend" font-size="${num(fs * 0.85)}" fill="#0f172a">`]
  leg.push(`<text x="${num(x0 + fs * 2)}" y="${num(legTop)}" font-weight="700">Legend</text>`)
  legendItems.forEach((it, i) => {
    const col = i % perRow, row = Math.floor(i / perRow)
    const lx = x0 + fs * 2 + col * entryW, ly = legTop + fs * 1.8 + row * fs * 1.7
    leg.push(it.draw(lx, ly))
    leg.push(`<text x="${num(lx + fs * 2.4)}" y="${num(ly + fs * 0.3)}">${esc(it.label)}</text>`)
  })
  leg.push('</g>')
  const rows = Math.ceil(legendItems.length / perRow)
  const legBottom = legTop + fs * 1.8 + rows * fs * 1.7 + fs
  // ----- room schedule (optional): under the legend, the image grows to hold it -----
  const sched = opts.schedule ? scheduleRows(doc) : null
  const schedTop = legBottom + fs
  const schedH = sched && sched.rows.length ? fs * 1.8 + scheduleTableHeight(sched.rows.length, fs, true) + fs : 0
  const schedSvg = sched && sched.rows.length
    ? `<g id="schedule" fill="#0f172a"><text x="${num(x0 + fs * 2)}" y="${num(schedTop)}" font-size="${num(fs * 0.85)}" font-weight="700">Room schedule</text>`
      + scheduleSvgTable(sched.rows, { x: x0 + fs * 2, y: schedTop + fs * 0.8, fontSize: fs * 0.75, areaDecimals: opts.roomTag?.areaDecimals, totals: sched.totals })
      + '</g>'
    : ''
  const H = legBottom + schedH - y0

  // ----- header -----
  const date = opts.date ?? new Date().toISOString().slice(0, 10)
  parts.push(`<text id="title" x="${num(x0 + fs * 2)}" y="${num(y0 + fs * 2.4)}" font-size="${num(fs * 1.8)}" font-weight="700" fill="#0f172a">${esc(doc.title || 'Floor plan')}</text>`)
  parts.push(`<text x="${num(x0 + fs * 2)}" y="${num(y0 + fs * 4)}" font-size="${num(fs * 0.9)}" fill="#475569">${esc(date)}</text>`)

  // ----- background -----
  const bg = doc.background
  if (opts.background && opts.backgroundHref && bg && bg.visible) {
    const w = bg.naturalWidth * bg.cmPerPx, h = bg.naturalHeight * bg.cmPerPx
    parts.push(`<image href="${esc(opts.backgroundHref)}" x="${num(bg.xCm)}" y="${num(bg.yCm)}" width="${num(w)}" height="${num(h)}" opacity="${bg.opacity}" transform="rotate(${bg.rotationDeg} ${num(bg.xCm + w / 2)} ${num(bg.yCm + h / 2)})"/>`)
  }

  // ----- rooms -----
  const hatch = fs * 0.7
  const defs = `<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="${num(hatch)}" height="${num(hatch)}" patternTransform="rotate(45)"><line x1="${num(hatch / 2)}" y1="0" x2="${num(hatch / 2)}" y2="${num(hatch)}" stroke="#fff" stroke-opacity="0.8" stroke-width="${num(fs * 0.14)}"/></pattern></defs>`
  const style = `<style>text{font-family:Helvetica,Arial,sans-serif}rect[class*="fill-"]{fill:#fff}</style>`

  for (const r of doc.rooms) {
    parts.push(`<path d="${pathOf([r.vertices, ...r.holes])}" fill-rule="evenodd" fill="${r.outdoor ? '#d1fae5' : '#eef6fb'}"/>`)
    for (const h of r.holes) parts.push(`<path d="${pathOf([h])}" fill="none" stroke="#334155" stroke-width="${num(fs * 0.15)}"/>`)
  }
  for (const r of doc.rooms) {
    for (const w of roomWalls(r)) {
      const { type, t } = wallInfo(r, w.start.id)
      const common = `x1="${num(w.start.x)}" y1="${num(w.start.y)}" x2="${num(w.end.x)}" y2="${num(w.end.y)}" stroke-linecap="square"`
      parts.push(`<line ${common} stroke="${WALL_STROKE[type]}" stroke-width="${num(t)}" data-wall-type="${type}"/>`)
      if (type === 'bearing') parts.push(`<line ${common} stroke="url(#hatch)" stroke-width="${num(t)}"/>`)
    }
  }

  // ----- elements -----
  for (const e of doc.elements ?? []) {
    if (!(typeof e.widthCm === 'number' && Number.isFinite(e.widthCm) && e.widthCm > 0)) continue
    const room = doc.rooms.find((r) => r.id === e.roomId)
    const wall = room && wallByStart(room, e.wallStart)
    if (!room || !wall) continue
    const f = elementFrame(wall, e)
    const inner = renderToStaticMarkup(createElement(ElementSymbol, {
      kind: e.kind, variant: e.variant, w: e.widthCm, t: wallThickness(room, e.wallStart),
      depth: e.depthCm, hinge: e.hinge, swing: e.swing, hair: 1,
    }))
    parts.push(`<g transform="matrix(${f.dir.x} ${f.dir.y} ${f.inward.x} ${f.inward.y} ${num(f.a.x)} ${num(f.a.y)})">${inner}</g>`)
  }

  // ----- wall lengths and room tags -----
  // The tags of the plan are laid out first, then ONE declutter pass keeps the wall values that hit
  // no other value, no room tag and no outside row text (the rules of the plan, V-1..V-7): a dropped
  // value keeps its line and its ticks, and nothing goes past the end of a line any more.
  const layout = planDimsLayout({
    doc, style: dimStyle, tagFields, zoom, fs, step, units, surveyLabels, runs,
    // Thickness of the wall that starts at a vertex: the same defaults as the drawing.
    thicknessOf: (r: Room, startId: string) => wallInfo(r, startId).t,
    defaultCeilingCm: doc.apartment?.defaultCeilingCm,
  })
  for (const { entries, tag } of layout.rooms) {
    // Wall lengths: dimension lines (default) or the old text only, like the plan.
    parts.push(roomWallDimsSvg(entries, { fs, zoom }))
    parts.push(tag.svg)
  }

  // ----- outside dimension chains (v2 documents, when the option is on) -----
  const hidden = outsideExportHidden(runs, zoom, step, units, surveyLabels)
  for (const run of runs) parts.push(outsideRunSvg(run, { zoom, fs, step, units, surveyLabels, hidden }))

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x0)} ${num(y0)} ${num(W)} ${num(H)}" width="${num(W)}" height="${num(H)}">${style}${defs}<rect x="${num(x0)}" y="${num(y0)}" width="${num(W)}" height="${num(H)}" fill="#fff"/>${parts.join('')}${bar.join('')}${leg.join('')}${schedSvg}</svg>`
  return { svg, width: W, height: H, fontSize: fs, layout }
}

function wallSwatch(x: number, y: number, fs: number, type: WallType) {
  const t = fs * 0.7
  const line = `x1="${num(x)}" y1="${num(y)}" x2="${num(x + fs * 2)}" y2="${num(y)}" stroke-width="${num(t)}"`
  return `<line ${line} stroke="${WALL_STROKE[type]}"/>` + (type === 'bearing' ? `<line ${line} stroke="url(#hatch)"/>` : '')
}

function swatchLine(x: number, y: number, fs: number, color: string, arc: boolean) {
  const sw = num(fs * 0.1)
  if (arc) return `<line x1="${num(x)}" y1="${num(y + fs * 0.4)}" x2="${num(x)}" y2="${num(y - fs * 0.4)}" stroke="${color}" stroke-width="${num(fs * 0.25)}"/><path d="M ${num(x + fs * 1.6)} ${num(y + fs * 0.4)} A ${num(fs * 0.8)} ${num(fs * 0.8)} 0 0 0 ${num(x)} ${num(y - fs * 0.4)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${num(fs * 0.2)} ${num(fs * 0.15)}"/>`
  return [-0.25, 0, 0.25].map((k) => `<line x1="${num(x)}" y1="${num(y + fs * k)}" x2="${num(x + fs * 2)}" y2="${num(y + fs * k)}" stroke="${color}" stroke-width="${sw}"/>`).join('')
}

// ---------- raster / PDF helpers ----------

/** Standard drawing scales (denominators), small to large. */
export const STANDARD_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000]

/**
 * Pick the largest standard scale 1:S where a drawing of `wCm` x `hCm` fits a page area of `availMm`.
 * Returns null when even the smallest listed scale does not fit.
 */
export function fitStandardScale(wCm: number, hCm: number, availWmm: number, availHmm: number): number | null {
  for (const s of STANDARD_SCALES) {
    if ((wCm * 10) / s <= availWmm && (hCm * 10) / s <= availHmm) return s
  }
  return null
}

/** Rasterize an SVG string to a canvas at the given pixel width (browser only). */
export async function svgToCanvas(svg: string, widthPx: number, heightPx: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('SVG render failed')); img.src = url })
    const c = document.createElement('canvas')
    c.width = Math.round(widthPx); c.height = Math.round(heightPx)
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0, c.width, c.height)
    return c
  } finally { URL.revokeObjectURL(url) }
}

/** Fetch an object/data URL and return a data: URL (so a downloaded SVG stays standalone). */
export async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src
  const blob = await (await fetch(src)).blob()
  return await new Promise<string>((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error)
    fr.readAsDataURL(blob)
  })
}
