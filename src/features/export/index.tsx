import { useState } from 'react'
import { Calculator, Copy, Download } from 'lucide-react'
import { planToDxf } from '../../core/dxf'
import { useDoc } from '../../model/store'
import { calcAll, calcCsvRows, DEFAULT_INPUTS, type CalcInputs } from './calc'
import { download, slug, toCsv } from './csv'
import { surveyCsv } from './surveyExport'
import { buildPlanSvg, svgToCanvas, toDataUrl } from './svgExport'

const btn = 'flex h-9 items-center justify-center gap-1 rounded-md border border-black/10 px-2 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10'
const box = 'rounded-lg border border-black/10 p-2 text-sm dark:border-white/10'
const field = 'h-9 w-full rounded-md border border-black/15 bg-white px-2 text-sm dark:border-white/20 dark:bg-[#12161b]'

export function ExportPanel() {
  const doc = useDoc((s) => s.doc)
  const [withBg, setWithBg] = useState(false)
  const [a3, setA3] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const hasBg = !!doc.background?.visible
  const bgHidden = !!doc.background && !doc.background.visible
  const name = slug(doc.title)

  const run = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label); setErr(null)
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const opts = async () => {
    const bg = doc.background
    const on = withBg && !!bg?.visible
    return { background: on, backgroundHref: on && bg ? await toDataUrl(bg.src) : undefined }
  }

  const svg = run('svg', async () => download(`${name}.svg`, new Blob([buildPlanSvg(doc, await opts()).svg], { type: 'image/svg+xml' })))
  const png = run('png', async () => {
    const r = buildPlanSvg(doc, await opts())
    // 2x: one cm = 2 px at base, capped to keep canvases small enough for browsers.
    const k = Math.min(2, 8000 / Math.max(r.width, r.height))
    const c = await svgToCanvas(r.svg, r.width * k, r.height * k)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    if (!blob) throw new Error('PNG export failed')
    download(`${name}.png`, blob)
  })
  const pdf = run('pdf', async () => {
    const { exportPlanPdf } = await import('./pdfExport')
    download(`${name}.pdf`, await exportPlanPdf(doc, { ...(await opts()), size: a3 ? 'a3' : 'a4' }))
  })
  const dxf = run('dxf', async () => download(`${name}.dxf`, new Blob([planToDxf(doc)], { type: 'application/dxf' })))
  const csv = run('csv', async () => download(`${name}-survey.csv`, new Blob(['﻿' + surveyCsv(doc)], { type: 'text/csv;charset=utf-8' })))
  const spdf = run('spdf', async () => {
    const { exportSurveyPdf } = await import('./pdfExport')
    download(`${name}-survey.pdf`, await exportSurveyPdf(doc, a3 ? 'a3' : 'a4'))
  })

  return (
    <details className={box}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Download size={16} /> Export</summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className={`flex cursor-pointer items-center gap-2 ${hasBg ? '' : 'opacity-50'}`}>
          <input type="checkbox" name="exportWithBg" className="h-4 w-4 cursor-pointer accent-orange-700" disabled={!hasBg} checked={withBg && hasBg} onChange={(e) => setWithBg(e.target.checked)} />
          Include background image{bgHidden ? ' (hidden)' : ''}
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" name="exportA3" className="h-4 w-4 cursor-pointer accent-orange-700" checked={a3} onChange={(e) => setA3(e.target.checked)} /> PDF size A3 (default A4)
        </label>
        <div className="grid grid-cols-4 gap-1">
          <button className={btn} disabled={!!busy} onClick={svg}>SVG</button>
          <button className={btn} disabled={!!busy} onClick={png}>PNG</button>
          <button className={btn} disabled={!!busy} onClick={pdf}>PDF</button>
          <button className={btn} disabled={!!busy} onClick={dxf}>DXF</button>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button className={btn} disabled={!!busy} onClick={csv}>Survey CSV</button>
          <button className={btn} disabled={!!busy} onClick={spdf}>Survey PDF</button>
        </div>
        {busy && <p className="text-xs opacity-70">Exporting…</p>}
        {err && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      </div>
    </details>
  )
}

