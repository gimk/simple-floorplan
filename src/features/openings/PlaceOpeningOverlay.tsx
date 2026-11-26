// Place a door / window / opening on a wall (Plan mode, tool 'place-opening'). Render in the Viewport `overlay`.
// Door: click 1 locks the wall position, the cursor then sets hinge/swing, click 2 adds it.
// Window / opening: one click adds it. Esc cancels.
// Door, after click 1: the first Esc or right-click unlocks back to wall hover, the second cancels.
// The position is rounded along the wall to the artboard precision (hold the no-snap key for the exact position).
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { ToolHint } from '../../canvas/ToolHint'
import { fmtCm } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { useDoc } from '../../model/store'
import type { Artboard, Opening, OpeningKind } from '../../model/types'
import { FREE_SNAP_LABEL, getModifiers, isFreeSnap, syncModifiersFromEvent } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { roundToPrecision } from '../rooms/ops'
import { addOpening } from './actions'
import { DEFAULT_OPENING_WIDTH_CM, computeDoorFlip, createOpening, snapToWall } from './geometry'
import type { WallSnap } from './geometry'
import { OpeningShape } from './OpeningsLayer'

type Hit = { artboard: Artboard; snap: WallSnap }

const RAD = Math.PI / 180
const OVERLAP_PERP_CM = 8

/** True when the new opening overlaps an existing opening on the same wall. */
function overlapsExisting(ab: Artboard, snap: WallSnap, widthCm: number): boolean {
  const dx = Math.cos(snap.angleDeg * RAD), dy = Math.sin(snap.angleDeg * RAD)
  return ab.openings.some((o) => {
    const ox = o.xCm - snap.xCm, oy = o.yCm - snap.yCm
    const along = ox * dx + oy * dy
    const perp = -ox * dy + oy * dx
    const sameDir = Math.abs(Math.sin(((o.angleDeg - snap.angleDeg) * Math.PI) / 180)) < 0.02
    return sameDir && Math.abs(perp) <= OVERLAP_PERP_CM && Math.abs(along) < (o.widthCm + widthCm) / 2 - 0.5
  })
}

/** Distance tags from the opening to both wall ends, in artboard-local cm. */
function EndDistances({ snap, widthCm }: { snap: WallSnap; widthCm: number }) {
  const { px } = useViewport()
  const dx = Math.cos(snap.angleDeg * RAD), dy = Math.sin(snap.angleDeg * RAD)
  const pos = (snap.xCm - snap.a.x) * dx + (snap.yCm - snap.a.y) * dy
  const gaps = [
    { len: pos - widthCm / 2, mid: (pos - widthCm / 2) / 2 },
    { len: snap.wallLengthCm - pos - widthCm / 2, mid: pos + widthCm / 2 + (snap.wallLengthCm - pos - widthCm / 2) / 2 },
  ]
  return (
    <>
      {gaps.map((g, i) =>
        g.len > 1 ? (
          <text
            key={i} data-testid="opening-end-distance"
            x={snap.a.x + dx * g.mid - dy * px(12)} y={snap.a.y + dy * g.mid + dx * px(12)}
            textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill="#f1f5f9"
            stroke="#12161b" strokeWidth={px(3)} paintOrder="stroke"
          >
            {fmtCm(g.len)} cm
          </text>
        ) : null,
      )}
    </>
  )
}

/** Snap position rounded along the wall (not across it) to the artboard precision; `round` false = exact. */
function roundAlongWall(snap: WallSnap, widthCm: number, precisionCm: number, round: boolean): WallSnap {
  if (!round || !(precisionCm > 0)) return snap
  const dx = Math.cos(snap.angleDeg * RAD), dy = Math.sin(snap.angleDeg * RAD)
  const along = roundToPrecision((snap.xCm - snap.a.x) * dx + (snap.yCm - snap.a.y) * dy, precisionCm)
  const lo = Math.min(widthCm / 2, snap.wallLengthCm / 2)
  const hi = Math.max(snap.wallLengthCm - widthCm / 2, snap.wallLengthCm / 2)
  const pos = Math.min(hi, Math.max(lo, along))
  return { ...snap, xCm: snap.a.x + dx * pos, yCm: snap.a.y + dy * pos, t: snap.wallLengthCm > 0 ? pos / snap.wallLengthCm : snap.t }
}

export function PlaceOpeningOverlay() {
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const kind = useUi((s) => s.placingOpeningKind)
  if (mode !== 'plan' || tool !== 'place-opening' || !kind) return null
  return <Surface key={kind} kind={kind} />
}

