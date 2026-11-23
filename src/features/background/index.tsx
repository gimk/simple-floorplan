// OWNER: background agent. Contract: keep these export names and signatures.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crosshair, ImagePlus, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { beginDrag, endDrag, useDoc, useUi } from '../../model/store'
import { dist, fmtCm } from '../../model/geometry'
import type { PlanDoc, Vec } from '../../model/types'
import { BTN, EmptyHint, FieldRow, IconButton, NumberField, SelectField, SwitchRow } from '../../shell/panel'
import { undoToast } from '../toast'
import { calibrateScale, imageSizeCm } from './calibrate'
import { pdfPageCount, renderPdfPage } from './pdf'
import { normalizeDeg, parseCommaNumber, rotateBy } from './rotate'

/** Draws the background image in world space (inside the Viewport <g>). */
export function BackgroundLayer() {
  const bg = useDoc((s) => s.doc.background)
  const tool = useUi((s) => s.tool)
  const mode = useUi((s) => s.mode)
  const { toWorld } = useViewport()
  const drag = useRef<{ start: PlanDoc; px0: number; py0: number; x0: number; y0: number } | null>(null)

  if (!bg || !bg.visible) return null
  const { w, h } = imageSizeCm(bg)
  const cx = bg.xCm + w / 2
  const cy = bg.yCm + h / 2
  const draggable = !bg.locked && tool === 'select' && mode === 'edit'

  return (
    <image
      href={bg.src}
      x={bg.xCm}
      y={bg.yCm}
      width={w}
      height={h}
      opacity={bg.opacity}
      transform={`rotate(${bg.rotationDeg} ${cx} ${cy})`}
      style={{ pointerEvents: draggable ? 'auto' : 'none', cursor: draggable ? 'move' : undefined }}
      onPointerDown={
        draggable
          ? (e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              const p = toWorld(e.clientX, e.clientY)
              drag.current = { start: beginDrag(), px0: p.x, py0: p.y, x0: bg.xCm, y0: bg.yCm }
              ;(e.target as SVGImageElement).setPointerCapture(e.pointerId)
            }
          : undefined
      }
      onPointerMove={
        draggable
          ? (e) => {
              const d = drag.current
              if (!d) return
              const p = toWorld(e.clientX, e.clientY)
              useDoc.getState().updateSilent((doc) =>
                doc.background
                  ? { ...doc, background: { ...doc.background, xCm: d.x0 + p.x - d.px0, yCm: d.y0 + p.y - d.py0 } }
                  : doc,
              )
            }
          : undefined
      }
      onPointerUp={
        draggable
          ? () => {
              if (drag.current) endDrag(drag.current.start)
              drag.current = null
            }
          : undefined
      }
      onPointerCancel={draggable ? () => { drag.current = null } : undefined}
    />
  )
}

/** Sidebar content: import, opacity, rotation, calibration, visibility and lock.
 *  It draws no border and no heading of its own: the sidebar wraps it in a
 *  PanelSection (docs/sidebar-plan.md §4). */