const fx = (v: number | null, d = 2) => (v === null ? '–' : v.toFixed(d).replace('.', ','))
const fmtInp = (v: number) => String(v).replace('.', ',')

export function CalculatorsPanel() {
  const doc = useDoc((s) => s.doc)
  const [inp, setInp] = useState<CalcInputs>(DEFAULT_INPUTS)
  const [drafts, setDrafts] = useState<Record<keyof CalcInputs, string>>({
    wastePct: fmtInp(DEFAULT_INPUTS.wastePct),
    coats: fmtInp(DEFAULT_INPUTS.coats),
    coverage: fmtInp(DEFAULT_INPUTS.coverage),
  })
  const [copied, setCopied] = useState(false)
  const [copyErr, setCopyErr] = useState('')
  const { rows, totals } = calcAll(doc, inp)
  const set = (k: keyof CalcInputs) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setDrafts((d) => ({ ...d, [k]: raw }))
    const v = parseFloat(raw.replace(',', '.'))
    setInp((s) => ({ ...s, [k]: Number.isFinite(v) && v >= 0 ? v : 0 }))
  }
  const copy = async () => {
    setCopyErr('')
    try {
      await navigator.clipboard.writeText(toCsv(calcCsvRows(rows, totals)))
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyErr('Clipboard blocked by browser')
    }
  }
  const th = 'px-1 py-1 text-right font-medium'
  const td = 'px-1 py-1 text-right tabular-nums'

  return (
    <details className={box}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Calculator size={16} /> Calculators</summary>
      <div className="mt-2 flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-1 text-xs">
          <label className="flex flex-col gap-1">Waste %<input name="wastePct" className={field} inputMode="decimal" value={drafts.wastePct} onChange={set('wastePct')} /></label>
          <label className="flex flex-col gap-1">Coats<input name="coats" className={field} inputMode="decimal" value={drafts.coats} onChange={set('coats')} /></label>
          <label className="flex flex-col gap-1">m²/L<input name="coverage" className={field} inputMode="decimal" value={drafts.coverage} onChange={set('coverage')} /></label>
        </div>
        {rows.length === 0 ? <p className="text-xs opacity-70">No rooms yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-black/10 dark:border-white/10">
                <th className="px-1 py-1 text-left font-medium">Room</th>
                <th className={th} title="Floor area m²">Floor</th>
                <th className={th} title="Flooring m² with waste">Fl.+w</th>
                <th className={th} title="Baseboard m">Base</th>
                <th className={th} title="Wall surface m²">Wall</th>
                <th className={th} title="Paint litres">Paint</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.roomId} className="border-b border-black/5 dark:border-white/5">
                    <td className="max-w-20 truncate px-1 py-1" title={r.name}>{r.name}</td>
                    <td className={td}>{fx(r.floorM2)}</td>
                    <td className={td}>{fx(r.flooringM2)}</td>
                    <td className={td}>{fx(r.baseboardM)}</td>
                    {r.wallM2 === null
                      ? <td className="px-1 py-1 text-right text-orange-700 dark:text-orange-400" colSpan={2}>set ceiling height</td>
                      : <><td className={td}>{fx(r.wallM2)}</td><td className={td}>{fx(r.paintL)}</td></>}
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="px-1 py-1">Total</td>
                  <td className={td}>{fx(totals.floorM2)}</td>
                  <td className={td}>{fx(totals.flooringM2)}</td>
                  <td className={td}>{fx(totals.baseboardM)}</td>
                  <td className={td}>{fx(totals.wallM2)}</td>
                  <td className={td}>{fx(totals.paintL)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {totals.missingCeiling > 0 && <p className="text-xs text-orange-700 dark:text-orange-400">{totals.missingCeiling} room(s) without ceiling height: not in wall/paint totals.</p>}
        <p className="text-xs opacity-60">Units: m², m, litres. Outdoor rooms excluded. Verified lengths are used when present.</p>
        <button className={btn} onClick={copy}><Copy size={14} /> {copied ? 'Copied' : 'Copy as CSV'}</button>
        {copyErr && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{copyErr}</p>}
      </div>
    </details>
  )
}
