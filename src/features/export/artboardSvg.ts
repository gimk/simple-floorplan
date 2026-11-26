// One-click artboard export: a pure SVG 1.1 renderer for one artboard (the source of both the SVG and
// the PNG download). No React, no store, no DOM, so the unit tests run in Node/Vitest.
// Units: cm and degrees; y points down (same as the canvas). Screen sizes (strokes, fonts, ticks) are
// given in px and divided by the chosen scale, so the exported picture looks the same at any size.
import { fmtCm, labelPoint, signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import type { Artboard, FurnitureItem, Opening, Room } from '../../model/types'
import { ARTBOARD_PAD_CM, artboardFrame, roomAreaM2 } from '../artboards/frame'
import { directionArrowGeometry, furnitureCornerRadiusCm } from '../furniture/geometry'
import { doorArcGeometry, openingEndpoints, openingSymbol, openingVariant } from '../openings/geometry'

export type ExportOptions = {
  /** Draw the furniture of the artboard. Default: true. */
  includeFurniture?: boolean
  /** Draw a length label on every long enough wall, in cm. Default: true. */
  includeWallLabels?: boolean
  /** Project name shown in the header, above the artboard name. */
  projectTitle?: string
}

const BG = '#12161b'
const LINE = '#e4e4e7'
const TEXT = 'rgba(241,245,249,0.9)'
const TEXT_DIM = 'rgba(203,213,225,0.7)'
const WALL_LABEL = 'rgba(226,232,240,0.9)'
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** Header band above the drawing, in cm (holds the project title, the artboard name and the area). */
const HEADER_BAND_CM = 44
/** Base scale of the drawing, in px per cm. */
const BASE_PX_PER_CM = 2
/** The longest side is kept in this px range, so small plans are sharp and big plans stay light. */
const MIN_LONG_SIDE_PX = 800
const MAX_LONG_SIDE_PX = 2400
/** A wall shorter than this on screen gets no length label (same rule as the canvas). */
const MIN_WALL_LABEL_PX = 36

const RAD = Math.PI / 180

const round = (v: number, digits: number) => {
  const k = 10 ** digits
  return Math.round(v * k) / k + 0 // "+ 0" turns -0 into 0
}

/** Compact, valid number for an SVG attribute: at most 3 decimals, no trailing zeros. */
const num = (v: number): string => {
  if (!Number.isFinite(v)) return '0'
  return String(round(v, 3) === 0 ? 0 : round(v, 3))
}

/** XML-escape a text string, so names with <, >, &, quotes or apostrophes stay valid. */
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * Safe download filename: lowercase kebab-case, accents and punctuation removed, at most 60 chars.
 * Falls back to "floorplan" when the name holds no letter or digit.
 */
export function slugFilename(name: string, ext: 'svg' | 'png'): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents: é -> e, ü -> u
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return `${slug || 'floorplan'}.${ext}`
}

