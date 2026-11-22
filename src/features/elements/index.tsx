// OWNER: elements agent. Contract: keep these export names and signatures.
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { create } from 'zustand'
import { beginDrag, endDrag, nowIso, uid, useDoc, useUi } from '../../model/store'
import { dot, sub, wallByStart } from '../../model/geometry'
import type { ElementKind, ElementVariant, PlanDoc, Room, WallElement } from '../../model/types'
import { undoToast } from '../toast'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { ERROR, FieldRow, IconButton, NumberField, PanelSection, Segmented, SelectField, TextField } from '../../shell/panel'
import { ElementSymbol, symbolExtent } from './Symbol'
import {
  KIND_LABEL, VARIANT_LABEL, VARIANTS, clampOffset, defaultElement, defaultVariant, elementFrame, nearestWall, offsetFromEnd,
  offsetFromEndToStart, overflows, placeOffset, snapTo, wallThickness,
} from './geometry'
import { ELEMENT_FIELD_NAMES, depthDefault, elementPanelTitle, hasDepth, overflowWarning, showsHeight } from './panel'

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

/** Field names of the pre-migration inputs (`width-cm-`, `elementKind`, …). */
const N = ELEMENT_FIELD_NAMES

const HINGE_OPTIONS = [
  { value: 'start', label: 'Start' },
  { value: 'end', label: 'End' },
]

const SWING_OPTIONS = [
  { value: 'in', label: 'In', title: 'In (into room)' },
  { value: 'out', label: 'Out', title: 'Out' },
]

export type ElementCardProps = {
  el: WallElement
  /** Host room, when the doc still has it. */
  room?: Room
  /** One edit: the caller turns it into one undo step. */
  onPatch: (patch: Partial<WallElement>) => void
  onDelete: () => void
}

