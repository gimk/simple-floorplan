// Wall tool (docs/walls-plan.md phase 6): click to start, each click adds one segment to the chain,
// double-click or Enter ends the chain, Esc cancels the chain, Backspace removes the last point.
//
// ONE UNDO STEP PER SEGMENT: every click stores its trace in `doc.traces` at once, so a wrong
// segment costs one Ctrl+Z and not the whole chain. The chain itself is not in the doc.
import { useEffect, useMemo, useState, type PointerEvent as RPE } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { dist } from '../../model/geometry'
import { uid, useDoc, useUi } from '../../model/store'
import type { Vec } from '../../model/types'
import { useGuides } from './guides'
import { NoticeLayer } from './notice'
import { snapPoint, type SnapGuide } from './snap'
import { addTrace } from './traces'
import { SAME_POINT_CM, addChainPoint, nextWallProps, previewLabel, removeChainPoint, segmentsWith, snapTargets } from './wallToolLogic'

const inInput = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]')

/** Draws the snap guides of the pointer (same look as the other drawing tools). */
function Guides() {
  const guides = useGuides((s) => s.guides)
  const { px } = useViewport()
  useEffect(() => () => useGuides.getState().set([]), [])
  return (
    <g pointerEvents="none">
      {guides.map((g: SnapGuide, i: number) => {
        if (g.kind === 'vertex') return <circle key={i} cx={g.at.x} cy={g.at.y} r={px(8)} fill="none" strokeWidth={px(2)} className="stroke-fuchsia-500" />
        if (g.kind === 'edge') {
          return <line key={i} x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} strokeWidth={px(4)} strokeLinecap="round" className="stroke-fuchsia-500" />
        }
        return (
          <line key={i} x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} strokeWidth={px(1)}
            strokeDasharray={`${px(4)} ${px(3)}`} className="stroke-fuchsia-500" />
        )
      })}
    </g>
  )
}

export function WallTool() {
  const vp = useViewport()
  const { px } = vp
  const rooms = useDoc((s) => s.doc.rooms)
  const traces = useDoc((s) => s.doc.traces)
  const snapOpts = useUi((s) => s.snap)
  const thicknessCm = useUi((s) => s.wallToolThicknessCm)
  const wallType = useUi((s) => s.wallToolType)
  /** Points of the chain; ids[i] is the trace from points[i] to points[i + 1]. */
  const [points, setPoints] = useState<Vec[]>([])
  const [ids, setIds] = useState<string[]>([])
  const [hover, setHover] = useState<Vec | null>(null)
  const setGuides = useGuides((s) => s.set)
  const targets = useMemo(() => snapTargets({ rooms, traces }, points), [rooms, traces, points])
  const props = nextWallProps(thicknessCm, wallType)

  const endChain = () => { setPoints([]); setIds([]); setHover(null); setGuides([]) }

  /** Snap the pointer: trace ends, room corners, T junction on a trace or a wall, 45/90°, grid. */
  const snap = (e: RPE): Vec => {
    const last = points[points.length - 1]
    const r = snapPoint(vp.toWorld(e.clientX, e.clientY), {
      opts: snapOpts, refs: last ? [last] : [], vertices: targets.vertices, edges: targets.edges,
      tolCm: px(10), disabled: e.altKey,
    })
    setGuides(r.guides)
    return r.point
  }

  const addPoint = (p: Vec) => {
    if (!points.length) { setPoints([p]); return }
    const last = points[points.length - 1]
    if (dist(last, p) < SAME_POINT_CM) return
    const traceId = uid('trace')
    // One undo step per segment.
    useDoc.getState().update((d) => addTrace(d, last, p, props, traceId))
    setPoints(addChainPoint(points, p))
    setIds([...ids, traceId])
  }

  // Keys in CAPTURE phase: an active chain must cancel itself and keep the wall tool (7.2 #13).
  // No dependency list: the listener is registered again on each render, so it always reads the
  // chain of the current render (like the polygon tool).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (inInput(e.target)) return
      if (!points.length) return
      if (e.key === 'Escape') {
        // First Esc: drop the chain (the segments already drawn stay, Ctrl+Z removes them).
        e.preventDefault(); e.stopPropagation()
        endChain()
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation()
        endChain()
      } else if (e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation()
        const lastId = ids[ids.length - 1]
        if (lastId) {
          // The last point was stored as a trace: remove it with its point (one undo step).
          useDoc.getState().update((d) => ({ ...d, traces: (d.traces ?? []).filter((t) => t.id !== lastId) }))
          setIds(ids.slice(0, -1))
        }
        setPoints(removeChainPoint(points))
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  // Leaving the tool drops the chain (the traces already drawn stay in the doc).
  useEffect(() => () => useGuides.getState().set([]), [])

  const preview = segmentsWith(points, hover)
  return (
    <g>
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerMove={(e) => setHover(snap(e))}
        onPointerLeave={() => { setHover(null); setGuides([]) }}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return
          const p = snap(e)
          setHover(p)
          addPoint(p)
        }}
        // A double-click adds no point (same place) and ends the chain.
        onDoubleClick={(e) => { e.preventDefault(); endChain() }}
      />
      {preview.length > 0 && (
        <g pointerEvents="none">
          {preview.map(([a, b], i) => (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={Math.max(props.thicknessCm, px(2))}
                strokeLinecap="butt" className="stroke-orange-400/25" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={px(2)} strokeLinecap="round"
                strokeDasharray={`${px(7)} ${px(4)}`} className="stroke-orange-500" />
            </g>
          ))}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 ? 5 : 4)} strokeWidth={px(1.5)}
              className="fill-orange-500 stroke-white dark:stroke-slate-900" />
          ))}
          {(() => {
            const last = points[points.length - 1]
            if (!last || !hover || dist(last, hover) < SAME_POINT_CM) return null
            const mx = (last.x + hover.x) / 2, my = (last.y + hover.y) / 2
            return (
              <text x={mx} y={my - px(12)} textAnchor="middle" dominantBaseline="middle" fontSize={px(12)}
                fontWeight={600} paintOrder="stroke" strokeWidth={px(3)} strokeLinejoin="round"
                data-wall-preview-label=""
                className="fill-orange-700 stroke-[#f6f7f5] dark:fill-orange-300 dark:stroke-[#12161b]">
                {previewLabel(last, hover)}
              </text>
            )
          })()}
        </g>
      )}
      <Guides />
      <NoticeLayer />
    </g>
  )
}
