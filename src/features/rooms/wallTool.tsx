// Wall tool (docs/walls-plan.md phase 6): click to start, each click adds one segment to the chain,
// double-click or Enter ends the chain, Esc cancels the chain, Backspace removes the last point.
//
// ONE UNDO STEP PER SEGMENT: every click stores its segment at once - a real wall (`standalone`) in
// a v2 document, a trace in a v1 document -, so a wrong segment costs one Ctrl+Z and not the whole
// chain. The chain itself is not in the doc.
//
// Section 7 of docs/measurements-plan.md adds two things:
//   - TYPE A LENGTH: after the first point, a digit (or ',' / '.') opens a small box next to the
//     pointer with "Length (cm)" and, on Tab, "Angle (°)" (default: the preview angle). Enter
//     places that segment through the same `addPoint` path (one undo step) and the chain goes on.
//     Esc closes the box first, a second Esc ends the chain.
//   - ALIGNMENT: S cycles the drawing reference centre -> side A (left face) -> side B. The clicked
//     points stay on the chosen FACE line; the stored centre line is moved half a thickness to the
//     other side, and consecutive segments join at a mitre.
import { useEffect, useMemo, useState, type PointerEvent as RPE } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { dist } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import type { Vec } from '../../model/types'
import { parseDecimal } from '../../shell/panel/number'
import { useGuides } from './guides'
import { NoticeLayer } from './notice'
import { snapPoint, type SnapGuide } from './snap'
import { removeWallSegment } from './traces'
import {
  SAME_POINT_CM, alignBadge, angleFieldText, centreLineOffsetCm, chainSegments,
  nextAlign, nextWallProps, offsetChain, placePoint, previewLabel, removeChainPoint, snapTargets, typedEnd,
  type DrawAlign,
} from './wallToolLogic'
import { WallToolInput, type WallTyped } from './wallToolInput'

const inInput = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]')