/** The element inspector card. Pure: the store-connected wrapper is `ElementsPanel`. */
export function ElementCard({ el, room, onPatch: patch, onDelete: deleteElement }: ElementCardProps) {
  const wall = room ? wallByStart(room, el.wallStart) : undefined
  const wallLabel = room && wall ? `${room.code}-${wall.index + 1}` : '?'
  const L = wall?.length ?? 0
  const variants = VARIANTS[el.kind]
  // widthCm may be absent (Measuring Mode can leave it empty): treat as 0 here.
  const eff = { ...el, widthCm: el.widthCm ?? 0 }
  const kindOptions = KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))
  const variantOptions = variants.map((v) => ({ value: v, label: VARIANT_LABEL[v] }))
  const over = wall ? overflows(eff, L) : false

  return (
    <PanelSection
      title={elementPanelTitle(el.kind, wallLabel, wall?.length)}
      actions={<IconButton label="Delete element" variant="danger" icon={<Trash2 size={16} />} onClick={deleteElement} />}
    >
      {/* A new key resets the drafts of the fields when another element is selected. */}
      <Fragment key={el.id}>
        {/* 6 kinds: a select reads better than 6 squeezed segments in a 320 px sidebar. */}
        <FieldRow label="Kind" htmlFor={N.kind}>
          <SelectField
            id={N.kind}
            name={N.kind}
            value={el.kind}
            options={kindOptions}
            onChange={(v) => {
              const k = v as ElementKind
              const d = defaultElement(k)
              patch({ kind: k, variant: d.variant, heightCm: d.heightCm, sillCm: d.sillCm, depthCm: d.depthCm, hinge: d.hinge, swing: d.swing })
            }}
          />
        </FieldRow>
        {variants.length > 0 && (
          <FieldRow label="Variant" htmlFor={N.variant}>
            <SelectField
              id={N.variant}
              name={N.variant}
              value={el.variant ?? variants[0]}
              options={variantOptions}
              onChange={(v) => patch({ variant: v as ElementVariant })}
            />
          </FieldRow>
        )}
        <FieldRow label="Width" htmlFor={N.width}>
          <div className="flex flex-col gap-1">
            <NumberField
              id={N.width}
              name={N.width}
              unit="cm"
              value={el.widthCm ?? null}
              min={1}
              invalidMessage="Type a width in centimeters."
              onCommit={(v) => {
                if (v == null) return false
                patch({ widthCm: v })
              }}
            />
            {over && <p role="alert" className={ERROR}>{overflowWarning(L)}</p>}
          </div>
        </FieldRow>
        {showsHeight(el.kind) && (
          <FieldRow label="Height" htmlFor={N.height}>
            <NumberField
              id={N.height}
              name={N.height}
              unit="cm"
              value={el.heightCm ?? 0}
              min={0}
              onCommit={(v) => {
                if (v != null) patch({ heightCm: v })
              }}
            />
          </FieldRow>
        )}
        {el.kind === 'window' && (
          <FieldRow label="Sill" htmlFor={N.sill}>
            <NumberField
              id={N.sill}
              name={N.sill}
              unit="cm"
              value={el.sillCm ?? 0}
              min={0}
              onCommit={(v) => {
                if (v != null) patch({ sillCm: v })
              }}
            />
          </FieldRow>
        )}
        {hasDepth(el.kind) && (
          <FieldRow label="Depth" htmlFor={N.depth}>
            <NumberField
              id={N.depth}
              name={N.depth}
              unit="cm"
              value={el.depthCm ?? depthDefault(el.kind)}
              min={1}
              onCommit={(v) => {
                if (v != null) patch({ depthCm: v })
              }}
            />
          </FieldRow>
        )}
        <FieldRow label="From start corner" htmlFor={N.offsetStart}>
          <NumberField
            id={N.offsetStart}
            name={N.offsetStart}
            unit="cm"
            value={el.offsetCm}
            onCommit={(v) => {
              if (v != null) patch({ offsetCm: v })
            }}
          />
        </FieldRow>
        <FieldRow label="From end corner" htmlFor={N.offsetEnd}>
          <NumberField
            id={N.offsetEnd}
            name={N.offsetEnd}
            unit="cm"
            value={offsetFromEnd(eff, L)}
            onCommit={(v) => {
              if (v != null) patch({ offsetCm: offsetFromEndToStart(v, eff.widthCm, L) })
            }}
          />
        </FieldRow>
        {el.kind === 'door' && (
          <>
            <FieldRow label="Hinge">
              <Segmented
                ariaLabel="Hinge"
                size="sm"
                options={HINGE_OPTIONS}
                value={el.hinge ?? 'start'}
                onChange={(v) => patch({ hinge: v as 'start' | 'end' })}
              />
            </FieldRow>
            <FieldRow label="Swing">
              <Segmented
                ariaLabel="Swing"
                size="sm"
                options={SWING_OPTIONS}
                value={el.swing ?? 'in'}
                onChange={(v) => patch({ swing: v as 'in' | 'out' })}
              />
            </FieldRow>
          </>
        )}
        <FieldRow label="Note" htmlFor={N.note}>
          <TextField
            id={N.note}
            name={N.note}
            rows={2}
            value={el.note ?? ''}
            onCommit={(note) => {
              patch({ note: note || undefined })
            }}
          />
        </FieldRow>
      </Fragment>
    </PanelSection>
  )
}

/** Sidebar panel: numeric properties of the selected element. */
export function ElementsPanel() {
  const selection = useUi((s) => s.selection)
  const doc = useDoc((s) => s.doc)
  const update = useDoc((s) => s.update)
  if (selection?.kind !== 'element') return null
  const el = doc.elements.find((x) => x.id === selection.elementId)
  if (!el) return null
  const room = doc.rooms.find((r) => r.id === el.roomId)
  return (
    <ElementCard
      el={el}
      room={room}
      onPatch={(p) =>
        update((d) => ({ ...d, elements: d.elements.map((x) => (x.id === el.id ? { ...x, ...p, updatedAt: nowIso() } : x)) }))
      }
      onDelete={() => {
        update((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== el.id) }))
        useUi.getState().select(null)
        undoToast('Element deleted', () => useDoc.temporal.getState().undo())
      }}
    />
  )
}
