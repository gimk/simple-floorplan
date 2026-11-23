import { useMemo, useState } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { fmtCm, labelPlacement, labelPoint, roomWalls } from '../../model/geometry'
import { selectedItems } from '../../model/selection'
import { useDoc, useUi } from '../../model/store'
import type { Room, Vec } from '../../model/types'
import { selfIntersects } from './crossing'
import { forcedWallStarts, useDragInfo } from './draginfo'
import { selectHole, useActiveHole } from './holes'
import { locked, onRoomDown, onWallDouble, onWallDown } from './interaction'
import { surveyIds } from '../../model/survey'
import { polygonPath, polylinePath, wallFaces, wallQuads } from './wallOutline'
import { gapAreas, multiPath } from './gaps'
import { RoomNameEditor } from './RoomNameEditor'
import { wallProps } from './walls'
import { piecesPath, renovationRooms, wallAppearance, type DisplayRoom } from '../renovation/logic'

const pathOf = (rings: Vec[][]) =>
  rings.map((r) => 'M' + r.map((p) => `${p.x} ${p.y}`).join('L') + 'Z').join('')

/** Solid walls (exterior, and bearing walls when the highlight layer is off). */
const solidClass = 'fill-slate-900 dark:fill-slate-100'

const wallClass = {
  exterior: solidClass,
  bearing: solidClass,
  partition: 'fill-slate-400 dark:fill-slate-500',
}

/** Bearing walls with the highlight layer on: light tone + thin dark diagonal stripes. */
const bearingFaceClass = 'stroke-slate-500 dark:stroke-slate-400'

