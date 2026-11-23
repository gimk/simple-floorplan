// Pure headless SVG renderer for PlanDoc (zero React, zero DOM).
// Safe for Cloudflare Workers, Node, CLI, and browsers. World units are cm.
import { fmtCm, labelPoint, roomAreaM2, roomWalls, wallByStart } from '../model/geometry'
import type { ElementKind, ElementVariant, PlanDoc, Room, Vec, WallType } from '../model/types'
import { elementFrame, wallThickness } from '../features/elements/geometry'

export type RenderSvgOptions = {
  /** Include the background image when available. */
  background?: boolean
  /** Explicit href (e.g. data: URL) for the background image. Falls back to doc.background.src. */
  backgroundHref?: string
  /** Date label; default today (ISO yyyy-mm-dd). */
  date?: string
}

export type RenderSvgResult = {
  svg: string
  /** viewBox width in cm */
  width: number
  /** viewBox height in cm */
  height: number
  /** Base font size in cm */
  fontSize: number
}

const COLORS: Record<ElementKind, string> = {
  window: '#2563eb',
  door: '#7c3aed',
  opening: '#7c3aed',
  radiator: '#dc2626',
  cupboard: '#6b7280',
  other: '#6b7280',
}

const WALL_STROKE: Record<WallType, string> = {
  bearing: '#0f172a',
  exterior: '#0f172a',
  partition: '#94a3b8',
}

const DEFAULT_T: Record<WallType, number> = {
  partition: 10,
  bearing: 25,
  exterior: 30,
}

const VERIFIED = '#15803d'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const num = (v: number) => String(Math.round(v * 100) / 100)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const pathOf = (rings: Vec[][]) =>
  rings.map((r) => 'M' + r.map((p) => `${num(p.x)} ${num(p.y)}`).join('L') + 'Z').join('')

const wallInfo = (r: Room, startId: string) => {
  const p = r.walls[startId]
  const type: WallType = p?.type ?? 'partition'
  return { type, t: p && p.thicknessCm > 0 ? p.thicknessCm : DEFAULT_T[type] }
}

export function planBounds(doc: PlanDoc, opts: RenderSvgOptions = {}) {
  const pts: Vec[] = doc.rooms.flatMap((r) => r.vertices)
  const bg = doc.background
  if (opts.background && bg && bg.visible) {
    const w = bg.naturalWidth * bg.cmPerPx
    const h = bg.naturalHeight * bg.cmPerPx
    pts.push({ x: bg.xCm, y: bg.yCm }, { x: bg.xCm + w, y: bg.yCm + h })
  }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 }
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
}