export function BackgroundPanel() {
  const bg = useDoc((s) => s.doc.background)
  const update = useDoc((s) => s.update)
  const updateSilent = useDoc((s) => s.updateSilent)
  const setTool = useUi((s) => s.setTool)
  const fileRef = useRef<HTMLInputElement>(null)
  const sliderDrag = useRef<PlanDoc | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pdfPick, setPdfPick] = useState<{ file: File; name: string; numPages: number; page: number } | null>(null)

  const applyBackground = (src: string, width: number, height: number) => {
    update((d) => ({
      ...d,
      background: {
        src,
        naturalWidth: width,
        naturalHeight: height,
        xCm: 0,
        yCm: 0,
        cmPerPx: 1,
        rotationDeg: 0,
        opacity: 0.5,
        visible: true,
        locked: false,
      },
    }))
  }

  const renderPdf = async (f: File, page: number) => {
    setBusy(true)
    setError('')
    try {
      const r = await renderPdfPage(f, page)
      applyBackground(r.dataUrl, r.width, r.height)
      setPdfPick(null)
    } catch (err) {
      setError(`Could not render PDF: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      void (async () => {
        setBusy(true)
        try {
          const numPages = await pdfPageCount(f)
          if (numPages > 1) {
            setPdfPick({ file: f, name: f.name, numPages, page: 1 })
          } else {
            await renderPdf(f, 1)
          }
        } catch (err) {
          setError(`Could not read PDF: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setBusy(false)
        }
      })()
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new Image()
      img.onload = () => applyBackground(src, img.naturalWidth, img.naturalHeight)
      img.src = src
    }
    reader.readAsDataURL(f)
  }

  // Sliders: silent updates while dragging, one undo step on release.
  const beginSlider = () => { sliderDrag.current = beginDrag() }
  const endSlider = () => { if (sliderDrag.current) { endDrag(sliderDrag.current); sliderDrag.current = null } }
  const sliderHandlers = {
    onPointerDown: beginSlider,
    onPointerUp: endSlider,
    onKeyDown: beginSlider,
    onKeyUp: endSlider,
  }

  const setBg = (patch: Partial<NonNullable<PlanDoc['background']>>) =>
    update((d) => (d.background ? { ...d, background: { ...d.background, ...patch } } : d))

  // Same metrics as BTN, without the border, for the two primary actions.
  const primary =
    'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-orange-700 px-3 text-sm text-white hover:bg-orange-800 disabled:opacity-50 pointer-coarse:min-h-11'

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileRef}
        name="bgFile"
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        aria-label="Import background image or PDF"
        className="hidden"
        onChange={onFile}
      />
      {busy && (
        <div role="status" className="flex min-h-9 items-center justify-center gap-2 rounded-md bg-black/5 text-xs dark:bg-white/10">
          Rendering PDF…
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-900/40 dark:text-red-200">
          {error}
        </p>
      )}
      {pdfPick && (
        <div className="flex items-center gap-2 rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
          <span className="min-w-0 flex-1 truncate text-xs" title={pdfPick.name}>
            {pdfPick.name} · {pdfPick.numPages} pages
          </span>
          <div className="w-24 shrink-0">
            <SelectField
              name="pdfPage"
              ariaLabel="PDF page"
              value={String(pdfPick.page)}
              options={Array.from({ length: pdfPick.numPages }, (_, i) => ({ value: String(i + 1), label: `Page ${i + 1}` }))}
              onChange={(v) => setPdfPick({ ...pdfPick, page: Number(v) })}
            />
          </div>
          <button type="button" className={BTN} onClick={() => pdfPick && void renderPdf(pdfPick.file, pdfPick.page)}>
            Render
          </button>
          <button type="button" className={BTN} onClick={() => setPdfPick(null)}>
            Cancel
          </button>
        </div>
      )}
      {!bg ? (
        <button data-action="import-background" className={`${primary} w-full`} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={16} /> Import image or PDF
        </button>
      ) : (
        <>
          <EmptyHint>
            Scale: 1 px = {bg.cmPerPx.toFixed(3).replace('.', ',')} cm · {(100 / bg.cmPerPx).toFixed(1).replace('.', ',')} px/m
          </EmptyHint>

          <FieldRow label="Opacity" htmlFor="bg-opacity" hint={`${Math.round(bg.opacity * 100)} %`}>
            <input
              id="bg-opacity"
              type="range"
              name="bgOpacity"
              aria-label="Background opacity"
              min={10}
              max={80}
              step={1}
              value={Math.round(bg.opacity * 100)}
              className="h-9 w-full accent-orange-700"
              {...sliderHandlers}
              onChange={(e) => {
                const v = Number(e.target.value) / 100
                updateSilent((d) => (d.background ? { ...d, background: { ...d.background, opacity: v } } : d))
              }}
            />
          </FieldRow>

          <div className="flex flex-col gap-0.5">
            <SwitchRow name="bgVisible" label="Visible" checked={bg.visible} onChange={(checked) => setBg({ visible: checked })} />
            <SwitchRow
              name="bgLocked"
              label={bg.locked ? 'Locked' : 'Unlocked'}
              checked={bg.locked}
              onChange={(checked) => setBg({ locked: checked })}
            />
          </div>

          <FieldRow label="Rotation" htmlFor="bg-rotation">
            <div className="flex flex-col gap-1">
              <input
                type="range"
                name="bgRotationSlider"
                min={-180}
                max={180}
                step={0.1}
                value={bg.rotationDeg}
                aria-label="Rotation in degrees"
                className="h-9 w-full accent-orange-700"
                {...sliderHandlers}
                onChange={(e) => {
                  const v = normalizeDeg(Number(e.target.value))
                  updateSilent((d) => (d.background ? { ...d, background: { ...d.background, rotationDeg: v } } : d))
                }}
              />
              <div className="flex items-center gap-1">
                <div className="w-20 shrink-0">
                  <NumberField
                    id="bg-rotation"
                    name="bgRotation"
                    ariaLabel="Rotation value in degrees"
                    unit="°"
                    value={bg.rotationDeg}
                    onCommit={(v) => {
                      if (v === null) return false
                      const next = normalizeDeg(v)
                      if (next === bg.rotationDeg) return
                      setBg({ rotationDeg: next })
                    }}
                  />
                </div>
                <IconButton
                  label="Rotate -90 degrees"
                  icon={<RotateCcw size={16} />}
                  onClick={() => setBg({ rotationDeg: rotateBy(bg.rotationDeg, -90) })}
                />
                <IconButton
                  label="Rotate +90 degrees"
                  icon={<RotateCw size={16} />}
                  onClick={() => setBg({ rotationDeg: rotateBy(bg.rotationDeg, 90) })}
                />
              </div>
            </div>
          </FieldRow>

          <div className="flex gap-1">
            <button type="button" className={`${primary} flex-1`} onClick={() => setTool('calibrate')}>
              <Crosshair size={16} /> Calibrate scale
            </button>
            <IconButton
              variant="danger"
              label="Remove background image"
              icon={<Trash2 size={16} />}
              onClick={() => {
                update((d) => ({ ...d, background: undefined }))
                undoToast('Background image deleted', () => useDoc.temporal.getState().undo())
              }}
            />
          </div>
          <button data-action="import-background" className={`${BTN} w-full`} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={16} /> Replace image / PDF
          </button>
        </>
      )}
    </div>
  )
}

