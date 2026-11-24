import { useState } from 'react'
import { Calculator, Copy, Download } from 'lucide-react'
import { planToDxf } from '../../core/dxf'
import { useDoc, useUi } from '../../model/store'
import {
  BTN,
  CheckboxRow,
  EmptyHint,
  ERROR,
  FieldRow,
  formatDecimal,
  NumberField,
  PanelSection,
} from '../../shell/panel'
import { calcAll, calcCsvRows, DEFAULT_INPUTS, type CalcInputs } from './calc'
import { download, slug, toCsv } from './csv'
import { surveyCsv } from './surveyExport'
import { buildPlanSvg, svgToCanvas, toDataUrl } from './svgExport'

/** Export section: one button per format. The Sidebar only mounts it. */
export function ExportPanel() {
  const doc = useDoc((s) => s.doc)
  const [withBg, setWithBg] = useState(false)
  const [a3, setA3] = useState(false)
  // Measurements of the export: the settings of the View menu, plus these two options.
  const [outsideDims, setOutsideDims] = useState(true)
  const [surveyLabels, setSurveyLabels] = useState(true)
  const [schedule, setSchedule] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const hasBg = !!doc.background?.visible
  const bgHidden = !!doc.background && !doc.background.visible
  const name = slug(doc.title)

  const run = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label); setErr(null)
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  /**
   * The options of the plan image: the background, and the measurements exactly as the plan writes
   * them (wall length style, room tag rows, units, outside chains) plus the two options here.
   */
  const opts = async () => {
    const ui = useUi.getState()
    const bg = doc.background
    const on = withBg && !!bg?.visible
    return {
      background: on,
      backgroundHref: on && bg ? await toDataUrl(bg.src) : undefined,
      dimStyle: ui.dimStyle,
      roomTag: ui.roomTag,
      units: ui.canvasUnits,
      // Outside chains need stored walls (a v2 document) and the layer of the plan.
      outside: outsideDims && ui.layers.outsideDims,
      surveyLabels,
      schedule,
    }
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
    <PanelSection id="export" title="Export" icon={<Download size={16} />} collapsible defaultOpen={false}>
      <CheckboxRow
        name="exportWithBg"
        label={`Include background image${bgHidden ? ' (hidden)' : ''}`}
        checked={withBg && hasBg}
        disabled={!hasBg}
        onChange={setWithBg}
      />
      <CheckboxRow name="exportA3" label="PDF size A3 (default A4)" checked={a3} onChange={setA3} />
      <CheckboxRow name="exportOutsideDims" label="Outside dimensions (v2 plans)" checked={outsideDims} onChange={setOutsideDims} />
      <CheckboxRow name="exportSurveyLabels" label="Show survey labels" checked={surveyLabels} onChange={setSurveyLabels} />
      <CheckboxRow name="exportSchedule" label="Room schedule" checked={schedule} onChange={setSchedule} />
      <div className="grid grid-cols-4 gap-1">
        <button type="button" className={BTN} disabled={!!busy} onClick={svg}>SVG</button>
        <button type="button" className={BTN} disabled={!!busy} onClick={png}>PNG</button>
        <button type="button" className={BTN} disabled={!!busy} onClick={pdf}>PDF</button>
        <button type="button" className={BTN} disabled={!!busy} onClick={dxf}>DXF</button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button type="button" className={BTN} disabled={!!busy} onClick={csv}>Survey CSV</button>
        <button type="button" className={BTN} disabled={!!busy} onClick={spdf}>Survey PDF</button>
      </div>
      {busy && <EmptyHint>Exporting…</EmptyHint>}
      {err && (
        <p role="alert" className={ERROR}>
          {err}
        </p>
      )}
    </PanelSection>
  )
}

const fx = (v: number | null, d = 2) => (v === null ? '–' : formatDecimal(v, d))

/**
 * Calculator section. Its three inputs are the only local state: they are not stored
 * in the document, so a refresh restores the defaults, as before.
 */
export function CalculatorsPanel() {
  const doc = useDoc((s) => s.doc)
  const [inp, setInp] = useState<CalcInputs>(DEFAULT_INPUTS)
  const [copied, setCopied] = useState(false)
  const [copyErr, setCopyErr] = useState('')
  const { rows, totals } = calcAll(doc, inp)

  /** Commits one input: a cleared field falls back to 0, like the old text input did. */
  const commit = (key: keyof CalcInputs) => (v: number | null) => {
    if (v === null) {
      setInp((s) => ({ ...s, [key]: 0 }))
      return
    }
    if (v < 0) return false
    if (key === 'wastePct' && v > 100) return false
    setInp((s) => ({ ...s, [key]: v }))
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
    <PanelSection id="calculators" title="Calculators" icon={<Calculator size={16} />} collapsible defaultOpen={false}>
      <FieldRow label="Waste" htmlFor="calc-waste">
        <NumberField
          id="calc-waste"
          name="wastePct"
          ariaLabel="Waste percent"
          unit="%"
          min={0}
          max={100}
          value={inp.wastePct}
          onCommit={commit('wastePct')}
        />
      </FieldRow>
      <FieldRow label="Coats" htmlFor="calc-coats">
        <NumberField id="calc-coats" name="coats" ariaLabel="Coats of paint" min={0} value={inp.coats} onCommit={commit('coats')} />
      </FieldRow>
      <FieldRow label="Coverage" htmlFor="calc-coverage">
        <NumberField
          id="calc-coverage"
          name="coverage"
          ariaLabel="Paint coverage in square meters per litre"
          unit="m²/L"
          min={0}
          value={inp.coverage}
          onCommit={commit('coverage')}
        />
      </FieldRow>
      {rows.length === 0 ? <EmptyHint>No rooms yet.</EmptyHint> : (
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
      {totals.missingCeiling > 0 && (
        <p className="text-xs text-orange-700 dark:text-orange-400">
          {totals.missingCeiling} room(s) without ceiling height: not in wall/paint totals.
        </p>
      )}
      <EmptyHint className="opacity-80">
        Units: m², m, litres. Outdoor rooms excluded. Verified lengths are used when present.
      </EmptyHint>
      <button type="button" className={`${BTN} w-full`} onClick={copy}>
        <Copy size={14} /> {copied ? 'Copied' : 'Copy as CSV'}
      </button>
      {copyErr && (
        <p role="alert" className={ERROR}>
          {copyErr}
        </p>
      )}
    </PanelSection>
  )
}