function renderElementSymbolSvg(params: {
  kind: ElementKind
  variant?: ElementVariant
  w: number
  t: number
  depth?: number
  hinge?: 'start' | 'end'
  swing?: 'in' | 'out'
  hair: number
}): string {
  const { kind, variant, w, t, depth, hinge = 'start', swing = 'in', hair } = params
  const c = COLORS[kind]
  const h = t / 2
  const thin = Math.max(hair * 1.2, 1)
  const leaf = Math.max(hair * 2.2, 3)
  const s = swing === 'in' ? 1 : -1

  const gap =
    `<rect x="0" y="${num(-h - 0.5)}" width="${num(w)}" height="${num(t + 1)}" fill="#ffffff"/>` +
    `<line x1="0" x2="0" y1="${num(-h)}" y2="${num(h)}" stroke="${c}" stroke-width="${num(thin)}"/>` +
    `<line x1="${num(w)}" x2="${num(w)}" y1="${num(-h)}" y2="${num(h)}" stroke="${c}" stroke-width="${num(thin)}"/>`

  const leafArc = (hx: number, len: number, hg: 'start' | 'end') => {
    const ox = hg === 'start' ? hx + len : hx - len
    const sweep = (hg === 'start') === (s > 0) ? 1 : 0
    return (
      `<line x1="${num(hx)}" y1="0" x2="${num(hx)}" y2="${num(s * len)}" stroke="${c}" stroke-width="${num(leaf)}" stroke-linecap="butt"/>` +
      `<path d="M ${num(ox)} 0 A ${num(len)} ${num(len)} 0 0 ${sweep} ${num(hx)} ${num(s * len)}" fill="none" stroke="${c}" stroke-width="${num(thin)}" stroke-dasharray="${num(thin * 4)} ${num(thin * 3)}"/>`
    )
  }

  if (kind === 'door') {
    if (variant === 'double') {
      return `<g>${gap}${leafArc(0, w / 2, 'start')}${leafArc(w, w / 2, 'end')}</g>`
    }
    if (variant === 'sliding') {
      const y = t / 4
      return (
        `<g>${gap}` +
        `<line x1="${num(w * 0.45)}" x2="${num(w)}" y1="${num(y)}" y2="${num(y)}" stroke="${c}" stroke-width="${num(leaf)}"/>` +
        `<line x1="0" x2="${num(w * 0.45)}" y1="${num(-y)}" y2="${num(-y)}" stroke="${c}" stroke-width="${num(thin)}"/>` +
        `<path d="M ${num(w * 0.4)} ${num(-y - t * 0.9)} L ${num(w * 0.15)} ${num(-y - t * 0.9)} M ${num(w * 0.15 + 6)} ${num(-y - t * 0.9 - 4)} L ${num(w * 0.15)} ${num(-y - t * 0.9)} L ${num(w * 0.15 + 6)} ${num(-y - t * 0.9 + 4)}" fill="none" stroke="${c}" stroke-width="${num(thin)}"/>` +
        `</g>`
      )
    }
    if (variant === 'pocket') {
      const x0 = hinge === 'start' ? -w : w
      return (
        `<g>${gap}` +
        `<line x1="0" x2="${num(w)}" y1="0" y2="0" stroke="${c}" stroke-width="${num(thin)}"/>` +
        `<rect x="${num(x0)}" y="${num(-leaf / 2)}" width="${num(w)}" height="${num(leaf)}" fill="none" stroke="${c}" stroke-width="${num(thin)}" stroke-dasharray="${num(thin * 4)} ${num(thin * 3)}"/>` +
        `</g>`
      )
    }
    return `<g>${gap}${leafArc(hinge === 'start' ? 0 : w, w, hinge)}</g>`
  }

  if (kind === 'opening') {
    return (
      `<g>${gap}` +
      `<line x1="${num(-h * 0.4)}" x2="${num(h * 0.4)}" y1="${num(-h)}" y2="${num(-h)}" stroke="${c}" stroke-width="${num(thin)}"/>` +
      `<line x1="${num(w - h * 0.4)}" x2="${num(w + h * 0.4)}" y1="${num(-h)}" y2="${num(-h)}" stroke="${c}" stroke-width="${num(thin)}"/>` +
      `<line x1="0" x2="${num(w)}" y1="0" y2="0" stroke="${c}" stroke-width="${num(thin)}" stroke-dasharray="${num(thin * 3)} ${num(thin * 3)}"/>` +
      `</g>`
    )
  }

  if (kind === 'window') {
    if (variant === 'fixed') {
      return `<g>${gap}<line x1="0" x2="${num(w)}" y1="0" y2="0" stroke="${c}" stroke-width="${num(leaf)}"/></g>`
    }
    const lines = [-h * 0.7, 0, h * 0.7]
      .map((y) => `<line x1="0" x2="${num(w)}" y1="${num(y)}" y2="${num(y)}" stroke="${c}" stroke-width="${num(thin)}"/>`)
      .join('')
    if (variant === 'french') {
      return `<g>${gap}${lines}${leafArc(0, w / 2, 'start')}${leafArc(w, w / 2, 'end')}</g>`
    }
    return `<g>${gap}${lines}</g>`
  }

  if (kind === 'radiator') {
    const d = depth ?? 10
    return `<rect x="0" y="${num(h)}" width="${num(w)}" height="${num(d)}" fill="#dc262622" stroke="${c}" stroke-width="${num(thin)}"/>`
  }

  if (kind === 'cupboard') {
    const d = depth ?? 60
    const y0 = variant === 'recessed' ? -h - d : h
    const dash = variant === 'wall-cabinet' ? ` stroke-dasharray="${num(thin * 5)} ${num(thin * 3)}"` : ''
    let extra = ''
    if (variant === 'wardrobe') {
      extra = `<path d="M 0 ${num(y0)} L ${num(w)} ${num(y0 + d)} M ${num(w)} ${num(y0)} L 0 ${num(y0 + d)}" stroke="${c}" stroke-width="${num(thin)}"/>`
    } else if (variant === 'recessed') {
      extra = `<path d="M 0 ${num(y0 + d)} L ${num(w)} ${num(y0)}" stroke="${c}" stroke-width="${num(thin)}"/>`
    }
    return `<g><rect x="0" y="${num(y0)}" width="${num(w)}" height="${num(d)}" fill="#6b728018" stroke="${c}" stroke-width="${num(thin)}"${dash}/>${extra}</g>`
  }

  return `<line x1="0" x2="${num(w)}" y1="0" y2="0" stroke="${c}" stroke-width="${num(leaf)}"/>`
}

