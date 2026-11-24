import { useMemo, useState } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { DEFAULT_WALL_CM, fmtCm, labelPlacement, roomWalls } from '../../model/geometry'
import { selectedItems } from '../../model/selection'
import { useDoc, useUi } from '../../model/store'
import { planPrecision } from '../../model/precision'
import type { Room, Vec } from '../../model/types'
import { selfIntersects } from './crossing'
import { forcedWallStarts, useDragInfo } from './draginfo'
import { selectHole, useActiveHole } from './holes'
import { locked, onRoomDown, onWallDouble, onWallDown } from './interaction'
import { polygonPath, polylinePath, wallFaces, wallQuads } from './wallOutline'
import { gapAreas, multiPath } from './gaps'
import { wallProps } from './walls'
import { piecesPath, renovationRooms, wallAppearance } from '../renovation/logic'
import { useSidebar } from '../../shell/sidebar/store'
import { modeLayerVisible } from '../../shell/view/layers'
import { hoverTarget, storedWallLine } from './hoverTarget'
import { faceByKey, outsideFaceLabelAtPoint, storedWallView } from './wallSides'
import { storedWallOfRoomWall } from '../../model/wallValues'
import { focusMeasureField } from '../measure/focusField'
import { inputId } from '../measure/actions'
import type { Wall } from '../../model/geometry'

/**
 * 'W12-E' when a click in Measuring Mode lands on the OUTSIDE half of a facade wall; null when it
 * lands on the room side, or when the wall has no outside face (the room wall field is used then).
 */
function outsideFaceLabelAt(
  e: { clientX: number; clientY: number },
  vp: { toWorld: (x: number, y: number) => Vec },
  roomId: string,
  wall: Wall,
): string | null {
  const doc = useDoc.getState().doc
  const stored = storedWallOfRoomWall(doc, roomId, wall.start.id)
  if (!stored) return null
  return outsideFaceLabelAtPoint(doc, stored.id, vp.toWorld(e.clientX, e.clientY))
}

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

/**
 * What the plan reads from the stores for the rooms and their walls. Both canvas layers
 * (`RoomsLayer`, below the walls of the wall graph, and `RoomsOverlay`, above them) use it, so
 * they never disagree on a selection, a label position or a hover.
 */