function Surface({ kind }: { kind: OpeningKind }) {
  const { px, toWorld } = useViewport()
  const [hover, setHover] = useState<Hit | null>(null)
  const [locked, setLocked] = useState<Hit | null>(null)
  const [cursor, setCursor] = useState<Vec | null>(null) // local to the locked artboard

  const lockedRef = useRef<Hit | null>(null)
  useEffect(() => { lockedRef.current = locked }, [locked])

  const cancel = () => useUi.getState().set({ tool: 'select', placingOpeningKind: null })
  /** Esc / right-click: a locked door goes back to wall hover first, then the tool is cancelled. */
  const back = () => {
    if (lockedRef.current) { lockedRef.current = null; setLocked(null); setCursor(null); return }
    cancel()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const find = (world: Vec): Hit | null => {
    const doc = useDoc.getState().doc
    const activeId = useUi.getState().activeArtboardId
    const width = DEFAULT_OPENING_WIDTH_CM[kind]
    const thr = px(22)
    const round = !isFreeSnap(getModifiers()) // no-snap key = exact position
    let best: (Hit & { d: number }) | null = null
    for (const ab of doc.artboards) {
      const lp = { x: world.x - ab.xCm, y: world.y - ab.yCm }
      const snap = snapToWall(lp, ab.rooms, width, thr)
      if (!snap) continue
      const d = Math.hypot(lp.x - snap.xCm, lp.y - snap.yCm)
      const bias = ab.id === activeId ? 0 : 0.5 // active artboard wins ties
      if (!best || d + bias < best.d) best = { artboard: ab, snap: roundAlongWall(snap, width, ab.precisionCm, round), d: d + bias }
    }
    return best
  }

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    syncModifiersFromEvent(e)
    const w = toWorld(e.clientX, e.clientY)
    if (locked) { setCursor({ x: w.x - locked.artboard.xCm, y: w.y - locked.artboard.yCm }); return }
    setHover(find(w))
  }

  const commit = (hit: Hit, op: Opening) => {
    addOpening(hit.artboard.id, op)
    useUi.getState().set({
      activeArtboardId: hit.artboard.id,
      selection: { kind: 'opening', artboardId: hit.artboard.id, openingId: op.id },
      tool: 'select',
      placingOpeningKind: null,
    })
  }

  const onDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    syncModifiersFromEvent(e)
    const w = toWorld(e.clientX, e.clientY)
    if (kind !== 'door') {
      const hit = find(w)
      if (hit) commit(hit, createOpening(kind, hit.snap))
      return
    }
    if (!locked) {
      const hit = find(w)
      if (!hit) return
      setLocked(hit)
      setCursor({ x: w.x - hit.artboard.xCm, y: w.y - hit.artboard.yCm })
      return
    }
    const lp = { x: w.x - locked.artboard.xCm, y: w.y - locked.artboard.yCm }
    const f = computeDoorFlip({ x: locked.snap.xCm, y: locked.snap.yCm }, locked.snap.angleDeg, lp)
    commit(locked, createOpening('door', locked.snap, f.hinge, f.swing))
  }

  let preview: { ab: Artboard; op: Opening } | null = null
  if (locked) {
    const f = cursor
      ? computeDoorFlip({ x: locked.snap.xCm, y: locked.snap.yCm }, locked.snap.angleDeg, cursor)
      : { hinge: 'left' as const, swing: 'in' as const }
    preview = { ab: locked.artboard, op: createOpening('door', locked.snap, f.hinge, f.swing) }
  } else if (hover) {
    preview = { ab: hover.artboard, op: createOpening(kind, hover.snap) }
  }

  const previewHit = locked ?? hover
  const overlap = !!preview && !!previewHit && overlapsExisting(preview.ab, previewHit.snap, preview.op.widthCm)
  const label = kind === 'door' ? 'Door' : kind === 'window' ? 'Window' : 'Opening'
  const hint = locked
    ? 'Move to choose swing · Click to place · Esc unlock'
    : !hover
      ? `${label}: Move cursor onto a wall · Esc cancel`
      : overlap
        ? `${label}: Overlaps another opening · Esc cancel`
        : kind === 'door'
          ? `Door: Click to lock position, then choose swing · ${FREE_SNAP_LABEL} exact position · Esc cancel`
          : `${label}: Click to place · ${FREE_SNAP_LABEL} exact position · Esc cancel`

  return (
    <g data-testid="place-opening-overlay">
      <ToolHint text={hint} />
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerLeave={() => { if (!locked) setHover(null) }}
        onContextMenu={(e) => { e.preventDefault(); back() }}
      />
      {preview && (
        <g transform={`translate(${preview.ab.xCm} ${preview.ab.yCm})`} opacity={0.9} data-testid="opening-preview" pointerEvents="none" strokeWidth={px(1)}>
          <OpeningShape op={preview.op} ghost />
          {overlap && previewHit && (() => {
            const dx = Math.cos(preview.op.angleDeg * RAD), dy = Math.sin(preview.op.angleDeg * RAD)
            const h = preview.op.widthCm / 2
            return (
              <line
                data-testid="opening-overlap"
                x1={preview.op.xCm - dx * h} y1={preview.op.yCm - dy * h} x2={preview.op.xCm + dx * h} y2={preview.op.yCm + dy * h}
                stroke="#ef4444" strokeOpacity={0.7} strokeWidth={px(8)} strokeLinecap="round"
              />
            )
          })()}
          {previewHit && <EndDistances snap={previewHit.snap} widthCm={preview.op.widthCm} />}
        </g>
      )}
    </g>
  )
}