function wallSwatch(x: number, y: number, fs: number, type: WallType) {
  const t = fs * 0.7
  const line = `x1="${num(x)}" y1="${num(y)}" x2="${num(x + fs * 2)}" y2="${num(y)}" stroke-width="${num(t)}"`
  return `<line ${line} stroke="${WALL_STROKE[type]}"/>` + (type === 'bearing' ? `<line ${line} stroke="url(#hatch)"/>` : '')
}

function swatchLine(x: number, y: number, fs: number, color: string, arc: boolean) {
  const sw = num(fs * 0.1)
  if (arc) {
    return (
      `<line x1="${num(x)}" y1="${num(y + fs * 0.4)}" x2="${num(x)}" y2="${num(y - fs * 0.4)}" stroke="${color}" stroke-width="${num(fs * 0.25)}"/>` +
      `<path d="M ${num(x + fs * 1.6)} ${num(y + fs * 0.4)} A ${num(fs * 0.8)} ${num(fs * 0.8)} 0 0 0 ${num(x)} ${num(y - fs * 0.4)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${num(fs * 0.2)} ${num(fs * 0.15)}"/>`
    )
  }
  return [-0.25, 0, 0.25]
    .map((k) => `<line x1="${num(x)}" y1="${num(y + fs * k)}" x2="${num(x + fs * 2)}" y2="${num(y + fs * k)}" stroke="${color}" stroke-width="${sw}"/>`)
    .join('')
}