export function useRoomsFrame() {
  const rooms = useDoc((s) => s.doc.rooms)
  const selection = useUi((s) => s.selection)
  const multi = useUi((s) => s.multi)
  const items = useMemo(() => selectedItems({ selection, multi }), [selection, multi])
  const layers = useUi((s) => s.layers)
  const renovationView = useUi((s) => s.renovationView)
  const tool = useUi((s) => s.tool)
  // Survey helpers on the plan: the room codes and the wall numbers. 'auto' shows them while the
  // user works on the survey values (Solve tab, Measuring Mode).
  const tab = useSidebar((s) => s.tab)
  const uiMode = useUi((s) => s.mode)
  const ctx = { tab, mode: uiMode }
  const showCodes = modeLayerVisible(layers, 'roomCodes', ctx)
  const showWallNumbers = modeLayerVisible(layers, 'wallLabels', ctx)
  const measurements = useDoc((s) => s.doc.measurements)
  const storedWalls = useDoc((s) => s.doc.walls)
  const storedNodes = useDoc((s) => s.doc.nodes)
  // Walls are the source of a v2 document: this layer draws the floors, the labels and the ROOM
  // hit areas; the walls come from the wall graph (features/rooms/WallsLayer.tsx), with one hit
  // area per stored wall.
  const wallsFromGraph = useDoc((s) => s.doc.schemaVersion === 2)
  // Element under the pointer in the Solve tab list ('CU-6', 'CU-D', 'SE-1-T', 'W12-E'): shown here.
  const hoverLabel = useUi((s) => s.hoverLabel)
  const hoverDiagonal = useUi((s) => s.hoverDiagonal)
  const hover = useMemo(() => {
    const t = hoverTarget({ rooms, walls: storedWalls, nodes: storedNodes }, hoverLabel, hoverDiagonal?.pair)
    // A pair from another room must not highlight this room's diagonal.
    if (t?.kind === 'diagonal' && hoverDiagonal && hoverDiagonal.roomId !== t.roomId) return null
    return t
  }, [rooms, storedWalls, storedNodes, hoverLabel, hoverDiagonal])
  // A hovered wall with its geometry: the highlight follows the wall thickness.
  const hoverWall = useMemo(() => {
    if (hover?.kind !== 'wall') return null
    const room = rooms.find((r) => r.id === hover.roomId)
    const w = room ? roomWalls(room).find((x) => x.start.id === hover.wallStart) : undefined
    return room && w ? { w, thicknessCm: wallProps(room, w.start.id).thicknessCm } : null
  }, [hover, rooms])
  const step = useDoc((s) => planPrecision(s.doc))
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
    // The code goes in front of the name, so the name line is wider when it is shown.
    const codeW = showCodes ? (d.codes.join(' ').length + 2) * 7.8 : 0
    const nameW = d.name.length * 7.8 + codeW, areaW = 8 * 6.8
    // The margin keeps the text clear of the wall length labels along the inside of walls, when there is room.
    const w = (Math.max(nameW, areaW) + 10) / labelZoom, h = 34 / labelZoom
    return [d.id, labelPlacement(d.pieces[0], w, h, 12 / labelZoom)]
  })), [display, labelZoom, showCodes])
  // Measuring Mode with the canvas (desktop): no geometry edit. A wall or a room is only picked,
  // and the wall under the pointer lights up its field in the measure panel.
  const measuring = uiMode === 'measure'
  const interactive = tool === 'select' && !measuring
  const selectRoomOnly = (e: { button: number; isPrimary: boolean }, roomId: string) => {
    if (e.button !== 0 || !e.isPrimary) return
    useUi.getState().select({ kind: 'room', roomId })
  }
  // Outlined rooms: the room of the selected item, or every room of a room group.
  const selRoomIds = new Set(items.flatMap((s) => (s.kind === 'room' || (s.kind !== 'element' && s === selection) ? [s.roomId] : [])))
  const selWalls = new Set(items.flatMap((s) => (s.kind === 'wall' ? [s.roomId + ':' + s.wallStart] : [])))
  // A selected stored wall ('W12'): the whole wall is highlighted on its centre line, and the side
  // the user clicked is drawn a bit stronger (docs/walls-plan.md, Walls in the interface).
  const selStoredWall = useMemo(() => {
    if (selection?.kind !== 'storedWall') return null
    const line = storedWallLine({ walls: storedWalls, nodes: storedNodes }, selection.wallId)
    if (!line) return null
    const wall = (storedWalls ?? []).find((w) => w.id === selection.wallId)
    // A selected face: its key, its side and its span along the wall (from node a, cm).
    const view = selection.face
      ? storedWallView({ rooms, nodes: storedNodes, walls: storedWalls, measurements }, selection.wallId)
      : null
    const pick = view && selection.face ? faceByKey(view, selection.face) : null
    const face = pick ? { key: pick.key, side: pick.side, from: pick.face.from, to: pick.face.to } : undefined
    return { ...line, thicknessCm: wall?.thicknessCm ?? DEFAULT_WALL_CM, side: face?.side ?? selection.side, face }
  }, [selection, storedWalls, storedNodes, rooms, measurements])
  // Room whose name is being renamed inline: a double-click on the name, or a tool that has just
  // made the room (Make room tool, docs/walls-plan.md phase 6). The editor is drawn by
  // RoomsOverlay, which is the only user of this state.
  const [renaming, setEditing] = useState<string | null>(null)
  const nameEditRoom = useUi((s) => s.nameEditRoom)
  const editing = renaming ?? nameEditRoom
  const closeEditor = () => {
    setEditing(null)
    if (nameEditRoom) useUi.getState().set({ nameEditRoom: null })
  }
  // Walls attached to the vertex/wall being dragged always show their length (7.2 #22).
  const drag = useDragInfo((s) => s.drag)
  const dragRoom = drag ? rooms.find((r) => r.id === drag.roomId) : undefined
  const forcedWalls = useMemo(() => forcedWallStarts(drag, dragRoom), [drag, dragRoom])

  return {
    rooms, selection, layers, renovationView, showCodes, showWallNumbers, measurements, storedWalls, storedNodes,
    wallsFromGraph, hover, hoverWall, hoverLabel, step, activeHole, crossing, display, gapPath, vp, px, zoom,
    labelAt, measuring, interactive, selectRoomOnly, selRoomIds, selWalls, selStoredWall, editing, setEditing,
    closeEditor, forcedWalls,
  }
}

/**
 * Draws, UNDER the walls of the wall graph, the parts of the plan that the walls stand on: the
 * floors, the hole outlines and their hit areas, the walls of a v1 document, the renovation and
 * crossing warnings, and the hit areas of a v1 document. The parts that must stay visible above an
 * opaque wall band (labels, dimensions, hover highlights, the selected side, the name editor) are in
 * features/rooms/RoomsOverlay.tsx, which the app draws AFTER WallsLayer.
 */
