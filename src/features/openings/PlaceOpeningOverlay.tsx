// Place a door / window / opening on a wall (Plan mode, tool 'place-opening'). Render in the Viewport `overlay`.
// Door: click 1 locks the wall position, the cursor then sets hinge/swing, click 2 adds it.
// Window / opening: one click adds it. Esc cancels.
// The position is rounded along the wall to the artboard precision (hold Cmd for the exact position).
import { useEffect, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/geometry'
import { useDoc } from '../../model/store'
import type { Artboard, Opening, OpeningKind } from '../../model/types'
import { getModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { roundToPrecision } from '../rooms/ops'
import { addOpening } from './actions'
import { DEFAULT_OPENING_WIDTH_CM, computeDoorFlip, createOpening, snapToWall } from './geometry'
import type { WallSnap } from './geometry'
import { OpeningShape } from './OpeningsLayer'

type Hit = { artboard: Artboard; snap: WallSnap }

const RAD = Math.PI / 180

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

  const cancel = () => useUi.getState().set({ tool: 'select', placingOpeningKind: null })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') useUi.getState().set({ tool: 'select', placingOpeningKind: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const find = (world: Vec): Hit | null => {
    const doc = useDoc.getState().doc
    const activeId = useUi.getState().activeArtboardId
    const width = DEFAULT_OPENING_WIDTH_CM[kind]
    const thr = px(12)
    const round = !getModifiers().cmd // Cmd = exact position
    let best: (Hit & { d: number }) | null = null
    for (const ab of doc.artboards) {
      const lp = { x: world.x - ab.xCm, y: world.y - ab.yCm }
      const snap = snapToWall(lp, ab.rooms, width, Math.max(10, thr))
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

  return (
    <g data-testid="place-opening-overlay">
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerLeave={() => { if (!locked) setHover(null) }}
        onContextMenu={(e) => { e.preventDefault(); cancel() }}
      />
      {preview && (
        <g transform={`translate(${preview.ab.xCm} ${preview.ab.yCm})`} opacity={0.9} data-testid="opening-preview" pointerEvents="none" strokeWidth={px(1)}>
          <OpeningShape op={preview.op} ghost />
        </g>
      )}
    </g>
  )
}