/** Axis box of the world point set, or null when there is nothing to draw. */
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** Axis box of a furniture item in artboard-local cm, rotation included. */
function furnitureBounds(f: FurnitureItem): Bounds {
  const cos = Math.cos(f.rotationDeg * RAD), sin = Math.sin(f.rotationDeg * RAD)
  const hw = f.widthCm / 2, hd = f.depthCm / 2
  if (f.shape === 'circle') {
    // Half extents of a rotated ellipse.
    const rx = Math.hypot(hw * cos, hd * sin), ry = Math.hypot(hw * sin, hd * cos)
    return { minX: f.xCm - rx, minY: f.yCm - ry, maxX: f.xCm + rx, maxY: f.yCm + ry }
  }
  const xs: number[] = [], ys: number[] = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const lx = sx * hw, ly = sy * hd
      xs.push(f.xCm + lx * cos - ly * sin)
      ys.push(f.yCm + lx * sin + ly * cos)
    }
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** Tight extent of the drawing in artboard-local cm (rooms, openings, doors' swing, furniture). */
function contentBounds(a: Artboard, includeFurniture: boolean): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  for (const r of a.rooms) for (const v of r.vertices) grow(v.x, v.y)
  for (const o of a.openings) {
    const { start, end } = openingEndpoints(o)
    grow(start.x, start.y); grow(end.x, end.y)
    // A door swinging outwards leaves the wall line: the open tip must stay inside the sheet.
    if (o.kind === 'door') { const g = doorArcGeometry(o); grow(g.openTipPt.x, g.openTipPt.y) }
    // Sliding panels, pocket receivers and window sashes also leave the wall line.
    for (const p of openingSymbol(o, (px) => px / BASE_PX_PER_CM).paths) for (const q of p.pts) grow(q.x, q.y)
  }
  if (includeFurniture) {
    for (const f of a.furniture) {
      const b = furnitureBounds(f)
      grow(b.minX, b.minY); grow(b.maxX, b.maxY)
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/** Artboard frame (world cm) as artboard-local cm, used when the artboard holds no content. */
function frameBounds(a: Artboard): Bounds {
  const f = artboardFrame(a)
  const x = f.x - a.xCm, y = f.y - a.yCm
  return { minX: x, minY: y, maxX: x + f.width, maxY: y + f.height }
}

type Ctx = {
  /** px -> cm at the chosen scale. */
  u: (px: number) => number
  pxPerCm: number
  includeWallLabels: boolean
  /** Too-short walls are skipped; two rooms that share a wall print its length only once. */
  wallLabelSeen: Set<string>
}

/** Rooms: filled polygon, 1.5px outline, name + area in the middle, wall lengths on the outside. */
function roomSvg(room: Room, ctx: Ctx): string[] {
  const v = room.vertices
  if (v.length < 3) return []
  const out: string[] = []
  const pts = v.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')
  const fillOpacity = room.fill ? ' fill-opacity="0.28"' : ''
  out.push(
    `    <polygon data-room="${esc(room.id)}" points="${pts}" fill="${esc(room.fill ?? 'rgba(255,255,255,0.04)')}"${fillOpacity} ` +
      `stroke="${LINE}" stroke-width="${num(ctx.u(1.5))}" stroke-linejoin="round" />`,
  )
  const c = labelPoint([v])
  out.push(
    `    <text x="${num(c.x)}" y="${num(c.y - ctx.u(2))}" text-anchor="middle" font-family="${FONT}" ` +
      `font-size="${num(ctx.u(13))}" font-weight="600" fill="${TEXT}">${esc(room.name)}</text>`,
    `    <text x="${num(c.x)}" y="${num(c.y + ctx.u(13))}" text-anchor="middle" font-family="${FONT}" ` +
      `font-size="${num(ctx.u(11))}" fill="${TEXT_DIM}">${esc(fmtCm(round(roomAreaM2(room), 2)))} m²</text>`,
  )
  if (!ctx.includeWallLabels) return out
  const s = signedArea(v) >= 0 ? 1 : -1
  for (let i = 0; i < v.length; i++) {
    const a: Vec = v[i], b: Vec = v[(i + 1) % v.length]
    const lengthCm = Math.hypot(b.x - a.x, b.y - a.y)
    if (lengthCm < 1e-6 || lengthCm * ctx.pxPerCm < MIN_WALL_LABEL_PX) continue
    // A wall shared by two rooms (same two corners, either way round) gets one label only.
    const key = [a, b].map((p) => `${num(p.x)},${num(p.y)}`).sort().join('|')
    if (ctx.wallLabelSeen.has(key)) continue
    ctx.wallLabelSeen.add(key)
    const dx = (b.x - a.x) / lengthCm, dy = (b.y - a.y) / lengthCm
    const off = ctx.u(10)
    const lx = (a.x + b.x) / 2 - dy * s * off, ly = (a.y + b.y) / 2 + dx * s * off
    const angleDeg = Math.atan2(b.y - a.y, b.x - a.x) / RAD
    // Keep the label readable (never upside down) and the angle small.
    const flipped = angleDeg > 90 || angleDeg <= -90 ? angleDeg + 180 : angleDeg
    const rot = ((flipped % 360) + 540) % 360 - 180
    const text = `${fmtCm(round(lengthCm, 1))} cm`
    out.push(
      `    <text transform="translate(${num(lx)} ${num(ly)}) rotate(${num(rot)})" text-anchor="middle" ` +
        `dominant-baseline="central" font-family="${FONT}" font-size="${num(ctx.u(11))}" fill="${WALL_LABEL}" ` +
        `stroke="${BG}" stroke-width="${num(ctx.u(3))}" paint-order="stroke" stroke-linejoin="round">${esc(text)}</text>`,
    )
  }
  return out
}

/** Furniture: rect with a front-edge tick (local -Y) or ellipse, fill at 0.78, name in the middle. */
function furnitureSvg(f: FurnitureItem, ctx: Ctx): string[] {
  const w = f.widthCm, d = f.depthCm
  const common = `fill="${esc(f.color)}" fill-opacity="0.78" stroke="${LINE}" stroke-opacity="0.45" stroke-width="${num(ctx.u(1))}"`
  const out: string[] = [
    `    <g data-furniture="${esc(f.id)}" transform="translate(${num(f.xCm)} ${num(f.yCm)}) rotate(${num(f.rotationDeg)})">`,
  ]
  if (f.shape === 'circle') {
    out.push(`      <ellipse cx="0" cy="0" rx="${num(w / 2)}" ry="${num(d / 2)}" ${common} />`)
  } else {
    const rx = furnitureCornerRadiusCm(w, d, f.cornerRadiusCm)
    out.push(
      `      <rect x="${num(-w / 2)}" y="${num(-d / 2)}" width="${num(w)}" height="${num(d)}" ` +
        `rx="${num(rx)}" ry="${num(rx)}" ${common} />`,
    )
  }
  // Optional subtle front-direction chevron on local -Y, as on the canvas.
  const arrow = f.showDirection ? directionArrowGeometry(w, d, ctx.u) : null
  if (arrow) {
    out.push(
      `      <path d="M ${num(arrow.left.x)} ${num(arrow.left.y)} L ${num(arrow.tip.x)} ${num(arrow.tip.y)} ` +
        `L ${num(arrow.right.x)} ${num(arrow.right.y)}" fill="none" stroke="#f4f4f5" stroke-opacity="0.55" ` +
        `stroke-width="${num(ctx.u(1.5))}" stroke-linecap="round" stroke-linejoin="round" />`,
    )
  }
  const fontSize = Math.min(ctx.u(11), d * 0.55, w * 0.35)
  if (fontSize > 0) {
    out.push(
      `      <text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" ` +
        `font-size="${num(fontSize)}" font-weight="600" fill="rgba(250,250,250,0.95)" stroke="${BG}" ` +
        `stroke-width="${num(ctx.u(2.5))}" paint-order="stroke" stroke-linejoin="round">${esc(f.name)}</text>`,
    )
  }
  out.push('    </g>')
  return out
}

/** Openings on top of the walls: background gap line, then the 1px symbol of the kind and its style. */
function openingSvg(op: Opening, ctx: Ctx): string[] {
  const { start, end } = openingEndpoints(op)
  const nx = -Math.sin(op.angleDeg * RAD), ny = Math.cos(op.angleDeg * RAD)
  const tick = ctx.u(4)
  const symbol = openingSymbol(op, ctx.u)
  const out: string[] = []
  out.push(
    `    <g data-opening="${esc(op.id)}" data-kind="${esc(op.kind)}" data-variant="${esc(openingVariant(op))}">`,
    `      <line x1="${num(start.x)}" y1="${num(start.y)}" x2="${num(end.x)}" y2="${num(end.y)}" ` +
      `stroke="${BG}" stroke-width="${num(ctx.u(3))}" />`,
  )
  const ticks = (color: string) => [
    `      <line x1="${num(start.x - nx * tick)}" y1="${num(start.y - ny * tick)}" x2="${num(start.x + nx * tick)}" ` +
      `y2="${num(start.y + ny * tick)}" stroke="${color}" stroke-width="${num(ctx.u(1))}" />`,
    `      <line x1="${num(end.x - nx * tick)}" y1="${num(end.y - ny * tick)}" x2="${num(end.x + nx * tick)}" ` +
      `y2="${num(end.y + ny * tick)}" stroke="${color}" stroke-width="${num(ctx.u(1))}" />`,
  ]
  // Sliding and pocket styles keep a 1px line through the wall, with the panels offset from it.
  if (symbol.wallLine) {
    out.push(
      `      <line x1="${num(start.x)}" y1="${num(start.y)}" x2="${num(end.x)}" y2="${num(end.y)}" ` +
        `stroke="${LINE}" stroke-width="${num(ctx.u(1))}" />`,
    )
  }
  for (const p of symbol.paths) {
    const attrs =
      `stroke="${LINE}" stroke-width="${num(ctx.u(p.weight ?? 1))}"` +
      (p.opacity === undefined ? '' : ` stroke-opacity="${num(p.opacity)}"`) +
      (p.dashed ? ` stroke-dasharray="${num(ctx.u(3))} ${num(ctx.u(3))}"` : '')
    if (p.closed) {
      out.push(
        `      <polygon points="${p.pts.map((q) => `${num(q.x)},${num(q.y)}`).join(' ')}" ` +
          `fill="none" ${attrs} stroke-linejoin="round" />`,
      )
    } else {
      const a = p.pts[0], b = p.pts[p.pts.length - 1]
      out.push(
        `      <line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" ` +
          `${attrs} stroke-linecap="round" />`,
      )
    }
  }
  for (const a of symbol.arcs) {
    out.push(
      `      <path d="M ${num(a.from.x)} ${num(a.from.y)} A ${num(a.radius)} ${num(a.radius)} 0 0 ` +
        `${a.sweepFlag} ${num(a.to.x)} ${num(a.to.y)}" fill="none" stroke="${LINE}" ` +
        `stroke-width="${num(ctx.u(1))}" stroke-opacity="0.8" />`,
    )
  }
  // Openings keep their jamb ticks on every style, as on the canvas.
  out.push(...ticks(LINE))
  out.push('    </g>')
  return out
}

/** Header: project title (optional), artboard name, total area and a hairline under the band. */
function headerSvg(a: Artboard, sheetX: number, sheetW: number, sheetY: number, projectTitle: string | undefined, u: (px: number) => number): string[] {
  const left = sheetX + ARTBOARD_PAD_CM
  const nameSize = Math.min(u(17), HEADER_BAND_CM * 0.42)
  const smallSize = Math.min(u(11), HEADER_BAND_CM * 0.26)
  const out: string[] = []
  if (projectTitle) {
    out.push(
      `    <text x="${num(left)}" y="${num(sheetY + HEADER_BAND_CM * 0.34)}" font-family="${FONT}" ` +
        `font-size="${num(smallSize)}" fill="${TEXT_DIM}" letter-spacing="${num(u(0.8))}">${esc(projectTitle)}</text>`,
    )
  }
  out.push(
    `    <text x="${num(left)}" y="${num(sheetY + HEADER_BAND_CM * (projectTitle ? 0.78 : 0.68))}" font-family="${FONT}" ` +
      `font-size="${num(nameSize)}" font-weight="700" fill="#f4f4f5">${esc(a.name)}</text>`,
    `    <text x="${num(sheetX + sheetW - ARTBOARD_PAD_CM)}" y="${num(sheetY + HEADER_BAND_CM * 0.68)}" ` +
      `text-anchor="end" font-family="${FONT}" font-size="${num(smallSize)}" fill="${TEXT_DIM}">` +
      `${esc(fmtCm(round(a.rooms.reduce((sum, r) => sum + roomAreaM2(r), 0), 2)))} m²</text>`,
    `    <line x1="${num(left)}" y1="${num(sheetY + HEADER_BAND_CM)}" x2="${num(sheetX + sheetW - ARTBOARD_PAD_CM)}" ` +
      `y2="${num(sheetY + HEADER_BAND_CM)}" stroke="${LINE}" stroke-opacity="0.14" stroke-width="${num(u(1))}" />`,
  )
  return out
}

/**
 * Standalone SVG 1.1 picture of one artboard: dark page, header with the name and the total area,
 * rooms with their fill and labels, furniture, then the openings on top of the walls.
 * Returns the markup and the pixel size of the picture.
 */
export function renderArtboardSvg(artboard: Artboard, opts: ExportOptions = {}): { svg: string; widthPx: number; heightPx: number } {
  const includeFurniture = opts.includeFurniture !== false
  const content = contentBounds(artboard, includeFurniture) ?? frameBounds(artboard)
  // 40 cm of empty space around the content, and a 44 cm band at the top for the header.
  const sheetX = content.minX - ARTBOARD_PAD_CM
  const sheetY = content.minY - ARTBOARD_PAD_CM - HEADER_BAND_CM
  const sheetW = content.maxX - content.minX + 2 * ARTBOARD_PAD_CM
  const sheetH = content.maxY - content.minY + 2 * ARTBOARD_PAD_CM + HEADER_BAND_CM
  const longSideCm = Math.max(sheetW, sheetH)
  let pxPerCm = BASE_PX_PER_CM
  if (longSideCm > 0) {
    if (longSideCm * pxPerCm < MIN_LONG_SIDE_PX) pxPerCm = MIN_LONG_SIDE_PX / longSideCm
    else if (longSideCm * pxPerCm > MAX_LONG_SIDE_PX) pxPerCm = MAX_LONG_SIDE_PX / longSideCm
  }
  const widthPx = Math.max(1, Math.round(sheetW * pxPerCm))
  const heightPx = Math.max(1, Math.round(sheetH * pxPerCm))
  const ctx: Ctx = {
    u: (px: number) => px / pxPerCm,
    pxPerCm,
    includeWallLabels: opts.includeWallLabels !== false,
    wallLabelSeen: new Set<string>(),
  }

  const body: string[] = []
  body.push(
    `    <rect x="${num(sheetX)}" y="${num(sheetY)}" width="${num(sheetW)}" height="${num(sheetH)}" fill="${BG}" />`,
    ...headerSvg(artboard, sheetX, sheetW, sheetY, opts.projectTitle, ctx.u),
  )
  for (const room of artboard.rooms) body.push(...roomSvg(room, ctx))
  if (includeFurniture) for (const f of artboard.furniture) body.push(...furnitureSvg(f, ctx))
  for (const op of artboard.openings) body.push(...openingSvg(op, ctx))

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${widthPx}" height="${heightPx}" ` +
      `viewBox="${num(sheetX)} ${num(sheetY)} ${num(sheetW)} ${num(sheetH)}">`,
    `  <title>${esc(opts.projectTitle ? `${opts.projectTitle} — ${artboard.name}` : artboard.name)}</title>`,
    '  <g>',
    ...body,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')

  return { svg, widthPx, heightPx }
}