/** Tool overlay for ui.tool === 'calibrate' (2-point scale calibration). */
export function CalibrateTool() {
  const bg = useDoc((s) => s.doc.background)
  const update = useDoc((s) => s.update)
  const setTool = useUi((s) => s.setTool)
  const { toWorld, px } = useViewport()
  const [pts, setPts] = useState<Vec[]>([])
  const [len, setLen] = useState('')
  const [unit, setUnit] = useState<'cm' | 'm'>('m')

  // Capture phase (7.2 #13): with in-progress points, Escape cancels the points and
  // preventDefault/stopPropagation so the shell keeps the calibrate tool active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (pts.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        setPts([])
        setLen('')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pts.length])

  const onPoint = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = toWorld(e.clientX, e.clientY)
    setPts((prev) => (prev.length >= 2 ? [p] : [...prev, p]))
  }

  const confirm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!bg || pts.length !== 2) return
    const v = parseCommaNumber(len) // comma decimals accepted, e.g. "4,25" m (7.2 #12)
    if (!Number.isFinite(v) || v <= 0) return
    const realCm = unit === 'm' ? v * 100 : v
    const r = calibrateScale(bg, pts[0], pts[1], realCm)
    update((d) => (d.background ? { ...d, background: { ...d.background, ...r } } : d))
    setPts([])
    setLen('')
    setTool('select')
  }

  const d = pts.length === 2 ? dist(pts[0], pts[1]) : 0
  const inputCls =
    'h-9 w-full rounded-md border border-black/10 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#12161b]'
  const bannerText = !bg
    ? 'Import a background image first (sidebar → Background).'
    : pts.length === 0
      ? 'Click point A on a known length (wall, scale bar)…'
      : pts.length === 1
        ? 'Click point B…'
        : null

  return (
    <>
      <CaptureRect fill="transparent" onPointerDown={onPoint} style={{ cursor: 'crosshair' }} />
      {/* Instructions in a fixed screen-space banner (7.2 #4): they must stay visible
          when panned away, so they are NOT drawn in world coordinates. */}
      {bannerText &&
        createPortal(
          <div
            role="status"
            className="fixed left-1/2 top-14 z-40 max-w-[95vw] -translate-x-1/2 rounded-lg border border-black/10 bg-white/95 px-4 py-2 text-center text-sm shadow-lg backdrop-blur dark:border-white/15 dark:bg-[#1b2128]/95"
          >
            {bannerText}
          </div>,
          document.body,
        )}
      {pts.length >= 1 && (
        <circle cx={pts[0].x} cy={pts[0].y} r={px(6)} fill="#ea580c" stroke="#fff" strokeWidth={px(2)} />
      )}
      {pts.length === 2 && (
        <g>
          <line
            x1={pts[0].x}
            y1={pts[0].y}
            x2={pts[1].x}
            y2={pts[1].y}
            stroke="#ea580c"
            strokeWidth={px(2)}
            strokeDasharray={`${px(6)} ${px(4)}`}
          />
          <circle cx={pts[1].x} cy={pts[1].y} r={px(6)} fill="#ea580c" stroke="#fff" strokeWidth={px(2)} />
          <text
            x={(pts[0].x + pts[1].x) / 2}
            y={(pts[0].y + pts[1].y) / 2 - px(8)}
            fontSize={px(13)}
            textAnchor="middle"
            className="fill-orange-600 stroke-white dark:stroke-[#12161b]"
            style={{ paintOrder: 'stroke', strokeWidth: px(3) }}
          >
            {fmtCm(d)} cm
          </text>
        </g>
      )}
      {pts.length === 2 &&
        createPortal(
          <form
            onSubmit={confirm}
            className="fixed bottom-4 left-1/2 z-40 flex w-[300px] max-w-[95vw] -translate-x-1/2 flex-col gap-2 rounded-lg border border-black/10 bg-white p-3 text-sm shadow-lg dark:border-white/10 dark:bg-[#1b2128]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="font-semibold">Calibrate scale</div>
            <div className="text-xs opacity-70">Measured on image: {fmtCm(d)} cm</div>
            <div className="flex gap-2">
              <input
                type="text"
                name="calibrateLength"
                inputMode="decimal"
                aria-label="Real length"
                required
                autoFocus
                value={len}
                onChange={(e) => setLen(e.target.value)}
                placeholder="Real length (e.g. 4,25)"
                className={inputCls}
              />
              <select name="calibrateUnit" aria-label="Length unit" value={unit} onChange={(e) => setUnit(e.target.value as 'cm' | 'm')} className={`${inputCls} w-20`}>
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="h-9 flex-1 rounded-md bg-orange-700 text-white hover:bg-orange-800">
                Apply
              </button>
              <button
                type="button"
                onClick={() => setPts([])}
                className="h-9 rounded-md border border-black/10 px-3 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </form>,
          document.body,
        )}
    </>
  )
}
