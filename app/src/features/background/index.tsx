// OWNER: background agent. Contract: keep these export names and signatures.
import { useEffect, useRef, useState } from 'react'
import { Crosshair, Eye, EyeOff, ImagePlus, Lock, LockOpen, Trash2 } from 'lucide-react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { beginDrag, endDrag, useDoc, useUi } from '../../model/store'
import { dist, fmtCm } from '../../model/geometry'
import type { PlanDoc, Vec } from '../../model/types'
import { calibrateScale, imageSizeCm } from './calibrate'

/** Draws the background image in world space (inside the Viewport <g>). */
export function BackgroundLayer() {
  const bg = useDoc((s) => s.doc.background)
  const tool = useUi((s) => s.tool)
  const { toWorld } = useViewport()
  const drag = useRef<{ start: PlanDoc; px0: number; py0: number; x0: number; y0: number } | null>(null)

  if (!bg || !bg.visible) return null
  const { w, h } = imageSizeCm(bg)
  const cx = bg.xCm + w / 2
  const cy = bg.yCm + h / 2
  const draggable = !bg.locked && tool === 'select'

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

/** Sidebar panel: import, opacity, visibility, lock, rotation, calibration button. */
export function BackgroundPanel() {
  const bg = useDoc((s) => s.doc.background)
  const update = useDoc((s) => s.update)
  const updateSilent = useDoc((s) => s.updateSilent)
  const setTool = useUi((s) => s.setTool)
  const fileRef = useRef<HTMLInputElement>(null)
  const sliderDrag = useRef<PlanDoc | null>(null)

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new Image()
      img.onload = () => {
        update((d) => ({
          ...d,
          background: {
            src,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
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

  const label = 'flex items-center gap-2'
  const row = 'flex h-9 items-center gap-2'
  const inputCls =
    'h-9 w-full rounded-md border border-black/10 bg-transparent px-2 text-sm dark:border-white/10'

  return (
    <section className="rounded-lg border border-black/10 p-2 text-sm dark:border-white/10">
      <div className="flex h-9 items-center gap-2 font-semibold">
        <ImagePlus size={16} /> Background
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFile}
      />
      {!bg ? (
        <button
          className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-2 text-sm text-white hover:bg-orange-700"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={16} /> Import image (PNG / JPG / WebP)
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="text-xs opacity-70">
            Scale: 1 px = {bg.cmPerPx.toFixed(3)} cm · {(100 / bg.cmPerPx).toFixed(1)} px/m
          </div>

          <div>
            <div className="flex justify-between"><span>Opacity</span><span>{Math.round(bg.opacity * 100)}%</span></div>
            <input
              type="range"
              min={10}
              max={80}
              step={1}
              value={Math.round(bg.opacity * 100)}
              className="h-9 w-full accent-orange-600"
              {...sliderHandlers}
              onChange={(e) => {
                const v = Number(e.target.value) / 100
                updateSilent((d) => (d.background ? { ...d, background: { ...d.background, opacity: v } } : d))
              }}
            />
          </div>

          <div className={row}>
            <label className={`${label} flex-1 cursor-pointer`}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange-600"
                checked={bg.visible}
                onChange={(e) => update((d) => (d.background ? { ...d, background: { ...d.background, visible: e.target.checked } } : d))}
              />
              {bg.visible ? <Eye size={16} /> : <EyeOff size={16} />} Visible
            </label>
            <label className={`${label} flex-1 cursor-pointer`}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange-600"
                checked={bg.locked}
                onChange={(e) => update((d) => (d.background ? { ...d, background: { ...d.background, locked: e.target.checked } } : d))}
              />
              {bg.locked ? <Lock size={16} /> : <LockOpen size={16} />} {bg.locked ? 'Locked' : 'Unlocked'}
            </label>
          </div>

          <div>
            <div className="flex justify-between"><span>Rotation</span><span>{bg.rotationDeg.toFixed(1)}°</span></div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={-10}
                max={10}
                step={0.1}
                value={bg.rotationDeg}
                className="h-9 w-full accent-orange-600"
                {...sliderHandlers}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  updateSilent((d) => (d.background ? { ...d, background: { ...d.background, rotationDeg: v } } : d))
                }}
              />
              <input
                type="number"
                min={-10}
                max={10}
                step={0.1}
                value={bg.rotationDeg}
                className={`${inputCls} w-20`}
                onChange={(e) => {
                  const v = Math.max(-10, Math.min(10, Number(e.target.value) || 0))
                  update((d) => (d.background ? { ...d, background: { ...d.background, rotationDeg: v } } : d))
                }}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-orange-600 px-2 text-sm text-white hover:bg-orange-700"
              onClick={() => setTool('calibrate')}
            >
              <Crosshair size={16} /> Calibrate scale
            </button>
            <button
              className="flex h-9 items-center justify-center gap-1 rounded-md border border-black/10 px-2 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
              title="Remove image"
              onClick={() => update((d) => ({ ...d, background: undefined }))}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <button
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-black/10 px-2 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={16} /> Replace image
          </button>
        </div>
      )}
    </section>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPts([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onPoint = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = toWorld(e.clientX, e.clientY)
    setPts((prev) => (prev.length >= 2 ? [p] : [...prev, p]))
  }

  const confirm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!bg || pts.length !== 2) return
    const v = parseFloat(len)
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
    'h-9 w-full rounded-md border border-black/10 bg-transparent px-2 text-sm dark:border-white/10'

  return (
    <>
      <CaptureRect fill="transparent" onPointerDown={onPoint} style={{ cursor: 'crosshair' }} />
      {!bg && (
        <text x={px(20)} y={px(-20)} fontSize={px(14)} fill="currentColor">
          Import a background image first (sidebar → Background).
        </text>
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
            fill="#ea580c"
            style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: px(3) }}
          >
            {fmtCm(d)} cm
          </text>
          <foreignObject x={pts[1].x + px(12)} y={pts[1].y + px(12)} width={px(240)} height={px(180)}>
            <form
              onSubmit={confirm}
              className="flex flex-col gap-2 rounded-lg border border-black/10 bg-white p-3 text-sm shadow-lg dark:border-white/10 dark:bg-[#1b2128]"
            >
              <div className="font-semibold">Calibrate scale</div>
              <div className="text-xs opacity-70">Measured on image: {fmtCm(d)} cm</div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="any"
                  required
                  autoFocus
                  value={len}
                  onChange={(e) => setLen(e.target.value)}
                  placeholder="Real length"
                  className={inputCls}
                />
                <select value={unit} onChange={(e) => setUnit(e.target.value as 'cm' | 'm')} className={`${inputCls} w-20`}>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="h-9 flex-1 rounded-md bg-orange-600 text-white hover:bg-orange-700">
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
            </form>
          </foreignObject>
        </g>
      )}
      {bg && pts.length < 2 && (
        <text x={px(20)} y={px(-20)} fontSize={px(14)} fill="currentColor">
          {pts.length === 0 ? 'Click point A on a known length (wall, scale bar)…' : 'Click point B…'}
        </text>
      )}
    </>
  )
}