export function RoomsLayer() {
  const f = useRoomsFrame()
  const { rooms, layers, renovationView, interactive, measuring, selectRoomOnly, display, gapPath, vp, px, zoom,
    activeHole, crossing, selWalls, forcedWalls, wallsFromGraph } = f
  // Bearing wall stripes: ~6 px apart (perpendicular), ~1 px wide, at 45°, zoom independent.
  // A 45° pattern tile of `tile` repeats its lines every tile / sqrt(2).
  const stripeGap = px(6)
  const stripeTile = stripeGap * Math.SQRT2
  /** Mitered wall outlines; wall faces sit half a thickness away, with a 1.5 px floor. */
  const quadsOf = (r: Room) =>
    wallQuads(r, (startId) => Math.max(wallProps(r, startId).thicknessCm, px(1.5)) / 2)

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
          pointerEvents={interactive || measuring ? 'auto' : 'none'}
          style={interactive ? { cursor: 'move' } : measuring ? { cursor: 'pointer' } : undefined}
          data-room-id={d.id}
          data-room-ids={d.roomIds.join(' ')}
          data-room-code={d.codes[0]}
          data-renovation-merged={d.merged ? 'true' : undefined}
          aria-label={d.merged ? `${d.name} (merged: ${d.codes.join(', ')})` : `${d.name} (${d.codes[0]})`}
          onPointerDown={interactive ? (e) => onRoomDown(e, d.id, vp) : measuring && !d.merged ? (e) => selectRoomOnly(e, d.id) : undefined}
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

      {/* walls: mitered polygons, so corners join cleanly at any angle. A v2 document draws its
          walls once, from the wall graph (features/rooms/WallsLayer.tsx). */}
      {!wallsFromGraph && rooms.map((r) => quadsOf(r).map((q) => {
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

      {/* lock badges on locked walls of a v1 document (7.2 #21) */}
      {!wallsFromGraph && rooms.map((r) => roomWalls(r).map((w) => {
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

      {/* selection highlight of the walls of a v1 document */}
      {selWalls.size > 0 && rooms.map((r) =>
        quadsOf(r).filter((q) => selWalls.has(r.id + ':' + q.startId)).map((q) => (
          <path key={'selw' + r.id + q.startId} d={polygonPath(q.points)} pointerEvents="none" strokeOpacity={0.9}
            data-selected-wall={r.id + ':' + q.startId}
            strokeWidth={px(2)} className="fill-orange-500/35 stroke-orange-500" />
        )))}

      {/* wall hit areas (select tool only, v1 documents). A v2 document has ONE hit area per
          stored wall, in features/rooms/WallsLayer.tsx: a wall is never selected by two systems,
          and a wall that no room uses (a single wall) is selectable there. Double click (add a
          vertex to the room of the clicked side) and Shift + click (group of room walls of that
          side) are handled by the same hit area there. */}
      {interactive && !wallsFromGraph && rooms.map((r) => roomWalls(r).map((w) => {
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

      {/* Measuring Mode of a v1 document: one hover + pick line per room wall. A v2 document has
          ONE hit area per stored wall (features/rooms/WallsLayer.tsx), so a shared wall is not
          covered by two lines and both of its sides can be picked. */}
      {measuring && !wallsFromGraph && rooms.map((r) => roomWalls(r).map((w) => {
        const p = wallProps(r, w.start.id)
        if (!wallAppearance(p.type, p.status, renovationView).visible) return null
        const wallLabel = `${r.code}-${w.index + 1}`
        return (
          <line key={'mhit' + r.id + w.start.id} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y}
            stroke="transparent" strokeLinecap="round" style={{ cursor: 'pointer' }}
            strokeWidth={Math.max(p.thicknessCm, px(18))}
            data-wall-label={wallLabel}
            data-measure-wall-hit=""
            aria-label={`Wall ${wallLabel}, ${fmtCm(w.length)} cm`}
            onPointerEnter={() => useUi.getState().set({ hoverLabel: wallLabel })}
            onPointerLeave={() => {
              // A focused field keeps its highlight on the plan.
              if (typeof document !== 'undefined' && document.activeElement?.id === inputId(wallLabel)) return
              if (useUi.getState().hoverLabel === wallLabel) useUi.getState().set({ hoverLabel: null })
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || !e.isPrimary) return
              // The panel opens the card of the room; then the field takes the focus.
              useUi.getState().select({ kind: 'room', roomId: r.id })
              // A facade wall: a click on its OUTSIDE half opens the outside face field (W12-E).
              // The room side, and every other wall, opens the room wall field.
              const outside = outsideFaceLabelAt(e, vp, r.id, w)
              focusMeasureField(outside ?? wallLabel)
            }} />
        )
      }))}
    </g>
  )
}