/** Draws rooms, walls (bearing/partition/exterior styling), holes, labels, dimensions. */
export function RoomsLayer() {
  const rooms = useDoc((s) => s.doc.rooms)
  const selection = useUi((s) => s.selection)
  const multi = useUi((s) => s.multi)
  const items = useMemo(() => selectedItems({ selection, multi }), [selection, multi])
  const layers = useUi((s) => s.layers)
  const renovationView = useUi((s) => s.renovationView)
  const tool = useUi((s) => s.tool)
  const measurements = useDoc((s) => s.doc.measurements)
  const activeHole = useActiveHole()
  const crossing = useMemo(
    () => new Set(rooms.filter((r) => selfIntersects(r.vertices) || r.holes.some(selfIntersects)).map((r) => r.id)),
    [rooms],
  )
  // Before / After / Both renovation view: 'after' shows rooms separated only by a
  // demolished wall as one room (merged outline, display only).
  const display = useMemo(() => renovationRooms({ rooms }, renovationView), [rooms, renovationView])
  // Space between rooms (wall mass, shafts): light tone with a diagonal hatch.
  const gapPath = useMemo(() => multiPath(gapAreas(rooms)), [rooms])
  const vp = useViewport()
  const { px, zoom } = vp
  // Room name positions: where the whole text box fits inside the room (not the centroid, which
  // can be outside an L shape or next to a corridor wall); turned in narrow corridors.
  // Zoom is rounded to steps of ~19 % so a wheel zoom does not recompute every frame.
  const labelZoom = 2 ** (Math.round(Math.log2(zoom) * 4) / 4)
  const labelAt = useMemo(() => new Map(display.map((d) => {
    const nameW = d.name.length * 7.8, areaW = 8 * 6.8
    // The margin keeps the text clear of the wall length labels along the inside of walls, when there is room.
    const w = (Math.max(nameW, areaW) + 10) / labelZoom, h = 34 / labelZoom
    return [d.id, labelPlacement(d.pieces[0], w, h, 12 / labelZoom)]
  })), [display, labelZoom])
  const interactive = tool === 'select'
  // Outlined rooms: the room of the selected item, or every room of a room group.
  const selRoomIds = new Set(items.flatMap((s) => (s.kind === 'room' || (s.kind !== 'element' && s === selection) ? [s.roomId] : [])))
  const selWalls = new Set(items.flatMap((s) => (s.kind === 'wall' ? [s.roomId + ':' + s.wallStart] : [])))
  // Bearing wall stripes: ~6 px apart (perpendicular), ~1 px wide, at 45°, zoom independent.
  // A 45° pattern tile of `tile` repeats its lines every tile / sqrt(2).
  const stripeGap = px(6)
  const stripeTile = stripeGap * Math.SQRT2
  // Room whose name is being renamed inline.
  const [editing, setEditing] = useState<string | null>(null)
  // Walls attached to the vertex/wall being dragged always show their length (7.2 #22).
  const drag = useDragInfo((s) => s.drag)
  const dragRoom = drag ? rooms.find((r) => r.id === drag.roomId) : undefined
  const forcedWalls = useMemo(() => forcedWallStarts(drag, dragRoom), [drag, dragRoom])
  /** Mitered wall outlines; wall faces sit half a thickness away, with a 1.5 px floor. */
  const quadsOf = (r: Room) =>
    wallQuads(r, (startId) => Math.max(wallProps(r, startId).thicknessCm, px(1.5)) / 2)

  const label = (d: DisplayRoom) => {
    // The room being renamed shows the inline editor instead (drawn last, above the hit areas).
    if (!d.merged && editing === d.id) return null
    const ring = d.pieces[0]?.[0] ?? []
    if (ring.length < 3) return null
    const xs = ring.map((v) => v.x), ys = ring.map((v) => v.y)
    const small = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * zoom < 50
    if (small) return null
    const place = labelAt.get(d.id) ?? { p: labelPoint(d.pieces[0]), vertical: false }
    // Baseline of the name a bit above the point, so the two lines are centred on it.
    const c = { x: place.p.x, y: place.p.y - px(4) }
    return (
      <text key={d.id} x={c.x} y={c.y} textAnchor="middle" data-label-vertical={place.vertical ? '' : undefined}
        transform={place.vertical ? `rotate(-90 ${place.p.x} ${place.p.y})` : undefined} pointerEvents={interactive ? 'auto' : 'none'}
        className="fill-slate-800 dark:fill-slate-100" fontSize={px(14)}>
        <tspan x={c.x} fontWeight={600} style={interactive ? { cursor: 'text' } : undefined}
          onPointerDown={interactive ? (e) => onRoomDown(e, d.id, vp) : undefined}
          onDoubleClick={interactive && !d.merged ? (e) => { e.stopPropagation(); setEditing(d.id) } : undefined}>
          {d.name}
        </tspan>
        <tspan x={c.x} dy={px(16)} fontSize={px(12)} pointerEvents="none" className="fill-slate-500 dark:fill-slate-400">
          {d.areaM2.toFixed(2).replace('.', ',')} m²
        </tspan>
      </text>
    )
  }

  return (
    <g data-renovation-view={renovationView}>
      <defs>
        <pattern id="rooms-bearing-stripes" patternUnits="userSpaceOnUse" width={stripeTile} height={stripeTile} patternTransform="rotate(45)">
          <line x1={stripeTile / 2} y1={0} x2={stripeTile / 2} y2={stripeTile}
            className="stroke-slate-600 dark:stroke-slate-900" strokeOpacity={0.9} strokeWidth={px(1)} />
        </pattern>
        {/* New walls (renovation): green fill + thin diagonal hatch. */}
        <pattern id="rooms-new-hatch" patternUnits="userSpaceOnUse" width={stripeTile} height={stripeTile} patternTransform="rotate(45)">
          <line x1={stripeTile / 2} y1={0} x2={stripeTile / 2} y2={stripeTile}
            className="stroke-emerald-700 dark:stroke-emerald-300" strokeOpacity={0.85} strokeWidth={px(1)} />
        </pattern>
        {/* Space between rooms: light diagonal hatch, other direction than the bearing stripes. */}
        <pattern id="rooms-gap-hatch" patternUnits="userSpaceOnUse" width={stripeTile} height={stripeTile} patternTransform="rotate(-45)">
          <line x1={stripeTile / 2} y1={0} x2={stripeTile / 2} y2={stripeTile}
            className="stroke-slate-400 dark:stroke-slate-500" strokeOpacity={0.7} strokeWidth={px(1)} />
        </pattern>
      </defs>

      {gapPath && (
        <g pointerEvents="none" data-room-gaps="">
          <path d={gapPath} fillRule="evenodd" className="fill-slate-200 dark:fill-slate-700" />
          <path d={gapPath} fillRule="evenodd" fill="url(#rooms-gap-hatch)" />
        </g>
      )}

      {/* fills (holes via evenodd); rooms merged by a demolished wall are drawn as one */}
      {display.map((d) => (
        <path
          key={d.id}
          d={piecesPath(d.pieces)}
          fillRule="evenodd"
          className={d.outdoor ? 'fill-emerald-100/80 dark:fill-emerald-900/40' : 'fill-sky-50/90 dark:fill-slate-800/90'}
          pointerEvents={interactive ? 'auto' : 'none'}
          style={interactive ? { cursor: 'move' } : undefined}
          data-room-id={d.id}
          data-room-ids={d.roomIds.join(' ')}
          data-room-code={d.codes[0]}
          data-renovation-merged={d.merged ? 'true' : undefined}
          aria-label={d.merged ? `${d.name} (merged: ${d.codes.join(', ')})` : `${d.name} (${d.codes[0]})`}
          onPointerDown={interactive ? (e) => onRoomDown(e, d.id, vp) : undefined}
        />
      ))}

      {/* hole outlines */}
      {rooms.map((r) => r.holes.map((h, i) => (
        <path key={r.id + 'h' + i} d={pathOf([h])} fill="none" strokeWidth={px(2)} pointerEvents="none"
          className="stroke-slate-700 dark:stroke-slate-300" />
      )))}

      {/* holes: click inside to select */}
      {interactive && rooms.map((r) => r.holes.map((h, i) => (
        <path key={r.id + 'hh' + i} d={pathOf([h])} fill="transparent" style={{ cursor: 'pointer' }}
          onPointerDown={(e) => { if (e.button !== 0 || !e.isPrimary) return; e.stopPropagation(); selectHole(r.id, i) }} />
      )))}
      {activeHole && rooms.filter((r) => r.id === activeHole.roomId).map((r) => (
        <path key={'selh' + r.id} d={pathOf([r.holes[activeHole.holeIndex]])} fill="rgba(249,115,22,0.15)" pointerEvents="none"
          strokeWidth={px(2.5)} strokeDasharray={`${px(6)} ${px(4)}`} className="stroke-orange-500" />
      ))}

      {/* walls: mitered polygons, so corners join cleanly at any angle */}
      {rooms.map((r) => quadsOf(r).map((q) => {
        const p = wallProps(r, q.startId)
        const look = wallAppearance(p.type, p.status, renovationView)
        if (!look.visible) return null
        const d = polygonPath(q.points)
        // 'both': a demolished wall is a dashed red outline with a light red fill; a
        // bearing / exterior one gets the strong warning tone.
        if (look.style === 'demolish') {
          return (
            <g key={r.id + q.startId} data-renovation="demolish" data-wall-status="demolish">
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
            <g key={r.id + q.startId} data-renovation="new" data-wall-status="new">
              <path d={d} pointerEvents="none" className="fill-emerald-200 dark:fill-emerald-800" />
              <path d={d} pointerEvents="none" fill="url(#rooms-new-hatch)" />
              <path d={d} pointerEvents="none" fill="none" strokeWidth={px(1)} className="stroke-emerald-700 dark:stroke-emerald-300" />
            </g>
          )
        }
        const bearingHighlight = p.type === 'bearing' && layers.bearingHighlight
        return (
          <g key={r.id + q.startId}>
            <path d={d} pointerEvents="none" className={bearingHighlight ? 'fill-slate-300 dark:fill-slate-600' : wallClass[p.type]} />
            {bearingHighlight && (
              <>
                <path d={d} pointerEvents="none" fill="url(#rooms-bearing-stripes)" />
                <path d={wallFaces(q).map(polylinePath).join('')} pointerEvents="none" fill="none"
                  strokeWidth={px(1)} className={bearingFaceClass} />
              </>
            )}
          </g>
        )
      }))}

      {/* lock badges on locked walls (7.2 #21) */}
      {rooms.map((r) => roomWalls(r).map((w) => {
        const p = wallProps(r, w.start.id)
        if (!p.locked) return null
        if (!wallAppearance(p.type, p.status, renovationView).visible) return null
        const off = p.thicknessCm / 2 + px(9)
        const dimShown = layers.dimensions && (w.length * zoom >= 55 || forcedWalls.has(w.start.id))
        const tan = dimShown ? px(32) : 0
        const mx = (w.start.x + w.end.x) / 2 + w.inward.x * off + w.dir.x * tan
        const my = (w.start.y + w.end.y) / 2 + w.inward.y * off + w.dir.y * tan
        const s = px(5)
        return (
          <g key={'lock' + r.id + w.start.id} transform={`translate(${mx} ${my})`}
            pointerEvents="none" data-wall-locked={w.start.id} aria-hidden="true">
            <rect x={-s} y={-s * 0.2} width={2 * s} height={s * 1.7} rx={s * 0.4}
              className="fill-slate-700 stroke-white dark:fill-slate-200 dark:stroke-slate-900" strokeWidth={px(1)} />
            <path d={`M ${-s * 0.5} ${-s * 0.2} v ${-s * 0.55} a ${s * 0.5} ${s * 0.5} 0 0 1 ${s} 0 v ${s * 0.55}`}
              fill="none" className="stroke-slate-700 dark:stroke-slate-200" strokeWidth={px(1.4)} />
          </g>
        )
      }))}

      {rooms.filter((r) => crossing.has(r.id)).map((r) => (
        <path key={'bad' + r.id} d={pathOf([r.vertices, ...r.holes])} fill="none" pointerEvents="none"
          strokeWidth={px(3)} className="stroke-red-500" />
      ))}

      {/* selection highlight */}
      {rooms.filter((r) => selRoomIds.has(r.id)).map((r) => (
        <path key={'sel' + r.id} d={pathOf([r.vertices, ...r.holes])} fill="none" pointerEvents="none"
          data-selected-room={r.id}
          strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} className="stroke-orange-500" />
      ))}
      {selWalls.size > 0 && rooms.map((r) =>
        quadsOf(r).filter((q) => selWalls.has(r.id + ':' + q.startId)).map((q) => (
          <path key={'selw' + r.id + q.startId} d={polygonPath(q.points)} pointerEvents="none" strokeOpacity={0.9}
            data-selected-wall={r.id + ':' + q.startId}
            strokeWidth={px(2)} className="fill-orange-500/35 stroke-orange-500" />
        )))}

      {/* labels + dimensions */}
      {display.map(label)}
      {layers.dimensions && rooms.map((r) => {
        const labels = new Map(surveyIds(r).filter((x) => x.kind === 'wall').map((x) => [x.wallStart, x.label]))
        return roomWalls(r).map((w) => {
          // Always show lengths of walls attached to the dragged vertex/wall (7.2 #22).
          if (w.length * zoom < 55 && !forcedWalls.has(w.start.id)) return null
          const m = measurements[labels.get(w.start.id) ?? '']
          const verified = !!m && m.actualCm > 0
          const dimProps = wallProps(r, w.start.id)
          if (!wallAppearance(dimProps.type, dimProps.status, renovationView).visible) return null
          const thick = dimProps.thicknessCm
          const off = thick / 2 + px(10)
          const mx = (w.start.x + w.end.x) / 2 + w.inward.x * off, my = (w.start.y + w.end.y) / 2 + w.inward.y * off
          let ang = (Math.atan2(w.dir.y, w.dir.x) * 180) / Math.PI
          if (ang > 90 || ang < -90) ang += 180
          return (
            <text key={'d' + r.id + w.start.id} x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
              transform={`rotate(${ang} ${mx} ${my})`} fontSize={px(11)} pointerEvents="none" paintOrder="stroke"
              strokeWidth={px(3)} strokeLinejoin="round" fontWeight={verified ? 600 : undefined}
              className={`stroke-[#f6f7f5] dark:stroke-[#12161b] ${verified ? 'fill-emerald-700 dark:fill-emerald-400' : 'fill-slate-600 dark:fill-slate-300'}`}>
              {verified ? `✓ ${fmtCm(m.actualCm)}` : fmtCm(w.length)}
            </text>
          )
        })
      })}

      {/* wall hit areas (select tool only) */}
      {interactive && rooms.map((r) => roomWalls(r).map((w) => {
        const p = wallProps(r, w.start.id)
        // A wall hidden by the renovation view cannot be selected.
        if (!wallAppearance(p.type, p.status, renovationView).visible) return null
        // Dragging this wall is blocked when a neighbouring wall is locked (7.2 #21).
        const blocked = locked(r, w.index - 1) || locked(r, w.index + 1)
        return (
          <line key={'hit' + r.id + w.start.id} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y}
            stroke="transparent" strokeLinecap="round" style={{ cursor: blocked ? 'not-allowed' : 'pointer' }}
            strokeWidth={Math.max(p.thicknessCm, px(18))}
            data-wall-label={`${r.code}-${w.index + 1}`}
            data-wall-type={p.type}
            data-wall-status={p.status ?? 'existing'}
            data-wall-length-cm={Math.round(w.length)}
            aria-label={`Wall ${r.code}-${w.index + 1}, ${p.type}, ${fmtCm(w.length)} cm${p.locked ? ', locked' : ''}`}
            onPointerDown={(e) => onWallDown(e, vp, r.id, w.start.id)}
            onDoubleClick={(e) => onWallDouble(e, vp, r.id, w.start.id)} />
        )
      }))}

      {/* inline room rename editor: topmost, so no hit area can steal its clicks */}
      {rooms.filter((r) => r.id === editing).map((r) => (
        <RoomNameEditor key={'edit' + r.id} room={r} vp={vp} onClose={() => setEditing(null)} />
      ))}
    </g>
  )
}
