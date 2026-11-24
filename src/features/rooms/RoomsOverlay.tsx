// The overlays of the plan: every part of the room layer that must stay ABOVE the walls of the
// wall graph (docs/walls-plan.md, "Walls in the interface").
//
// A wall band is an opaque shape, so a room label, a dimension text, a wall number badge, a hover
// highlight, the side lines of the selected wall or the inline room name editor drawn UNDER the
// bands would be hidden (UI review F1). The app draws this layer after WallsLayer, so the bands
// never cover them. Only the room floors, the hole hit areas and the walls of a v1 document stay
// under the walls (features/rooms/RoomsLayer.tsx).
import { dist, fmtCm, innerWallLengths, labelPoint, roomWalls } from '../../model/geometry'
import { surveyIds } from '../../model/survey'
import { measuredText, shownLength } from '../../model/precision'
import { onRoomDown } from './interaction'
import { RoomNameEditor } from './RoomNameEditor'
import { useRoomsFrame } from './RoomsLayer'
import { wallProps } from './walls'
import { wallAppearance } from '../renovation/logic'
import { wallAlignOffsetCm } from './wallSides'

/** A wall number badge, in the colours of a selected wall, or of a normal one. */
const badgeClass = {
  strong: 'fill-orange-500 stroke-orange-700 dark:stroke-orange-300',
  weak: 'fill-orange-200 stroke-orange-500 dark:stroke-orange-400',
  none: 'fill-white/90 stroke-slate-400 dark:fill-slate-800/95 dark:stroke-slate-500',
}

const badgeTextClass = {
  strong: 'fill-white',
  weak: 'fill-orange-900',
  none: 'fill-slate-600 dark:fill-slate-300',
}

