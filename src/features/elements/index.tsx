// OWNER: elements agent. Contract: keep these export names and signatures.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { create } from 'zustand'
import { beginDrag, endDrag, nowIso, uid, useDoc, useUi } from '../../model/store'
import { dot, fmtCm, sub, wallByStart } from '../../model/geometry'
import type { ElementKind, ElementVariant, PlanDoc, Room, WallElement } from '../../model/types'
import { undoToast } from '../toast'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { ElementSymbol, symbolExtent } from './Symbol'
import {
  KIND_LABEL, VARIANT_LABEL, VARIANTS, clampOffset, defaultElement, defaultVariant, elementFrame, nearestWall, offsetFromEnd,
  offsetFromEndToStart, overflows, placeOffset, snapTo, wallThickness,
} from './geometry'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ||
  (t instanceof HTMLElement && t.isContentEditable)

/** Screen-px distance the pointer must travel before an element drag starts (7.2 #14). */
const DRAG_THRESHOLD_PX = 4

/** Measuring Mode may leave widthCm empty; such elements are never drawn or hit-tested. */
const drawableWidth = (el: Pick<WallElement, 'widthCm'>) =>
  typeof el.widthCm === 'number' && Number.isFinite(el.widthCm) && el.widthCm > 0

// Variant remembered per kind for the placement tool.
const usePlaceOpts = create<{ variants: Partial<Record<ElementKind, ElementVariant>>; setVariant: (k: ElementKind, v: ElementVariant) => void }>((set) => ({
  variants: {},
  setVariant: (k, v) => set((s) => ({ variants: { ...s.variants, [k]: v } })),
}))

/** SVG transform that maps local wall coords (x along wall, y inward) to world. */
function frameTransform(room: Room, el: Pick<WallElement, 'wallStart' | 'offsetCm' | 'widthCm'>) {
  const wall = wallByStart(room, el.wallStart)
  if (!wall) return null
  const f = elementFrame(wall, el)
  return { wall, f, transform: `matrix(${f.dir.x} ${f.dir.y} ${f.inward.x} ${f.inward.y} ${f.a.x} ${f.a.y})` }
}