/** Starts the typed length: a digit, a comma or a dot (a dot becomes the comma of the app). */
const startsLength = (key: string) => /^[0-9]$/.test(key) || key === ',' || key === '.'

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
  const nodes = useDoc((s) => s.doc.nodes)
  const walls = useDoc((s) => s.doc.walls)
  const snapOpts = useUi((s) => s.snap)
  const thicknessCm = useUi((s) => s.wallToolThicknessCm)
  const wallType = useUi((s) => s.wallToolType)
  /** Points of the chain (the clicked FACE points); ids[i] is the segment from points[i] to points[i + 1]. */
  const [points, setPoints] = useState<Vec[]>([])
  const [ids, setIds] = useState<string[]>([])
  const [hover, setHover] = useState<Vec | null>(null)
  /** Drawing reference: the clicked points are on the centre line, on side A or on side B. */
  const [align, setAlign] = useState<DrawAlign>('centre')
  /** Open typed length box (null = closed). */
  const [typed, setTyped] = useState<WallTyped | null>(null)
  const setGuides = useGuides((s) => s.set)
  const targets = useMemo(() => snapTargets({ rooms, traces, nodes, walls }, points), [rooms, traces, nodes, walls, points])
  const props = nextWallProps(thicknessCm, wallType)
  /** Distance of the stored centre line from the clicked face line, cm (0 for the centre). */
  const offsetCm = centreLineOffsetCm(align, props.thicknessCm)

  const endChain = () => { setPoints([]); setIds([]); setHover(null); setTyped(null); setGuides([]) }

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

  /**
   * Add one point to the chain and store the new segment at once (one undo step). With an
   * alignment the clicked point is on a face: the segment is stored on the centre line, and the
   * end of the previous segment moves to the mitre of the corner (same undo step).
   */
  const addPoint = (p: Vec) => {
    if (!points.length) { setPoints([p]); return }
    const doc = useDoc.getState().doc
    const placed = placePoint(doc, points, ids[ids.length - 1] || null, p, props, offsetCm)
    if (placed.chain === points) return
    if (placed.doc !== doc) useDoc.getState().update(() => placed.doc)
    setPoints(placed.chain)
    setIds([...ids, placed.wallId ?? ''])
  }

  /** Length and angle that the box holds now; null angle = the preview direction. */
  const typedValues = () => {
    if (!typed) return { length: null as number | null, angle: null as number | null }
    const angle = typed.angle.trim() === '' ? null : parseDecimal(typed.angle)
    return { length: parseDecimal(typed.length), angle }
  }

  /** Enter in the box: place the segment with that length (and angle) from the last point. */
  const placeTyped = () => {
    if (!typed) return
    const { length, angle } = typedValues()
    const last = points[points.length - 1]
    const end = last ? typedEnd(last, hover, length, angle) : null
    if (!end) return
    addPoint(end)
    setTyped(null)
  }

  // Keys in CAPTURE phase: an active chain must cancel itself and keep the wall tool (7.2 #13).
  // No dependency list: the listener is registered again on each render, so it always reads the
  // chain of the current render (like the polygon tool).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (typed) {
        // The box is open: Esc closes it first (the chain stays), the inputs do the rest.
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTyped(null); return }
        if (inInput(e.target)) return
        // The focus went elsewhere: the box is stale, close it and swallow this key.
        setTyped(null)
        return
      }
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
          // The last point was stored as its segment: remove it with its point (one undo step).
          useDoc.getState().update((d) => removeWallSegment(d, lastId))
          setIds(ids.slice(0, -1))
        }
        setPoints(removeChainPoint(points))
      } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // S: the drawing reference, centre -> side A -> side B (the slice tool shortcut waits).
        e.preventDefault(); e.stopPropagation()
        setAlign(nextAlign(align))
      } else if (startsLength(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // A digit (or a decimal mark) after the first point opens the typed length box.
        e.preventDefault(); e.stopPropagation()
        setTyped({ length: e.key === '.' ? ',' : e.key, angle: '', focus: 'length' })
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  // Leaving the tool drops the chain (the traces already drawn stay in the doc).
  useEffect(() => () => useGuides.getState().set([]), [])

  const last = points[points.length - 1]
  const { length: typedLength, angle: typedAngle } = typedValues()
  // The box shows the segment it will place: its typed length wins over the pointer.
  const typedPoint = typed && last ? typedEnd(last, hover, typedLength, typedAngle) : null
  const end = typedPoint ?? hover
  const clicked = end && last && dist(last, end) >= SAME_POINT_CM ? [...points, end] : points
  const centre = offsetChain(clicked, offsetCm)
  const preview = chainSegments(centre)
  const label = last && end && dist(last, end) >= SAME_POINT_CM ? previewLabel(last, end) : null
  const invalidLength = !!typed && typed.length.trim() !== '' && typedLength == null

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
          // A click is another way to place the segment: it takes the place of the typed length.
          setTyped(null)
          addPoint(p)
        }}
        // A double-click adds no point (same place) and ends the chain.
        onDoubleClick={(e) => { e.preventDefault(); endChain() }}
      />
      {preview.length > 0 && (
        <g pointerEvents="none">
          {/* The face line of the reference: the clicked points, a half thickness from the centre. */}
          {offsetCm !== 0 && chainSegments(clicked).map(([a, b], i) => (
            <line key={`f${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={px(1)}
              strokeDasharray={`${px(2)} ${px(4)}`} data-wall-face-line=""
              className="stroke-orange-500/70" />
          ))}
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
          {label && last && end && (() => {
            const mx = (last.x + end.x) / 2, my = (last.y + end.y) / 2
            return (
              <text x={mx} y={my - px(12)} textAnchor="middle" dominantBaseline="middle" fontSize={px(12)}
                fontWeight={600} paintOrder="stroke" strokeWidth={px(3)} strokeLinejoin="round"
                data-wall-preview-label=""
                className="fill-orange-700 stroke-[#f6f7f5] dark:fill-orange-300 dark:stroke-[#12161b]">
                {label}
              </text>
            )
          })()}
          {/* The drawing reference of the next segment: C (centre), A or B (a side). */}
          {last && (() => {
            const at = hover ?? last
            const badge = alignBadge(align)
            return (
              <g data-wall-align-badge={align}>
                <circle cx={at.x + px(14)} cy={at.y - px(14)} r={px(9)} strokeWidth={px(1)}
                  className="fill-orange-500 stroke-white dark:stroke-slate-900" />
                <text x={at.x + px(14)} y={at.y - px(14)} textAnchor="middle" dominantBaseline="central"
                  fontSize={px(11)} fontWeight={700}
                  className="fill-white">{badge}</text>
              </g>
            )
          })()}
        </g>
      )}
      {typed && (
        <WallToolInput
          at={typedPoint ?? hover ?? last ?? { x: 0, y: 0 }}
          vp={vp}
          value={typed}
          invalid={invalidLength}
          onChange={setTyped}
          onPlace={placeTyped}
          onClose={() => setTyped(null)}
          onTabAngle={() => setTyped({
            ...typed,
            focus: 'angle',
            // Default angle: the one of the preview right now (snapped as today).
            angle: typed.angle.trim() === '' ? angleFieldText(last, hover) : typed.angle,
          })}
        />
      )}
      <Guides />
      <NoticeLayer />
    </g>
  )
}
