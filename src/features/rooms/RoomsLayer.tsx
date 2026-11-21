import { useMemo } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { centroid, fmtCm, roomAreaM2, roomWalls } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import type { Room, Vec } from '../../model/types'
import { selfIntersects } from './crossing'
import { forcedWallStarts, useDragInfo } from './draginfo'
import { selectHole, useActiveHole } from './holes'
import { locked, onRoomDown, onWallDouble, onWallDown } from './interaction'
import { surveyIds } from '../../model/survey'
import { ToastHost } from '../toast'
import { wallProps } from './walls'

const pathOf = (rings: Vec[][]) =>
  rings.map((r) => 'M' + r.map((p) => `${p.x} ${p.y}`).join('L') + 'Z').join('')

const wallClass = {
  exterior: 'stroke-slate-900 dark:stroke-slate-100',
  bearing: 'stroke-slate-900 dark:stroke-slate-100',
  partition: 'stroke-slate-400 dark:stroke-slate-500',
}

/** Draws rooms, walls (bearing/partition/exterior styling), holes, labels, dimensions. */
export function RoomsLayer() {
  const rooms = useDoc((s) => s.doc.rooms)
  const selection = useUi((s) => s.selection)
  const layers = useUi((s) => s.layers)
  const tool = useUi((s) => s.tool)
  const measurements = useDoc((s) => s.doc.measurements)
  const activeHole = useActiveHole()
  const crossing = useMemo(
    () => new Set(rooms.filter((r) => selfIntersects(r.vertices) || r.holes.some(selfIntersects)).map((r) => r.id)),
    [rooms],
  )
  const vp = useViewport()
  const { px, zoom } = vp
  const interactive = tool === 'select'
  const selRoomId = selection && selection.kind !== 'element' ? selection.roomId : null
  const hatch = px(7)
  // Walls attached to the vertex/wall being dragged always show their length (7.2 #22).
  const drag = useDragInfo((s) => s.drag)
  const dragRoom = drag ? rooms.find((r) => r.id === drag.roomId) : undefined
  const forcedWalls = useMemo(() => forcedWallStarts(drag, dragRoom), [drag, dragRoom])

  const label = (r: Room) => {
    const xs = r.vertices.map((v) => v.x), ys = r.vertices.map((v) => v.y)
    const small = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * zoom < 50
    if (small) return null
    const c = centroid(r.vertices)
    return (
      <text key={r.id} x={c.x} y={c.y} textAnchor="middle" pointerEvents="none"
        className="fill-slate-800 dark:fill-slate-100" fontSize={px(14)}>
        <tspan x={c.x} fontWeight={600}>{r.name}</tspan>
        <tspan x={c.x} dy={px(16)} fontSize={px(12)} className="fill-slate-500 dark:fill-slate-400">
          {roomAreaM2(r).toFixed(2).replace('.', ',')} m²
        </tspan>
      </text>
    )
  }

  return (
    <g>
      <ToastHost />
      <defs>
        <pattern id="rooms-bearing-hatch" patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
          <line x1={hatch / 2} y1={0} x2={hatch / 2} y2={hatch} stroke="#fff" strokeOpacity={0.75} strokeWidth={px(1.6)} />
        </pattern>
      </defs>

      {/* fills (holes via evenodd) */}
      {rooms.map((r) => (
        <path
          key={r.id}
          d={pathOf([r.vertices, ...r.holes])}
          fillRule="evenodd"
          className={r.outdoor ? 'fill-emerald-100/80 dark:fill-emerald-900/40' : 'fill-sky-50/90 dark:fill-slate-800/90'}
          pointerEvents={interactive ? 'auto' : 'none'}
          data-room-id={r.id}
          data-room-code={r.code}
          aria-label={`${r.name} (${r.code})`}
          onPointerDown={interactive ? (e) => onRoomDown(e, r.id) : undefined}
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

      {/* walls */}
      {rooms.map((r) => roomWalls(r).map((w) => {
        const p = wallProps(r, w.start.id)
        const t = Math.max(p.thicknessCm, px(1.5))
        const common = { x1: w.start.x, y1: w.start.y, x2: w.end.x, y2: w.end.y, strokeLinecap: 'square' as const, pointerEvents: 'none' as const }
        return (
          <g key={r.id + w.start.id}>
            <line {...common} strokeWidth={t} className={wallClass[p.type]} />
            {p.type === 'bearing' && layers.bearingHighlight && (
              <line {...common} strokeWidth={t} stroke="url(#rooms-bearing-hatch)" />
            )}
          </g>
        )
      }))}

      {/* lock badges on locked walls (7.2 #21) */}
      {rooms.map((r) => roomWalls(r).map((w) => {
        const p = wallProps(r, w.start.id)
        if (!p.locked) return null
        const off = p.thicknessCm / 2 + px(9)
        const mx = (w.start.x + w.end.x) / 2 + w.inward.x * off
        const my = (w.start.y + w.end.y) / 2 + w.inward.y * off
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
      {rooms.filter((r) => r.id === selRoomId).map((r) => (
        <path key={'sel' + r.id} d={pathOf([r.vertices, ...r.holes])} fill="none" pointerEvents="none"
          strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} className="stroke-orange-500" />
      ))}
      {selection?.kind === 'wall' && rooms.filter((r) => r.id === selection.roomId).map((r) =>
        roomWalls(r).filter((w) => w.start.id === selection.wallStart).map((w) => (
          <line key={'selw' + w.start.id} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y}
            strokeLinecap="square" pointerEvents="none" strokeOpacity={0.7}
            strokeWidth={Math.max(wallProps(r, w.start.id).thicknessCm + px(4), px(5))} className="stroke-orange-500" />
        )))}

      {/* labels + dimensions */}
      {rooms.map(label)}
      {layers.dimensions && rooms.map((r) => {
        const labels = new Map(surveyIds(r).filter((x) => x.kind === 'wall').map((x) => [x.wallStart, x.label]))
        return roomWalls(r).map((w) => {
          // Always show lengths of walls attached to the dragged vertex/wall (7.2 #22).
          if (w.length * zoom < 55 && !forcedWalls.has(w.start.id)) return null
          const m = measurements[labels.get(w.start.id) ?? '']
          const verified = !!m && m.actualCm > 0
          const thick = wallProps(r, w.start.id).thicknessCm
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
        // Dragging this wall is blocked when a neighbouring wall is locked (7.2 #21).
        const blocked = locked(r, w.index - 1) || locked(r, w.index + 1)
        return (
          <line key={'hit' + r.id + w.start.id} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y}
            stroke="transparent" strokeLinecap="round" style={{ cursor: blocked ? 'not-allowed' : 'pointer' }}
            strokeWidth={Math.max(p.thicknessCm, px(18))}
            data-wall-label={`${r.code}-${w.index + 1}`}
            data-wall-type={p.type}
            data-wall-length-cm={Math.round(w.length)}
            aria-label={`Wall ${r.code}-${w.index + 1}, ${p.type}, ${fmtCm(w.length)} cm${p.locked ? ', locked' : ''}`}
            onPointerDown={(e) => onWallDown(e, vp, r.id, w.start.id)}
            onDoubleClick={(e) => onWallDouble(e, vp, r.id, w.start.id)} />
        )
      }))}
    </g>
  )
}