/** Draws doors/windows/storage/radiators on their host walls (drawn above RoomsLayer). */
export function ElementsLayer() {
  const doc = useDoc((s) => s.doc)
  const selection = useUi((s) => s.selection)
  const tool = useUi((s) => s.tool)
  const mode = useUi((s) => s.mode)
  const showOpenings = useUi((s) => s.layers.openings)
  const { px, toWorld } = useViewport()
  const drag = useRef<{
    id: string
    pointerId: number
    sx: number
    sy: number
    moved: boolean
    start: PlanDoc | null
    grab: number
  } | null>(null)
  const interactive = tool === 'select' && mode === 'edit'

  // Delete / Backspace removes the selected element.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || isTyping(e.target)) return
      const sel = useUi.getState().selection
      if (sel?.kind !== 'element') return
      e.preventDefault()
      useDoc.getState().update((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== sel.elementId) }))
      useUi.getState().select(null)
      undoToast('Element deleted', () => useDoc.temporal.getState().undo())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onDown = (e: React.PointerEvent, el: WallElement, room: Room) => {
    if (!interactive || e.button !== 0 || !e.isPrimary) return
    e.stopPropagation()
    useUi.getState().select({ kind: 'element', elementId: el.id })
    const wall = wallByStart(room, el.wallStart)
    if (!wall) return
    const p = toWorld(e.clientX, e.clientY)
    // 4 px threshold before the drag starts (7.2 #14): a plain click only selects.
    drag.current = {
      id: el.id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, start: null,
      grab: dot(sub(p, wall.start), wall.dir) - el.offsetCm,
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent, el: WallElement, room: Room) => {
    const d = drag.current
    if (!d || d.id !== el.id || e.pointerId !== d.pointerId) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD_PX) return
      d.moved = true
      d.start = beginDrag()
    }
    const wall = wallByStart(room, el.wallStart)
    if (!wall) return
    e.stopPropagation()
    const p = toWorld(e.clientX, e.clientY)
    const snap = useUi.getState().snap
    let off = dot(sub(p, wall.start), wall.dir) - d.grab
    if (!e.altKey && snap.grid) off = snapTo(off, snap.gridCm)
    off = clampOffset(off, el.widthCm, wall.length)
    if (off === el.offsetCm) return
    useDoc.getState().updateSilent((doc) => ({
      ...doc, elements: doc.elements.map((x) => (x.id === el.id ? { ...x, offsetCm: off, updatedAt: nowIso() } : x)),
    }))
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    e.stopPropagation()
    if (d.start) endDrag(d.start)
  }

  return (
    <g style={{ pointerEvents: interactive ? undefined : 'none' }}>
      {doc.elements.map((el) => {
        if (!showOpenings && (el.kind === 'door' || el.kind === 'window' || el.kind === 'opening')) return null
        // Skip drawing/hit-testing when widthCm is missing or <= 0 (Measuring Mode may leave it empty).
        if (!drawableWidth(el)) return null
        const room = doc.rooms.find((r) => r.id === el.roomId)
        if (!room) return null
        const ft = frameTransform(room, el)
        if (!ft) return null
        const t = wallThickness(room, el.wallStart)
        const selected = selection?.kind === 'element' && selection.elementId === el.id
        const [y0, y1] = symbolExtent(el.kind, el.variant, el.widthCm, t, el.depthCm, el.swing)
        const pad = px(10)
        return (
          <g
            key={el.id}
            transform={ft.transform}
            style={{ cursor: interactive ? 'grab' : undefined }}
            data-element-id={el.id}
            data-element-kind={el.kind}
            aria-label={`${KIND_LABEL[el.kind]} on wall ${room.code}-${ft.wall.index + 1}`}
            onPointerDown={(e) => onDown(e, el, room)}
            onPointerMove={(e) => onMove(e, el, room)}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <rect x={0} y={Math.min(y0, -px(14))} width={el.widthCm} height={Math.max(y1, px(14)) - Math.min(y0, -px(14))} fill="transparent" />
            <ElementSymbol kind={el.kind} variant={el.variant} w={el.widthCm} t={t} depth={el.depthCm} hinge={el.hinge} swing={el.swing} hair={px(1)} />
            {selected && (
              <rect
                x={-pad / 2} y={y0 - pad / 2} width={el.widthCm + pad} height={y1 - y0 + pad}
                fill="none" stroke="#f97316" strokeWidth={px(2)} strokeDasharray={`${px(5)} ${px(3)}`} pointerEvents="none"
              />
            )}
          </g>
        )
      })}
    </g>
  )
}

const KINDS: ElementKind[] = ['door', 'window', 'opening', 'cupboard', 'radiator', 'other']

/** Tool overlay for ui.tool === 'place-element' (kind = ui.placeKind). */
export function PlaceElementTool() {
  const kind = useUi((s) => s.placeKind)
  const variants = usePlaceOpts((s) => s.variants)
  const { px, toWorld } = useViewport()
  const [hover, setHover] = useState<{ roomId: string; wallStart: string; offsetCm: number } | null>(null)
  const variant = variants[kind] ?? defaultVariant(kind)

  const compute = (clientX: number, clientY: number, alt: boolean) => {
    const p = toWorld(clientX, clientY)
    const hit = nearestWall(useDoc.getState().doc.rooms, p, px(30))
    if (!hit) return null
    const spec = defaultElement(kind, variant)
    const snap = useUi.getState().snap
    const step = !alt && snap.grid ? snap.gridCm : 0
    const w = Math.min(spec.widthCm, hit.wall.length)
    return { spec: { ...spec, widthCm: w }, roomId: hit.room.id, wallStart: hit.wall.start.id, offsetCm: placeOffset(hit.along, w, hit.wall.length, step) }
  }

  const onMove = (e: React.PointerEvent) => {
    const h = compute(e.clientX, e.clientY, e.altKey)
    setHover(h && { roomId: h.roomId, wallStart: h.wallStart, offsetCm: h.offsetCm })
  }
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const h = compute(e.clientX, e.clientY, e.altKey)
    if (!h) { setHover(null); return }
    e.stopPropagation()
    const now = nowIso()
    const el: WallElement = { id: uid('el_'), roomId: h.roomId, wallStart: h.wallStart, offsetCm: h.offsetCm, ...h.spec, createdAt: now, updatedAt: now }
    useDoc.getState().update((d) => ({ ...d, elements: [...d.elements, el] }))
    useUi.getState().select({ kind: 'element', elementId: el.id })
  }

  const doc = useDoc((s) => s.doc)
  const room = hover && doc.rooms.find((r) => r.id === hover.roomId)
  const spec = defaultElement(kind, variant)
  const ft = room && hover ? frameTransform(room, { wallStart: hover.wallStart, offsetCm: hover.offsetCm, widthCm: spec.widthCm }) : null

  return (
    <g>
      <CaptureRect onPointerMove={onMove} onPointerDown={onDown} onPointerLeave={() => setHover(null)} style={{ cursor: 'crosshair' }} />
      {room && hover && ft && (
        <g transform={ft.transform} opacity={0.75} pointerEvents="none">
          <ElementSymbol
            kind={kind} variant={spec.variant} w={Math.min(spec.widthCm, ft.wall.length)} t={wallThickness(room, hover.wallStart)}
            depth={spec.depthCm} hinge={spec.hinge} swing={spec.swing} hair={px(1)}
          />
        </g>
      )}
      <KindPicker />
    </g>
  )
}