export function RoomsOverlay() {
  const f = useRoomsFrame()
  const {
    rooms, selection, layers, renovationView, showCodes, showWallNumbers, measurements, storedWalls, hover,
    hoverWall, hoverLabel, step, display, vp, px, zoom, labelAt, interactive, selRoomIds, selWalls, selStoredWall,
    editing, setEditing, closeEditor, forcedWalls,
  } = f

  const label = (d: (typeof display)[number]) => {
    // The room being renamed shows the inline editor instead (drawn last, above the hit areas).
    if (!d.merged && editing === d.id) return null
    const ring = d.pieces[0]?.[0] ?? []
    if (ring.length < 3) return null
    // Room code in front of the name, so the survey IDs of the Solve tab are found on the plan.
    const code = showCodes ? d.codes.join(' ') : ''
    const xs = ring.map((v) => v.x), ys = ring.map((v) => v.y)
    const small = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * zoom < 50
    if (small) {
      // No room for the name: the code alone, small, is better than nothing.
      if (!code) return null
      const p = labelAt.get(d.id)?.p ?? labelPoint(d.pieces[0])
      return (
        <text key={d.id} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={px(10)}
          fontWeight={700} pointerEvents="none" data-room-code-only={d.id}
          className="fill-slate-500 font-mono dark:fill-slate-400">
          {code}
        </text>
      )
    }
    const place = labelAt.get(d.id) ?? { p: labelPoint(d.pieces[0]), vertical: false }
    // Baseline of the name a bit above the point, so the two lines are centred on it.
    const c = { x: place.p.x, y: place.p.y - px(4) }
    return (
      <text key={d.id} x={c.x} y={c.y} textAnchor="middle" data-label-vertical={place.vertical ? '' : undefined}
        transform={place.vertical ? `rotate(-90 ${place.p.x} ${place.p.y})` : undefined} pointerEvents={interactive ? 'auto' : 'none'}
        className="fill-slate-800 dark:fill-slate-100" fontSize={px(14)}>
        <tspan x={c.x} fontWeight={600} data-room-label={d.id} style={interactive ? { cursor: 'text' } : undefined}
          onPointerDown={interactive ? (e) => onRoomDown(e, d.id, vp) : undefined}
          onDoubleClick={interactive && !d.merged ? (e) => { e.stopPropagation(); setEditing(d.id) } : undefined}>
          {code !== '' && (
            <tspan fontWeight={700} className="font-mono" data-room-code-text={d.codes[0]}>{`${code}  `}</tspan>
          )}
          {d.name}
        </tspan>
        <tspan x={c.x} dy={px(16)} fontSize={px(12)} pointerEvents="none" className="fill-slate-500 dark:fill-slate-400">
          {d.areaM2.toFixed(2).replace('.', ',')} m²
        </tspan>
      </text>
    )
  }

  /** The side lines of the selected stored wall, and its A / B markers. */
  const selectedWallSide = (() => {
    if (!selStoredWall) return null
    const { a, b, thicknessCm, side, face: picked } = selStoredWall
    const len = dist(a, b)
    const ux = len > 0 ? (b.x - a.x) / len : 0, uy = len > 0 ? (b.y - a.y) / len : 0
    // Left of a -> b is (-uy, ux): that is side L, the side the wall card calls side A.
    const off = thicknessCm / 2 + px(2)
    const face = (k: 1 | -1) => ({
      x1: a.x - uy * off * k, y1: a.y + ux * off * k, x2: b.x - uy * off * k, y2: b.y + ux * off * k,
    })
    // A selected face: both sides stay weak, and only the span of the face gets the strong line.
    const weight = (s: 'L' | 'R') => (!picked && (side === undefined || side === s) ? px(3) : px(1.5))
    const strongSide = (s: 'L' | 'R') => !picked && side === s
    const faceLine = picked && (() => {
      const k = picked.side === 'L' ? 1 : -1
      const x = (t: number) => a.x + ux * t - uy * off * k, y = (t: number) => a.y + uy * t + ux * off * k
      return { x1: x(picked.from), y1: y(picked.from), x2: x(picked.to), y2: y(picked.to) }
    })()
    const wall = (storedWalls ?? []).find((w) => w.id === selStoredWall.wallId)
    // "In line on": the dotted line of the side (A, centre or B) that lines up with the walls that
    // continue this one, so the choice of the wall card is visible on the plan.
    const alignOff = wallAlignOffsetCm(wall?.align, thicknessCm)
    const align = {
      x1: a.x - uy * alignOff, y1: a.y + ux * alignOff, x2: b.x - uy * alignOff, y2: b.y + ux * alignOff,
    }
    // A and B markers: the letters of the two sides of the wall card, outside the band and at the
    // same size at every zoom (px), so the user can match the card to the plan.
    const markOff = thicknessCm / 2 + px(12)
    const marker = (k: 1 | -1, letter: 'A' | 'B') => {
      const onSide = letter === 'A' ? 'L' : 'R'
      const active = side === onSide
      const x = (a.x + b.x) / 2 - uy * markOff * k, y = (a.y + b.y) / 2 + ux * markOff * k
      return (
        <g key={letter} transform={`translate(${x} ${y})`} data-wall-side-marker={letter}
          data-wall-side-marker-active={active ? '' : undefined} aria-hidden="true" pointerEvents="none">
          <circle r={px(8)} strokeWidth={px(1)}
            className={active
              ? 'fill-orange-600 stroke-orange-700 dark:stroke-orange-300'
              : 'fill-white stroke-orange-500 dark:fill-slate-900'} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={px(10)} fontWeight={700}
            className={active ? 'fill-white' : 'fill-orange-700 dark:fill-orange-300'}>{letter}</text>
        </g>
      )
    }
    return (
      <g data-selected-wall-side={side ?? ''} data-wall-side-of={selStoredWall.wallId}>
        <g pointerEvents="none">
          <line {...face(1)} strokeLinecap="round" strokeWidth={weight('L')}
            className={strongSide('L') ? 'stroke-orange-600 dark:stroke-orange-300' : 'stroke-orange-500/70'} />
          <line {...face(-1)} strokeLinecap="round" strokeWidth={weight('R')}
            className={strongSide('R') ? 'stroke-orange-600 dark:stroke-orange-300' : 'stroke-orange-500/70'} />
          {faceLine && (
            <line {...faceLine} strokeLinecap="round" strokeWidth={px(3)} data-selected-wall-face={picked!.key}
              className="stroke-orange-600 dark:stroke-orange-300" />
          )}
        </g>
        <line {...align} pointerEvents="none" strokeWidth={px(2)} strokeLinecap="round"
          strokeDasharray={`${px(2)} ${px(4)}`} data-wall-align-line={selStoredWall.wallId}
          data-align={wall?.align ?? 'room'} className="stroke-sky-600 dark:stroke-sky-400" />
        {marker(1, 'A')}
        {marker(-1, 'B')}
      </g>
    )
  })()

  /** Strong when the face is on the side the user clicked, weak when it is on the other side. */
  const wallNumberHighlight = (roomId: string, wallStart: string): 'strong' | 'weak' | null => {
    if (selection?.kind !== 'storedWall') return null
    const wall = (storedWalls ?? []).find((w) => w.id === selection.wallId)
    const face = wall?.faces.find((x) => x.roomId === roomId && x.wallStart === wallStart)
    if (!face) return null
    // A selected face: only that room face is strong, the other faces of the wall are weak.
    if (selection.face !== undefined) return selection.face === `room:${roomId}:${wallStart}` ? 'strong' : 'weak'
    return selection.side === undefined || selection.side === face.side ? 'strong' : 'weak'
  }

  return (
    <g data-rooms-overlay="">
      {/* selection highlight of a room: drawn above the walls, so the dashes stay visible */}
      {rooms.filter((r) => selRoomIds.has(r.id)).map((r) => (
        <path key={'sel' + r.id} d={[r.vertices, ...r.holes].map((ring) => 'M' + ring.map((p) => `${p.x} ${p.y}`).join('L') + 'Z').join('')}
          fill="none" pointerEvents="none"
          data-selected-room={r.id}
          strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} className="stroke-orange-500" />
      ))}

      {selectedWallSide}

      {/* hover highlight: the element of the survey label under the pointer in the Solve tab list
          (and in Measuring Mode). It takes no pointer event. */}
      {hoverWall && (
        <line x1={hoverWall.w.start.x} y1={hoverWall.w.start.y} x2={hoverWall.w.end.x} y2={hoverWall.w.end.y}
          pointerEvents="none" strokeLinecap="round" data-hover-highlight="wall" data-hover-label={hoverLabel ?? ''}
          strokeWidth={Math.max(hoverWall.thicknessCm, px(10)) + px(4)}
          className="stroke-orange-500/40 dark:stroke-orange-400/45" />
      )}
      {hover?.kind === 'storedWall' && (
        <g pointerEvents="none" data-hover-highlight="stored-wall" data-hover-label={hover.label}>
          {/* Centre line of the stored wall: the line the two values of the wall are measured on. */}
          <line x1={hover.a.x} y1={hover.a.y} x2={hover.b.x} y2={hover.b.y}
            strokeWidth={px(12)} strokeLinecap="round"
            className="stroke-orange-500/35 dark:stroke-orange-400/40" />
          <line x1={hover.a.x} y1={hover.a.y} x2={hover.b.x} y2={hover.b.y}
            strokeWidth={px(2)} strokeLinecap="round" strokeDasharray={hover.outside ? `${px(9)} ${px(5)}` : undefined}
            className="stroke-orange-500/90 dark:stroke-orange-400/90" />
          <text x={(hover.a.x + hover.b.x) / 2} y={(hover.a.y + hover.b.y) / 2}
            textAnchor="middle" dominantBaseline="middle" fontSize={px(12)} fontWeight={600}
            strokeWidth={px(3)} paintOrder="stroke" strokeLinejoin="round" data-hover-length={hover.label}
            className="fill-orange-700 stroke-white dark:fill-orange-200 dark:stroke-slate-900">
            {hover.outside ? 'outside ' : ''}{fmtCm(dist(hover.a, hover.b))} cm
          </text>
        </g>
      )}
      {hover?.kind === 'diagonal' && (
        <g pointerEvents="none" data-hover-highlight="diagonal" data-hover-label={hover.label}>
          <line x1={hover.a.x} y1={hover.a.y} x2={hover.b.x} y2={hover.b.y}
            strokeWidth={px(3)} strokeLinecap="round" strokeDasharray={`${px(8)} ${px(5)}`}
            className="stroke-orange-500/90 dark:stroke-orange-400/90" />
          {/* Planned length of the diagonal: what the tape should read on site. */}
          <text x={(hover.a.x + hover.b.x) / 2} y={(hover.a.y + hover.b.y) / 2}
            textAnchor="middle" dominantBaseline="middle" fontSize={px(12)} fontWeight={600}
            strokeWidth={px(3)} paintOrder="stroke" strokeLinejoin="round" data-hover-length={hover.label}
            className="fill-orange-700 stroke-white dark:fill-orange-200 dark:stroke-slate-900">
            {fmtCm(dist(hover.a, hover.b))} cm
          </text>
        </g>
      )}

      {/* "In line on" of the walls of a v1 document: the line of each selected wall that lines up
          with the walls that continue it */}
      {selWalls.size > 0 && rooms.map((r) => roomWalls(r).filter((w) => selWalls.has(r.id + ':' + w.start.id)).map((w) => {
        const p = wallProps(r, w.start.id)
        const k = (p.align ?? 'room') === 'room' ? 1 : p.align === 'other' ? -1 : 0
        const o = (k * p.thicknessCm) / 2
        const x1 = w.start.x + w.inward.x * o, y1 = w.start.y + w.inward.y * o
        const x2 = w.end.x + w.inward.x * o, y2 = w.end.y + w.inward.y * o
        return (
          <line key={'align' + r.id + w.start.id} x1={x1} y1={y1} x2={x2} y2={y2} pointerEvents="none"
            data-wall-align-line={r.id + ':' + w.start.id} data-align={p.align ?? 'room'}
            strokeWidth={px(2)} strokeLinecap="round" strokeDasharray={`${px(2)} ${px(4)}`}
            className="stroke-sky-600 dark:stroke-sky-400" />
        )
      }))}

      {/* labels + dimensions */}
      {display.map(label)}
      {layers.dimensions && rooms.map((r) => {
        const labels = new Map(surveyIds(r).filter((x) => x.kind === 'wall').map((x) => [x.wallStart, x.label]))
        // Lengths shown are inside faces, like the values measured on site.
        const inner = innerWallLengths(r)
        return roomWalls(r).map((w) => {
          // Always show lengths of walls attached to the dragged vertex/wall (7.2 #22).
          if (w.length * zoom < 55 && !forcedWalls.has(w.start.id)) return null
          const m = measurements[labels.get(w.start.id) ?? '']
          const measured = !!m && m.actualCm > 0
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
              strokeWidth={px(3)} strokeLinejoin="round" fontWeight={measured ? 600 : undefined}
              className={`stroke-[#f6f7f5] dark:stroke-[#12161b] ${measured ? 'fill-emerald-700 dark:fill-emerald-400' : 'fill-slate-600 dark:fill-slate-300'}`}>
              {measured ? measuredText(m.actualCm, shownLength(inner[w.index], step), step) : fmtCm(shownLength(inner[w.index], step))}
            </text>
          )
        })
      })}

      {/* wall numbers: a small badge with the number of the wall ("6" = wall CU-6 of room CU),
          inside the room near the middle of the wall, just inside the dimension text. The badge of a
          selected stored wall is orange on the side the user clicked, light orange on the other
          side, and a wall too short on screen shows no badge (it would touch its neighbours). */}
      {showWallNumbers && rooms.map((r) => roomWalls(r).map((w) => {
        if (w.length * zoom < 32) return null
        const props = wallProps(r, w.start.id)
        if (!wallAppearance(props.type, props.status, renovationView).visible) return null
        // Same placement as the dimension text; the badge goes one step further inside the room.
        const dimOff = props.thicknessCm / 2 + px(10)
        const dimShown = layers.dimensions && (w.length * zoom >= 55 || forcedWalls.has(w.start.id))
        const off = dimShown ? dimOff + px(13) : dimOff
        const mx = (w.start.x + w.end.x) / 2 + w.inward.x * off
        const my = (w.start.y + w.end.y) / 2 + w.inward.y * off
        const n = String(w.index + 1)
        const kind = wallNumberHighlight(r.id, w.start.id) ?? (selWalls.has(r.id + ':' + w.start.id) ? 'strong' : 'none')
        const h = px(13), bw = px(5) + px(5.6) * n.length
        return (
          <g key={'wn' + r.id + w.start.id} transform={`translate(${mx} ${my})`} pointerEvents="none"
            data-wall-number={n} data-wall-label={`${r.code}-${n}`} data-wall-number-state={kind} aria-hidden="true">
            <rect x={-bw / 2} y={-h / 2} width={bw} height={h} rx={px(3)} strokeWidth={px(1)}
              className={badgeClass[kind]} />
            <text textAnchor="middle" dominantBaseline="middle" fontSize={px(9)}
              className={`font-mono ${badgeTextClass[kind]}`}>
              {n}
            </text>
          </g>
        )
      }))}

      {/* inline room rename editor: topmost, so no hit area can steal its clicks */}
      {rooms.filter((r) => r.id === editing).map((r) => (
        <RoomNameEditor key={'edit' + r.id} room={r} vp={vp} onClose={closeEditor} />
      ))}
    </g>
  )
}