/** Build a standalone SVG string of the plan (viewBox in cm). */
export function renderPlanSvg(doc: PlanDoc, opts: RenderSvgOptions = {}): RenderSvgResult {
  const b = planBounds(doc, opts)
  const cw = Math.max(b.maxX - b.minX, 100)
  const ch = Math.max(b.maxY - b.minY, 100)
  const fs = clamp(Math.max(cw, ch) / 60, 8, 30)
  const m = fs * 4
  const W = Math.max(cw + 2 * m, fs * 48)
  const cx = (b.minX + b.maxX) / 2
  const x0 = cx - W / 2
  const topH = fs * 5
  const y0 = b.minY - m / 2 - topH

  const planBottom = b.maxY + m / 2
  const parts: string[] = []
  const footTop = planBottom + fs

  // Scale bar
  const bar: string[] = []
  const sbx = x0 + fs * 2
  const sby = footTop + fs * 1.6
  bar.push(`<g id="scale-bar" font-size="${num(fs * 0.9)}" fill="#0f172a">`)
  for (const i of [0, 1]) {
    bar.push(
      `<rect x="${num(sbx + i * 100)}" y="${num(sby)}" width="100" height="${num(fs * 0.5)}" fill="${i ? '#fff' : '#0f172a'}" stroke="#0f172a" stroke-width="${num(fs * 0.08)}"/>`,
    )
  }
  bar.push(`<text x="${num(sbx)}" y="${num(sby - fs * 0.35)}" text-anchor="middle">0</text>`)
  bar.push(`<text x="${num(sbx + 100)}" y="${num(sby - fs * 0.35)}" text-anchor="middle">1 m</text>`)
  bar.push(`<text x="${num(sbx + 200)}" y="${num(sby - fs * 0.35)}" text-anchor="middle">2 m</text>`)
  bar.push('</g>')

  // Legend
  const legendItems: { label: string; draw: (x: number, y: number) => string }[] = [
    { label: 'Bearing wall', draw: (x, y) => wallSwatch(x, y, fs, 'bearing') },
    { label: 'Partition wall', draw: (x, y) => wallSwatch(x, y, fs, 'partition') },
    { label: 'Exterior wall', draw: (x, y) => wallSwatch(x, y, fs, 'exterior') },
    { label: 'Door', draw: (x, y) => swatchLine(x, y, fs, COLORS.door, true) },
    { label: 'Window', draw: (x, y) => swatchLine(x, y, fs, COLORS.window, false) },
    {
      label: 'Storage',
      draw: (x, y) =>
        `<rect x="${num(x)}" y="${num(y - fs * 0.35)}" width="${num(fs * 2)}" height="${num(fs * 0.7)}" fill="#6b728018" stroke="${COLORS.cupboard}" stroke-width="${num(fs * 0.08)}"/>`,
    },
    {
      label: 'Radiator',
      draw: (x, y) =>
        `<rect x="${num(x)}" y="${num(y - fs * 0.25)}" width="${num(fs * 2)}" height="${num(fs * 0.5)}" fill="#dc262622" stroke="${COLORS.radiator}" stroke-width="${num(fs * 0.08)}"/>`,
    },
    {
      label: 'Verified on site',
      draw: (x, y) => `<text x="${num(x)}" y="${num(y + fs * 0.3)}" fill="${VERIFIED}" font-size="${num(fs * 0.9)}">123</text>`,
    },
  ]
  const entryW = fs * 10
  const perRow = Math.max(1, Math.floor((W - fs * 4) / entryW))
  const legTop = sby + fs * 2.6
  const leg: string[] = [`<g id="legend" font-size="${num(fs * 0.85)}" fill="#0f172a">`]
  leg.push(`<text x="${num(x0 + fs * 2)}" y="${num(legTop)}" font-weight="700">Legend</text>`)
  legendItems.forEach((it, i) => {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const lx = x0 + fs * 2 + col * entryW
    const ly = legTop + fs * 1.8 + row * fs * 1.7
    leg.push(it.draw(lx, ly))
    leg.push(`<text x="${num(lx + fs * 2.4)}" y="${num(ly + fs * 0.3)}">${esc(it.label)}</text>`)
  })
  leg.push('</g>')
  const rows = Math.ceil(legendItems.length / perRow)
  const H = legTop + fs * 1.8 + rows * fs * 1.7 + fs - y0

  // Header
  const date = opts.date ?? new Date().toISOString().slice(0, 10)
  parts.push(
    `<text id="title" x="${num(x0 + fs * 2)}" y="${num(y0 + fs * 2.4)}" font-size="${num(fs * 1.8)}" font-weight="700" fill="#0f172a">${esc(doc.title || 'Floor plan')}</text>`,
  )
  parts.push(
    `<text x="${num(x0 + fs * 2)}" y="${num(y0 + fs * 4)}" font-size="${num(fs * 0.9)}" fill="#475569">${esc(date)}</text>`,
  )

  // Optional background image
  const bg = doc.background
  const bgHref = opts.backgroundHref ?? bg?.src
  if (opts.background && bg && bg.visible && bgHref) {
    const w = bg.naturalWidth * bg.cmPerPx
    const h = bg.naturalHeight * bg.cmPerPx
    parts.push(
      `<image href="${esc(bgHref)}" x="${num(bg.xCm)}" y="${num(bg.yCm)}" width="${num(w)}" height="${num(h)}" opacity="${bg.opacity}" transform="rotate(${bg.rotationDeg} ${num(bg.xCm + w / 2)} ${num(bg.yCm + h / 2)})"/>`,
    )
  }

  // Defs & style
  const hatch = fs * 0.7
  const defs = `<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="${num(hatch)}" height="${num(hatch)}" patternTransform="rotate(45)"><line x1="${num(hatch / 2)}" y1="0" x2="${num(hatch / 2)}" y2="${num(hatch)}" stroke="#fff" stroke-opacity="0.8" stroke-width="${num(fs * 0.14)}"/></pattern></defs>`
  const style = `<style>text{font-family:Helvetica,Arial,sans-serif}</style>`

  // Rooms
  for (const r of doc.rooms) {
    parts.push(
      `<path d="${pathOf([r.vertices, ...r.holes])}" fill-rule="evenodd" fill="${r.outdoor ? '#d1fae5' : '#eef6fb'}" data-room-id="${esc(r.id)}" data-room-code="${esc(r.code)}"/>`,
    )
    for (const h of r.holes) {
      parts.push(`<path d="${pathOf([h])}" fill="none" stroke="#334155" stroke-width="${num(fs * 0.15)}"/>`)
    }
  }

  // Walls
  for (const r of doc.rooms) {
    for (const w of roomWalls(r)) {
      const { type, t } = wallInfo(r, w.start.id)
      const label = `${r.code}-${w.index + 1}`
      const common = `x1="${num(w.start.x)}" y1="${num(w.start.y)}" x2="${num(w.end.x)}" y2="${num(w.end.y)}" stroke-linecap="square"`
      parts.push(
        `<line ${common} stroke="${WALL_STROKE[type]}" stroke-width="${num(t)}" data-wall-label="${esc(label)}" data-wall-type="${type}"/>`,
      )
      if (type === 'bearing') {
        parts.push(`<line ${common} stroke="url(#hatch)" stroke-width="${num(t)}"/>`)
      }
    }
  }

  // Elements
  for (const e of doc.elements ?? []) {
    const room = doc.rooms.find((r) => r.id === e.roomId)
    const wall = room && wallByStart(room, e.wallStart)
    if (!room || !wall) continue
    const f = elementFrame(wall, e)
    const inner = renderElementSymbolSvg({
      kind: e.kind,
      variant: e.variant,
      w: e.widthCm,
      t: wallThickness(room, e.wallStart),
      depth: e.depthCm,
      hinge: e.hinge,
      swing: e.swing,
      hair: 1,
    })
    parts.push(
      `<g data-element-id="${esc(e.id)}" data-element-kind="${e.kind}" transform="matrix(${f.dir.x} ${f.dir.y} ${f.inward.x} ${f.inward.y} ${num(f.a.x)} ${num(f.a.y)})">${inner}</g>`,
    )
  }

  // Dimensions
  for (const r of doc.rooms) {
    for (const w of roomWalls(r)) {
      if (w.length < fs * 6) continue
      const id = `${r.code}-${w.index + 1}`
      const meas = doc.measurements?.[id]
      const verified = !!meas && meas.actualCm > 0
      const val = verified ? meas.actualCm : w.length
      const off = wallInfo(r, w.start.id).t / 2 + fs * 0.9
      const mx = (w.start.x + w.end.x) / 2 + w.inward.x * off
      const my = (w.start.y + w.end.y) / 2 + w.inward.y * off
      let ang = (Math.atan2(w.dir.y, w.dir.x) * 180) / Math.PI
      if (ang > 90 || ang < -90) ang += 180
      parts.push(
        `<text x="${num(mx)}" y="${num(my)}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${num(ang)} ${num(mx)} ${num(my)})" font-size="${num(fs * 0.75)}" fill="${verified ? VERIFIED : '#475569'}" font-weight="${verified ? 700 : 400}" paint-order="stroke" stroke="#fff" stroke-width="${num(fs * 0.25)}" stroke-linejoin="round" data-dim="${esc(id)}">${esc(id)}  ${fmtCm(val)}</text>`,
      )
    }
  }

  // Room labels
  for (const r of doc.rooms) {
    const c = labelPoint([r.vertices, ...(r.holes ?? [])])
    parts.push(
      `<text x="${num(c.x)}" y="${num(c.y)}" text-anchor="middle" fill="#0f172a" font-size="${num(fs)}"><tspan x="${num(c.x)}" font-weight="700">${esc(r.name)}</tspan><tspan x="${num(c.x)}" dy="${num(fs * 1.15)}" font-size="${num(fs * 0.85)}" fill="#475569">${roomAreaM2(r).toFixed(2).replace('.', ',')} m²</tspan></text>`,
    )
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x0)} ${num(y0)} ${num(W)} ${num(H)}" width="${num(W)}" height="${num(H)}">${style}${defs}<rect x="${num(x0)}" y="${num(y0)}" width="${num(W)}" height="${num(H)}" fill="#fff"/>${parts.join('')}${bar.join('')}${leg.join('')}</svg>`
  return { svg, width: W, height: H, fontSize: fs }
}
