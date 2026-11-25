// PDF output with jsPDF (lazy-loaded). Plan page is a raster of the clean SVG; tables are real text.
import { roomAreaM2 } from '../../model/geometry'
import type { PlanDoc } from '../../model/types'
import { effectiveCeilingCm, effectiveWallLengths } from './calc'
import { itemRows, surveyRows } from './surveyExport'
import { scheduleRows } from '../schedule/rows'
import { buildPlanSvg, fitStandardScale, svgToCanvas, type SvgOptions } from './svgExport'

export type PageSize = 'a4' | 'a3'
const PAGE_MM: Record<PageSize, [number, number]> = { a4: [297, 210], a3: [420, 297] }

const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ','))

type Pdf = import('jspdf').jsPDF
const newPdf = async (size: PageSize): Promise<Pdf> => {
  const { jsPDF } = await import('jspdf')
  return new jsPDF({ orientation: 'landscape', unit: 'mm', format: size })
}

/** Simple text table with header repeat and page breaks. Returns the next free y. */
function table(pdf: Pdf, y: number, head: string[], rows: string[][], widths: number[], pageH: number, margin = 12): number {
  const lh = 6
  const drawRow = (cells: string[], bold: boolean) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    let x = margin
    cells.forEach((c, i) => {
      const t = pdf.splitTextToSize(c, widths[i] - 2)[0] ?? ''
      pdf.text(t, x, y)
      x += widths[i]
    })
    y += lh
  }
  pdf.setFontSize(9)
  drawRow(head, true)
  pdf.setDrawColor(150); pdf.line(margin, y - lh + 1.5, margin + widths.reduce((a, b) => a + b, 0), y - lh + 1.5)
  for (const r of rows) {
    if (y > pageH - margin) { pdf.addPage(); y = margin + 4; drawRow(head, true) }
    drawRow(r, false)
  }
  return y
}

export async function exportPlanPdf(doc: PlanDoc, opts: SvgOptions & { size?: PageSize } = {}): Promise<Blob> {
  const size = opts.size ?? 'a4'
  const [pw, ph] = PAGE_MM[size]
  const pdf = await newPdf(size)
  const m = 10
  const { svg, width: wCm, height: hCm } = buildPlanSvg(doc, opts)
  const availW = pw - 2 * m, availH = ph - 2 * m - 6
  const std = fitStandardScale(wCm, hCm, availW, availH)
  const drawW = std ? (wCm * 10) / std : Math.min(availW, (availH * wCm) / hCm)
  const drawH = (drawW * hCm) / wCm
  const px = Math.min(5000, Math.round((drawW / 25.4) * 200))
  const canvas = await svgToCanvas(svg, px, (px * hCm) / wCm)
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pw - drawW) / 2, m, drawW, drawH)
  pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
  pdf.text(std ? `Scale 1:${std} (${size.toUpperCase()} landscape)` : 'Scale: see scale bar', m, ph - m + 2)

  // Page 2: room table. A built-in storage has its own row under its parent room, as in the
  // schedule (label "Storage (<parent name>)"): same rule, same order (docs/storage-plan.md).
  pdf.addPage()
  pdf.setFontSize(14); pdf.setFont('helvetica', 'bold'); pdf.text(`${doc.title || 'Floor plan'} - rooms`, m + 2, m + 6)
  const byId = new Map(doc.rooms.map((r) => [r.id, r]))
  const rows = scheduleRows(doc).rows.map((row) => {
    const r = byId.get(row.roomId)
    const per = r ? effectiveWallLengths(doc, r).reduce((a, b) => a + b, 0) / 100 : row.perimeterCm / 100
    const h = r ? effectiveCeilingCm(doc, r) : row.ceilingCm
    return [row.code, row.name, fmt(row.areaM2, 2), fmt(per, 2), h ? fmt(h, 0) : '']
  })
  const total = doc.rooms.filter((r) => !r.outdoor).reduce((s, r) => s + roomAreaM2(r), 0)
  rows.push(['', 'Total (indoor)', fmt(total, 2), '', ''])
  table(pdf, m + 16, ['Code', 'Name', 'Area m²', 'Perimeter m', 'Ceiling cm'], rows, [25, 90, 35, 40, 35], ph, m + 2)
  return pdf.output('blob')
}

export async function exportSurveyPdf(doc: PlanDoc, size: PageSize = 'a4'): Promise<Blob> {
  const [pw, ph] = PAGE_MM[size]
  const pdf = await newPdf(size)
  const m = 12
  let y = m + 4
  pdf.setFontSize(14); pdf.setFont('helvetica', 'bold'); pdf.text(`${doc.title || 'Floor plan'} - survey`, m, y)
  y += 10
  const sRows = surveyRows(doc), iRows = itemRows(doc)
  const codes = [...new Set(sRows.map((r) => r.roomCode))]
  for (const code of codes) {
    const rs = sRows.filter((r) => r.roomCode === code)
    const items = iRows.filter((r) => r.roomCode === code)
    const need = 14 + (rs.length + items.length + 3) * 6
    if (y + Math.min(need, 60) > ph - m) { pdf.addPage(); y = m + 4 }
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.text(`${code} - ${rs[0].roomName}`, m, y)
    y += 6
    y = table(pdf, y, ['ID', 'Kind', 'Planned cm', 'Measured cm', 'Diff cm', 'Status', 'Notes'],
      rs.map((r) => [r.id, r.kind, fmt(r.plannedCm), fmt(r.measuredCm), fmt(r.diffCm), r.status, r.notes]),
      [25, 25, 30, 32, 25, 28, pw - 2 * m - 165], ph, m)
    if (items.length) {
      y += 3
      y = table(pdf, y, ['Wall', 'Type', 'From start', 'Width', 'Height', 'Sill', 'Depth', 'Note'],
        items.map((r) => [r.wall, r.type, fmt(r.fromStartCm), fmt(r.widthCm), fmt(r.heightCm), fmt(r.sillCm), fmt(r.depthCm), r.note]),
        [25, 55, 25, 22, 22, 20, 20, pw - 2 * m - 189], ph, m)
    }
    y += 8
  }
  return pdf.output('blob')
}