function KindPicker() {
  const kind = useUi((s) => s.placeKind)
  const set = useUi((s) => s.set)
  const variants = usePlaceOpts((s) => s.variants)
  const setVariant = usePlaceOpts((s) => s.setVariant)
  const opts = VARIANTS[kind]
  const current = variants[kind] ?? defaultVariant(kind)
  const chip = (active: boolean) =>
    `min-h-9 rounded-md px-3 text-sm ${active ? 'bg-orange-700 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'}`
  return createPortal(
    <div
      className="fixed left-1/2 top-16 z-40 flex max-w-[95vw] -translate-x-1/2 flex-col gap-1.5 rounded-xl border border-black/10 bg-white/95 p-1.5 shadow-lg backdrop-blur dark:border-white/15 dark:bg-[#1b2128]/95"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap justify-center gap-1">
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={k === kind} className={chip(k === kind)} onClick={() => set({ placeKind: k })}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      {opts.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {opts.map((v) => (
            <button key={v} type="button" aria-pressed={v === current} className={chip(v === current)} onClick={() => setVariant(kind, v)}>{VARIANT_LABEL[v]}</button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

// ---------- Panel ----------

function NumField({ label, value, onCommit, min }: { label: string; value: number; onCommit: (v: number) => void; min?: number }) {
  const [text, setText] = useState(fmtCm(value))
  useEffect(() => setText(fmtCm(value)), [value])
  const commit = () => {
    const n = parseFloat(text.replace(',', '.'))
    if (Number.isFinite(n) && (min === undefined || n >= min)) { if (n !== value) onCommit(n) }
    else setText(fmtCm(value))
  }
  return (
    <label className="flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400">
      {label}
      <input
        type="text" name={label.toLowerCase().replace(/[^a-z0-9]+/g, '-')} inputMode="decimal" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-9 w-full rounded-md border border-black/15 bg-white px-2 text-sm text-slate-900 dark:border-white/15 dark:bg-[#12161b] dark:text-slate-100"
      />
    </label>
  )
}

function NoteField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => { if (text !== value) onCommit(text) }
  return (
    <label className={fieldLabel}>Note
      <textarea
        name="elementNote" rows={2} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        className="rounded-md border border-black/15 bg-white p-2 text-sm text-slate-900 dark:border-white/15 dark:bg-[#12161b] dark:text-slate-100"
      />
    </label>
  )
}

// Same card palette as RoomsPanel (7.2 #14).
const selectCls = 'h-9 w-full rounded-md border border-black/15 bg-white px-2 text-sm text-slate-900 dark:border-white/15 dark:bg-[#12161b] dark:text-slate-100'
const fieldLabel = 'flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400'

/** Sidebar panel: numeric properties of the selected element. */
export function ElementsPanel() {
  const selection = useUi((s) => s.selection)
  const doc = useDoc((s) => s.doc)
  const update = useDoc((s) => s.update)
  if (selection?.kind !== 'element') return null
  const el = doc.elements.find((x) => x.id === selection.elementId)
  if (!el) return null
  const room = doc.rooms.find((r) => r.id === el.roomId)
  const wall = room ? wallByStart(room, el.wallStart) : undefined
  const wallLabel = room && wall ? `${room.code}-${wall.index + 1}` : '?'
  const patch = (p: Partial<WallElement>) =>
    update((d) => ({ ...d, elements: d.elements.map((x) => (x.id === el.id ? { ...x, ...p, updatedAt: nowIso() } : x)) }))
  const L = wall?.length ?? 0
  const hasDepth = el.kind === 'cupboard' || el.kind === 'radiator'
  const variants = VARIANTS[el.kind]
  // widthCm may be absent (Measuring Mode can leave it empty): treat as 0 here.
  const eff = { ...el, widthCm: el.widthCm ?? 0 }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-black/10 p-2 text-sm dark:border-white/10">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Element · wall {wallLabel}{wall ? ` (${fmtCm(L)} cm)` : ''}</h2>
      <div className="grid grid-cols-2 gap-2">
        <label className={fieldLabel}>Kind
          <select name="elementKind" className={selectCls} value={el.kind} onChange={(e) => {
            const k = e.target.value as ElementKind
            const d = defaultElement(k)
            patch({ kind: k, variant: d.variant, heightCm: d.heightCm, sillCm: d.sillCm, depthCm: d.depthCm, hinge: d.hinge, swing: d.swing })
          }}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {variants.length > 0 && (
          <label className={fieldLabel}>Variant
            <select name="elementVariant" className={selectCls} value={el.variant ?? variants[0]} onChange={(e) => patch({ variant: e.target.value as ElementVariant })}>
              {variants.map((v) => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}
            </select>
          </label>
        )}
        <NumField label="Width (cm)" value={el.widthCm ?? 0} min={1} onCommit={(v) => patch({ widthCm: v })} />
        {el.kind !== 'other' && el.kind !== 'cupboard' && <NumField label="Height (cm)" value={el.heightCm ?? 0} min={0} onCommit={(v) => patch({ heightCm: v })} />}
        {el.kind === 'cupboard' && <NumField label="Height (cm)" value={el.heightCm ?? 0} min={0} onCommit={(v) => patch({ heightCm: v })} />}
        {el.kind === 'window' && <NumField label="Sill (cm)" value={el.sillCm ?? 0} min={0} onCommit={(v) => patch({ sillCm: v })} />}
        {hasDepth && <NumField label="Depth (cm)" value={el.depthCm ?? (el.kind === 'radiator' ? 10 : 60)} min={1} onCommit={(v) => patch({ depthCm: v })} />}
        <NumField label="From start corner (cm)" value={el.offsetCm} onCommit={(v) => patch({ offsetCm: v })} />
        <NumField label="From end corner (cm)" value={offsetFromEnd(eff, L)} onCommit={(v) => patch({ offsetCm: offsetFromEndToStart(v, eff.widthCm, L) })} />
      </div>
      {wall && overflows(eff, L) && (
        <p className="rounded-md bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          Offset + width is longer than the wall ({fmtCm(L)} cm).
        </p>
      )}
      {el.kind === 'door' && (
        <div className="grid grid-cols-2 gap-2">
          <label className={fieldLabel}>Hinge
            <select name="elementHinge" className={selectCls} value={el.hinge ?? 'start'} onChange={(e) => patch({ hinge: e.target.value as 'start' | 'end' })}>
              <option value="start">Start</option><option value="end">End</option>
            </select>
          </label>
          <label className={fieldLabel}>Swing
            <select name="elementSwing" className={selectCls} value={el.swing ?? 'in'} onChange={(e) => patch({ swing: e.target.value as 'in' | 'out' })}>
              <option value="in">In (into room)</option><option value="out">Out</option>
            </select>
          </label>
        </div>
      )}
      <NoteField value={el.note ?? ''} onCommit={(note) => patch({ note: note || undefined })} />
      <button
        type="button"
        aria-label="Delete element"
        className="flex min-h-9 items-center justify-center gap-2 rounded-md border border-red-600/40 px-3 text-sm font-medium text-red-700 hover:bg-red-500/10 dark:border-red-400/40 dark:text-red-400"
        onClick={() => {
          update((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== el.id) }))
          useUi.getState().select(null)
          undoToast('Element deleted', () => useDoc.temporal.getState().undo())
        }}
      >
        <Trash2 size={16} /> Delete
      </button>
    </section>
  )
}
