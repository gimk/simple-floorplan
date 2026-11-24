// Walls drawn once from the wall graph (docs/walls-plan.md, "Walls in the interface").
// A v2 document draws one band per stored wall, so a wall between two rooms is ONE shape, with the
// joins of the graph (`wallJoins.ts`). A v1 document keeps its room walls, drawn by `RoomsLayer`.
//
// The styles are the ones of the room walls: the type owns the fill, the renovation status and the
// renovation view decide what is shown, the bearing highlight layer adds the light tone and the
// diagonal stripes, and the selected wall (`Selection { kind: 'storedWall' }`) is outlined in
// orange.
//
// HIT AREAS: this layer owns them for a v2 document. There is ONE hit area per STORED wall, taken
// from the graph (the band plus a line on the centre line, at least 18 px wide, so a thin wall is
// easy to hit). A wall that no room uses (a single wall, or a wall left by a deleted room) has one
// too, so it can be selected, dragged and deleted, and it shows its length and its lock like a room
// wall. A click selects the whole wall with the side of the half that was clicked (`sideOfPoint`),
// so both sides are selectable at will. The per-room wall hit areas of `RoomsLayer` are used by a v1
// document only.
//
// MEASURING MODE (desktop): the same one-hit-area rule. The side of the click gives the room face of
// that side (`wallFaceAt`), and the outside half of a facade wall gives its outside face value
// ('W12-E'), so a shared wall is no longer covered by two per-room lines.
//
// A selected single wall shows two end handles: dragging one moves its NODE (`moveNode`), with one
// undo step, so the wall gets longer or shorter on the plan.
import { useMemo, useRef, useState } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { dist, fmtCm } from '../../model/geometry'
import { selectedItems } from '../../model/selection'
import { useDoc, useUi } from '../../model/store'
import { fmtLen } from '../../model/units'
import type { StoredWall, Vec } from '../../model/types'
import { wallAppearance } from '../renovation/logic'
import { focusMeasureField } from '../measure/focusField'
import { inputId } from '../measure/actions'
import { dimLine } from './dims/dimLine'
import { DimLineView } from './dims/DimLineView'
import { onStoredNodeDown, onStoredWallDouble, onStoredWallDown } from './interaction'
import { polygonPath, polylinePath } from './wallOutline'
import { wallJoinGeometry } from './wallJoins'
import { outsideFaceLabelAtPoint, sideOfPoint, wallFaceAt, wallFaceAtPoint } from './wallSides'

/** Solid walls (exterior, and bearing walls when the highlight layer is off). */
const solidClass = 'fill-slate-900 dark:fill-slate-100'

const wallClass = {
  exterior: solidClass,
  bearing: solidClass,
  partition: 'fill-slate-400 dark:fill-slate-500',
}

/** Bearing walls with the highlight layer on: light tone + thin dark diagonal stripes. */
const bearingFaceClass = 'stroke-slate-500 dark:stroke-slate-400'

/** Least width of a wall hit area on screen, px: a thin partition stays easy to click. */
const HIT_PX = 18
/** Least length of a single wall on screen to show its length text, px. */
const LENGTH_PX = 24

export function WallsLayer() {
  const v2 = useDoc((s) => s.doc.schemaVersion === 2)
  const walls = useDoc((s) => s.doc.walls)
  const nodes = useDoc((s) => s.doc.nodes)
  const selection = useUi((s) => s.selection)
  const multi = useUi((s) => s.multi)
  const layers = useUi((s) => s.layers)
  const renovationView = useUi((s) => s.renovationView)
  // How a length is written on the plan: dimension lines or text only, and the units of the plan.
  const dimStyle = useUi((s) => s.dimStyle)
  const units = useUi((s) => s.canvasUnits)
  // The walls can be selected and dragged with the select tool, in edit mode only.
  const interactive = useUi((s) => s.mode === 'edit' && s.tool === 'select')
  // Measuring Mode of the desktop layout: the walls are only picked and hovered.
  const measuring = useUi((s) => s.mode === 'measure')
  const vp = useViewport()
  const { px, zoom } = vp
  const [hovered, setHovered] = useState<string | null>(null)
  // The face under the pointer on the hovered wall: the span a click would select.
  const [hoverFace, setHoverFace] = useState<{ wallId: string; key: string; side: 'L' | 'R'; from: number; to: number } | null>(null)
  // Label of the measure field that the last pointer move over a wall lit up (Measuring Mode).
  const hoveredField = useRef<{ wallId: string; label: string } | null>(null)
  const geometry = useMemo(() => wallJoinGeometry({ nodes, walls }), [nodes, walls])
  if (!v2 || !walls?.length) return null

  // Every stored wall of the selection group is outlined; the end handles show for ONE wall only.
  const selectedIds = new Set(selectedItems({ selection, multi }).flatMap((s) => (s.kind === 'storedWall' ? [s.wallId] : [])))
  const selected = selection?.kind === 'storedWall' && selectedIds.size === 1 ? selection.wallId : null
  const selectedWall = selected ? (walls ?? []).find((w) => w.id === selected) : undefined
  /** Bearing wall stripes: ~6 px apart (perpendicular), ~1 px wide, at 45°, zoom independent. */
  const stripeGap = px(6)
  const stripeTile = stripeGap * Math.SQRT2
  const propsOf = (w: StoredWall) => ({ type: w.type ?? 'partition', thicknessCm: w.thicknessCm ?? 0, status: w.status })
  const posOf = (id: string): Vec | null => {
    const n = (nodes ?? []).find((x) => x.id === id)
    return n ? { x: n.x, y: n.y } : null
  }
  const endsOf = (w: StoredWall) => ({ a: posOf(w.a), b: posOf(w.b) })
  /** A wall that no room uses: a single wall, or a wall left by a deleted room. */
  const isSingle = (w: StoredWall) => !w.faces.some((f) => f.roomId !== undefined)
  /** Centre line length of a wall, cm. */
  const lengthOf = (w: StoredWall) => {
    const { a, b } = endsOf(w)
    return a && b ? dist(a, b) : 0
  }
  const ariaOf = (w: StoredWall) =>
    `Wall ${w.id}, ${propsOf(w).type}, ${fmtCm(lengthOf(w))} cm${w.locked ? ', locked' : ''}`
  /** Survey label of the measure field of the point under the pointer: a room face, or a facade. */
  const fieldLabelAt = (wall: StoredWall, clientX: number, clientY: number): string | null => {
    const { a, b } = endsOf(wall)
    if (!a || !b) return null
    const p = vp.toWorld(clientX, clientY)
    const doc = useDoc.getState().doc
    const side = sideOfPoint(a, b, p) ?? 'L'
    const face = wallFaceAt(doc, wall.id, side, p)
    return face ? face.label : outsideFaceLabelAtPoint(doc, wall.id, p)
  }

  /** One band, in the style of its wall. */
  const band = (w: StoredWall, points: Vec[]) => {
    const p = propsOf(w)
    const look = wallAppearance(p.type, p.status, renovationView)
    if (!look.visible) return null
    const d = polygonPath(points)
    // 'both': a demolished wall is a dashed red outline with a light red fill; a bearing /
    // exterior one gets the strong warning tone.
    if (look.style === 'demolish') {
      return (
        <g data-renovation="demolish" data-wall-status="demolish">
          <path d={d} pointerEvents="none" className={look.structural ? 'fill-red-500/40' : 'fill-red-500/20'} />
          <path d={d} pointerEvents="none" fill="none" strokeDasharray={`${px(7)} ${px(4)}`}
            strokeWidth={look.structural ? px(2.5) : px(1.5)}
            className={look.structural ? 'stroke-red-700 dark:stroke-red-300' : 'stroke-red-500 dark:stroke-red-400'} />
        </g>
      )
    }
    // 'both': a new wall is green with a diagonal hatch.
    if (look.style === 'new') {
      return (
        <g data-renovation="new" data-wall-status="new">
          <path d={d} pointerEvents="none" className="fill-emerald-200 dark:fill-emerald-800" />
          <path d={d} pointerEvents="none" fill="url(#walls-new-hatch)" />
          <path d={d} pointerEvents="none" fill="none" strokeWidth={px(1)} className="stroke-emerald-700 dark:stroke-emerald-300" />
        </g>
      )
    }
    const bearingHighlight = p.type === 'bearing' && layers.bearingHighlight
    // The two faces of the band: start+ -> end- (the + face) and start- -> end+ (the - face), see
    // wallJoins.WallBand. The corners of the two ends label opposite physical sides.
    const faces = [[points[0], points[3]], [points[1], points[2]]]
    return (
      <g>
        <path d={d} pointerEvents="none" className={bearingHighlight ? 'fill-slate-300 dark:fill-slate-600' : wallClass[p.type]} />
        {bearingHighlight && (
          <>
            <path d={d} pointerEvents="none" fill="url(#walls-bearing-stripes)" />
            <path d={faces.map(polylinePath).join('')} pointerEvents="none" fill="none"
              strokeWidth={px(1)} className={bearingFaceClass} />
          </>
        )}
      </g>
    )
  }

  const byId = new Map((walls ?? []).map((w) => [w.id, w]))

  return (
    <g data-walls="" data-renovation-view={renovationView}>
      <defs>
        <pattern id="walls-bearing-stripes" patternUnits="userSpaceOnUse" width={stripeTile} height={stripeTile} patternTransform="rotate(45)">
          <line x1={stripeTile / 2} y1={0} x2={stripeTile / 2} y2={stripeTile}
            className="stroke-slate-600 dark:stroke-slate-900" strokeOpacity={0.9} strokeWidth={px(1)} />
        </pattern>
        {/* New walls (renovation): green fill + thin diagonal hatch. */}
        <pattern id="walls-new-hatch" patternUnits="userSpaceOnUse" width={stripeTile} height={stripeTile} patternTransform="rotate(45)">
          <line x1={stripeTile / 2} y1={0} x2={stripeTile / 2} y2={stripeTile}
            className="stroke-emerald-700 dark:stroke-emerald-300" strokeOpacity={0.85} strokeWidth={px(1)} />
        </pattern>
      </defs>

      {geometry.bands.map((b) => {
        const wall = byId.get(b.wallId)
        if (!wall) return null
        return (
          <g key={b.wallId} data-wall-band={b.wallId} data-wall-type={propsOf(wall).type}
            data-wall-thickness={propsOf(wall).thicknessCm}>
            {band(wall, b.points)}
          </g>
        )
      })}

      {/* The patch that closes a junction of three or more walls: the style of its thickest wall. */}
      {geometry.patches.map((patch) => {
        const wall = byId.get(patch.wallIds[0])
        if (!wall) return null
        return (
          <g key={'patch' + patch.nodeId} data-wall-patch={patch.nodeId}>
            {band(wall, patch.points)}
          </g>
        )
      })}

      {/* A single wall (no room face) reads like a room wall: its length on the centre line and its
          lock badge, as soon as it is long enough on screen. With the 'Lines' setting the length
          gets the common dimension line (line + ticks) off side A of the band; with 'Text' it
          stays a bare text. The units come from the View menu. */}
      {(walls ?? []).filter(isSingle).map((w) => {
        const { a, b } = endsOf(w)
        if (!a || !b) return null
        if (!wallAppearance(propsOf(w).type, propsOf(w).status, renovationView).visible) return null
        const len = dist(a, b)
        if (len < 1) return null
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
        // The unit normal of side A of the wall (left of a -> b), pointing away from the band.
        const nAx = -uy, nAy = ux
        const thickness = propsOf(w).thicknessCm
        const text = fmtLen(len, units)
        // The dimension line of the wall, on side A, just outside the band.
        const dim = dimStyle === 'lines' && layers.dimensions
          ? dimLine({
            start: a, end: b, normal: { x: nAx, y: nAy }, offsetCm: thickness / 2 + px(10), zoom, text,
          })
          : null
        // The text mode keeps today's rule (a text only above 24 screen px of wall).
        const showText = dim !== null || (dimStyle === 'text' && layers.dimensions && len * zoom >= LENGTH_PX)
        // Text mode: the text itself, a little outside the band on side A.
        const off = thickness / 2 + px(9)
        const mx = (a.x + b.x) / 2 + nAx * off, my = (a.y + b.y) / 2 + nAy * off
        let ang = (Math.atan2(uy, ux) * 180) / Math.PI
        if (ang > 90 || ang < -90) ang += 180
        const s = px(5)
        // The lock goes after the length when both are shown, so the two do not overlap.
        const lockX = showText ? mx + ux * px(34) : mx, lockY = showText ? my + uy * px(34) : my
        return (
          <g key={'single' + w.id} pointerEvents="none" data-single-wall={w.id}>
            {showText && (dim ? (
              /* The common dimension style (dims/DimLineView). The value is calculated, not
                 measured, so it is grey. */
              <g data-single-wall-length={w.id} data-single-wall-dim={w.id}>
                <DimLineView line={dim} text={text} measured={false} kind="wall" dimKey={w.id} />
              </g>
            ) : (
              <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                transform={`rotate(${ang} ${mx} ${my})`} fontSize={px(11)} paintOrder="stroke"
                strokeWidth={px(3)} strokeLinejoin="round" data-single-wall-length={w.id}
                className="fill-slate-600 stroke-[#f6f7f5] dark:fill-slate-300 dark:stroke-[#12161b]">
                {text}
              </text>
            ))}
            {w.locked && (
              <g transform={`translate(${lockX} ${lockY})`} data-single-wall-locked={w.id} aria-hidden="true">
                <rect x={-s} y={-s * 0.2} width={2 * s} height={s * 1.7} rx={s * 0.4}
                  className="fill-slate-700 stroke-white dark:fill-slate-200 dark:stroke-slate-900" strokeWidth={px(1)} />
                <path d={`M ${-s * 0.5} ${-s * 0.2} v ${-s * 0.55} a ${s * 0.5} ${s * 0.5} 0 0 1 ${s} 0 v ${s * 0.55}`}
                  fill="none" className="stroke-slate-700 dark:stroke-slate-200" strokeWidth={px(1.4)} />
              </g>
            )}
          </g>
        )
      })}

      {/* The selected walls: the whole band, in the colour of a selected item. */}
      {selectedIds.size > 0 && geometry.bands.filter((b) => selectedIds.has(b.wallId)).map((b) => {
        const wall = byId.get(b.wallId)
        const look = wall ? wallAppearance(propsOf(wall).type, propsOf(wall).status, renovationView) : null
        if (!look?.visible) return null
        return (
          <path key={'sel' + b.wallId} d={polygonPath(b.points)} pointerEvents="none" strokeOpacity={0.9}
            data-selected-stored-wall={b.wallId} strokeWidth={px(2)}
            className="fill-orange-500/35 stroke-orange-500" />
        )
      })}

      {/* The wall under the pointer: a light band, so the user sees what a click selects. */}
      {interactive && hovered && !selectedIds.has(hovered) && geometry.bands.filter((b) => b.wallId === hovered).map((b) => (
        <path key={'hover' + b.wallId} d={polygonPath(b.points)} pointerEvents="none" data-hover-stored-wall={b.wallId}
          strokeWidth={px(1.5)} strokeOpacity={0.8} className="fill-orange-500/15 stroke-orange-500" />
      ))}

      {/* The face under the pointer: a light line along its span, on its side, so the user sees which
          face a click selects. */}
      {interactive && hoverFace && (() => {
        const wall = byId.get(hoverFace.wallId)
        const { a, b } = wall ? endsOf(wall) : { a: null, b: null }
        if (!wall || !a || !b) return null
        const len = dist(a, b)
        if (len < 1e-6) return null
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
        const k = hoverFace.side === 'L' ? 1 : -1
        const off = propsOf(wall).thicknessCm / 2 + px(2)
        const at = (t: number) => ({ x: a.x + ux * t - uy * off * k, y: a.y + uy * t + ux * off * k })
        const from = at(hoverFace.from), to = at(hoverFace.to)
        return (
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} pointerEvents="none" strokeLinecap="round"
            strokeWidth={px(3)} data-hover-wall-face={hoverFace.key}
            className="stroke-orange-500/60" />
        )
      })()}

      {/* ONE hit area per STORED wall (docs/walls-plan.md, Walls in the interface): the band, plus a
          transparent line of at least 18 px on the centre line, so a thin wall is easy to hit. It is
          drawn above the room floors and under the handles of the tool overlay. The side of the
          click is the half of the wall under the pointer. */}
      {interactive && geometry.bands.map((b) => {
        const wall = byId.get(b.wallId)
        if (!wall) return null
        if (!wallAppearance(propsOf(wall).type, propsOf(wall).status, renovationView).visible) return null
        const { a, b: end } = endsOf(wall)
        const thickness = propsOf(wall).thicknessCm
        return (
          <g key={'hit' + b.wallId} data-wall-hit={b.wallId} data-wall-thickness={thickness}
            data-wall-locked={wall.locked ? '' : undefined}
            aria-label={ariaOf(wall)}
            style={{ cursor: wall.locked ? 'not-allowed' : 'pointer' }}
            onPointerDown={(ev) => onStoredWallDown(ev, vp, b.wallId)}
            onDoubleClick={(ev) => onStoredWallDouble(ev, vp, b.wallId)}
            onPointerEnter={() => setHovered(b.wallId)}
            onPointerMove={(ev) => {
              const pick = wallFaceAtPoint(useDoc.getState().doc, b.wallId, vp.toWorld(ev.clientX, ev.clientY))
              setHoverFace((h) => {
                if (!pick) return h === null ? h : null
                if (h && h.wallId === b.wallId && h.key === pick.key) return h
                return { wallId: b.wallId, key: pick.key, side: pick.side, from: pick.face.from, to: pick.face.to }
              })
            }}
            onPointerLeave={() => {
              setHovered((h) => (h === b.wallId ? null : h))
              setHoverFace((h) => (h && h.wallId === b.wallId ? null : h))
            }}>
            <path d={polygonPath(b.points)} fill="transparent" stroke="none" />
            {a && end && (
              <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke="transparent" strokeLinecap="round"
                strokeWidth={Math.max(thickness, px(HIT_PX))} />
            )}
          </g>
        )
      })}

      {/* Measuring Mode: the same ONE hit area per stored wall. A hover lights up the field of the
          side under the pointer, and a click opens it: the room face of that side, or the outside
          face value ('W12-E') on the outside half of a facade wall. */}
      {measuring && geometry.bands.map((b) => {
        const wall = byId.get(b.wallId)
        if (!wall) return null
        if (!wallAppearance(propsOf(wall).type, propsOf(wall).status, renovationView).visible) return null
        const { a, b: end } = endsOf(wall)
        const thickness = propsOf(wall).thicknessCm
        return (
          <g key={'mhit' + b.wallId} data-measure-wall-hit={b.wallId} aria-label={ariaOf(wall)}
            style={{ cursor: 'pointer' }}
            onPointerMove={(ev) => {
              const label = fieldLabelAt(wall, ev.clientX, ev.clientY)
              if (!label) return
              hoveredField.current = { wallId: wall.id, label }
              if (useUi.getState().hoverLabel !== label) useUi.getState().set({ hoverLabel: label })
            }}
            onPointerLeave={() => {
              const seen = hoveredField.current
              if (!seen || seen.wallId !== wall.id) return
              // A focused field keeps its highlight on the plan.
              if (typeof document !== 'undefined' && document.activeElement?.id === inputId(seen.label)) return
              if (useUi.getState().hoverLabel === seen.label) useUi.getState().set({ hoverLabel: null })
              hoveredField.current = null
            }}
            onPointerDown={(ev) => {
              if (ev.button !== 0 || !ev.isPrimary) return
              const p = vp.toWorld(ev.clientX, ev.clientY)
              const side = sideOfPoint(a ?? p, end ?? p, p) ?? 'L'
              const doc = useDoc.getState().doc
              const face = a && end ? wallFaceAt(doc, wall.id, side, p) : null
              if (face) {
                // The panel opens the card of the room of the clicked side; then its field takes
                // the focus.
                useUi.getState().select({ kind: 'room', roomId: face.roomId })
                focusMeasureField(face.label)
                return
              }
              // A facade wall: the outside half opens its outside face value (W12-E).
              const outside = outsideFaceLabelAtPoint(doc, wall.id, p)
              if (outside) focusMeasureField(outside)
            }}>
            <path d={polygonPath(b.points)} fill="transparent" stroke="none" />
            {a && end && (
              <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke="transparent" strokeLinecap="round"
                strokeWidth={Math.max(thickness, px(HIT_PX))} />
            )}
          </g>
        )
      })}

      {/* A selected single wall shows its two ends: dragging one moves that node, so the wall gets
          longer or shorter on the plan (one undo step per drag). */}
      {interactive && selectedWall && isSingle(selectedWall) && (['a', 'b'] as const).map((end) => {
        const nodeId = end === 'a' ? selectedWall.a : selectedWall.b
        const p = posOf(nodeId)
        if (!p) return null
        return (
          <g key={'end' + end} transform={`translate(${p.x} ${p.y})`} data-wall-end-handle={selectedWall.id + '-' + end}
            aria-label={`End ${end.toUpperCase()} of wall ${selectedWall.id}`}
            style={{ cursor: selectedWall.locked ? 'not-allowed' : 'grab' }}
            onPointerDown={(ev) => onStoredNodeDown(ev, vp, nodeId, selectedWall.id)}>
            {/* The transparent circle is the grab area of the handle (a touch screen needs it). */}
            <circle r={px(11)} fill="transparent" />
            <circle r={px(6)} strokeWidth={px(1.5)} pointerEvents="none"
              className="fill-white stroke-orange-600 dark:fill-slate-900 dark:stroke-orange-300" />
          </g>
        )
      })}
    </g>
  )
}
