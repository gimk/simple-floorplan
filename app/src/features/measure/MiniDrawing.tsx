import { fmtCm, roomWalls } from '../../model/geometry'
import type { PlanDoc, Room, Vec } from '../../model/types'
import { inputId } from './actions'
import { adjacentItems, itemSpan } from './logic'

const W = 340, PAD = 40
const f = (n: number) => n.toFixed(1)

/** Mini drawing of one room: wall IDs, start arrows, diagonal, doors/windows/cupboards. Read-only. */
export function MiniDrawing({ doc, room, focused }: { doc: PlanDoc; room: Room; focused: string | null }) {
  const v = room.vertices
  if (v.length < 3) return null
  const xs = v.map((p) => p.x), ys = v.map((p) => p.y)
  const minx = Math.min(...xs), miny = Math.min(...ys)
  const w = Math.max(1, Math.max(...xs) - minx), h = Math.max(1, Math.max(...ys) - miny)
  const s = Math.min((W - 2 * PAD) / w, 220 / h)
  const H = h * s + 2 * PAD, ox = PAD + (W - 2 * PAD - w * s) / 2
  const T = (p: Vec): Vec => ({ x: ox + (p.x - minx) * s, y: PAD + (p.y - miny) * s })
  const P = v.map(T)
  const walls = roomWalls(room)
  const val = (label: string) => doc.measurements[label]?.actualCm
  const focus = (label: string) => document.getElementById(inputId(label))?.focus()
  const labelText = (label: string) => { const x = val(label); return x != null ? `${label} · ${fmtCm(x)}` : label }

  const mine = doc.elements.filter((e) => e.roomId === room.id)
  const dKey = `${room.code}-D`
  const diag = room.diagonal && v[room.diagonal[0]] && v[room.diagonal[1]] ? [P[room.diagonal[0]], P[room.diagonal[1]]] : null

  const tick = (p: Vec, n: Vec, k: string) => (
    <line key={k} x1={f(p.x + n.x * 5)} y1={f(p.y + n.y * 5)} x2={f(p.x - n.x * 5)} y2={f(p.y - n.y * 5)} className="stroke-slate-800 dark:stroke-slate-200" strokeWidth={2} />
  )

  return (
    <svg viewBox={`0 0 ${W} ${H.toFixed(0)}`} role="img" aria-label={`${room.name} with wall IDs`} className="mx-auto block h-auto w-full max-w-[360px]">
      <polygon
        points={P.map((p) => `${f(p.x)},${f(p.y)}`).join(' ')}
        className="fill-slate-100 stroke-slate-800 dark:fill-slate-800 dark:stroke-slate-200"
        strokeWidth={2}
        strokeDasharray={room.outdoor ? '6 5' : undefined}
      />

      {/* items of this room */}
      {mine.map((el) => {
        const span = itemSpan(doc, room, el)
        if (!span) return null
        const a = T(span.p0), b = T(span.p1), n = span.wall.inward
        const wpx = Math.hypot(b.x - a.x, b.y - a.y)
        const k = el.id
        if (el.kind === 'cupboard') {
          const d = (el.depthCm || 60) * s
          const q = (p: Vec) => `${f(p.x + n.x * d)},${f(p.y + n.y * d)}`
          return <polygon key={k} points={[`${f(a.x)},${f(a.y)}`, `${f(b.x)},${f(b.y)}`, q(b), q(a)].join(' ')} className="fill-stone-300 stroke-slate-800 dark:fill-stone-600 dark:stroke-slate-200" strokeWidth={1.5} />
        }
        const cls = {
          window: 'stroke-blue-600 dark:stroke-blue-400', door: 'stroke-violet-600 dark:stroke-violet-400',
          radiator: 'stroke-red-600 dark:stroke-red-400', other: 'stroke-slate-500', opening: 'stroke-slate-100 dark:stroke-slate-800',
        }[el.kind]
        const parts = [<line key={k} x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} className={cls} strokeWidth={el.kind === 'opening' ? 7 : 6} />]
        if (el.kind === 'opening') parts.push(tick(a, n, `${k}-t0`), tick(b, n, `${k}-t1`))
        if (el.kind === 'door') {
          const sgn = el.swing === 'out' ? -1 : 1
          const hinge = el.hinge === 'end' ? b : a, free = el.hinge === 'end' ? a : b
          const q = { x: hinge.x + n.x * wpx * sgn, y: hinge.y + n.y * wpx * sgn }
          const cr = (free.x - hinge.x) * (q.y - hinge.y) - (free.y - hinge.y) * (q.x - hinge.x)
          parts.push(<path key={`${k}-sw`} d={`M${f(free.x)},${f(free.y)} A${f(wpx)},${f(wpx)} 0 0 ${cr > 0 ? 1 : 0} ${f(q.x)},${f(q.y)} L${f(hinge.x)},${f(hinge.y)}`} fill="none" className="stroke-violet-600 dark:stroke-violet-400" strokeWidth={1.5} />)
        }
        return parts
      })}

      {/* doors / openings of neighbouring rooms on our walls */}
      {adjacentItems(doc, room).map((it, i) => {
        const a = T(it.p0), b = T(it.p1)
        const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
        const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L }
        return it.kind === 'opening'
          ? [<line key={`ad${i}`} x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={7} />, tick(a, n, `ad${i}a`), tick(b, n, `ad${i}b`)]
          : <line key={`ad${i}`} x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} className="stroke-violet-600 dark:stroke-violet-400" strokeWidth={6} strokeDasharray="4 3" />
      })}

      {/* diagonal */}
      {diag && (
        <>
          <line x1={f(diag[0].x)} y1={f(diag[0].y)} x2={f(diag[1].x)} y2={f(diag[1].y)} className={focused === dKey ? 'stroke-orange-600 dark:stroke-orange-400' : 'stroke-slate-500'} strokeWidth={focused === dKey ? 3 : 1.5} strokeDasharray="5 4" />
          <Label x={(diag[0].x + diag[1].x) / 2} y={(diag[0].y + diag[1].y) / 2} angle={0} text={labelText(dKey)} ok={val(dKey) != null} onTap={() => focus(dKey)} />
        </>
      )}

      {/* walls: highlight, start arrow, label */}
      {walls.map((wl) => {
        const label = `${room.code}-${wl.index + 1}`
        const a = P[wl.index], b = P[(wl.index + 1) % P.length]
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1
        const ux = dx / L, uy = dy / L, n = wl.inward
        const cx = (a.x + b.x) / 2 + n.x * 7, cy = (a.y + b.y) / 2 + n.y * 7
        const tri = [[cx + ux * 5, cy + uy * 5], [cx - ux * 4 - uy * 4, cy - uy * 4 + ux * 4], [cx - ux * 4 + uy * 4, cy - uy * 4 - ux * 4]]
        const mx = (a.x + b.x) / 2 - n.x * 15, my = (a.y + b.y) / 2 - n.y * 15
        let ang = (Math.atan2(dy, dx) * 180) / Math.PI
        if (ang > 90) ang -= 180
        if (ang <= -90) ang += 180
        return (
          <g key={wl.start.id}>
            {focused === label && <line x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} className="stroke-orange-600 dark:stroke-orange-400" strokeWidth={7} strokeLinecap="round" />}
            <polygon points={tri.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')} className="fill-slate-500 dark:fill-slate-400" />
            <Label x={mx} y={my} angle={ang} text={labelText(label)} ok={val(label) != null} onTap={() => focus(label)} />
          </g>
        )
      })}
    </svg>
  )
}

function Label({ x, y, angle, text, ok, onTap }: { x: number; y: number; angle: number; text: string; ok: boolean; onTap: () => void }) {
  return (
    <text
      x={f(x)} y={f(y)}
      transform={angle ? `rotate(${f(angle)} ${f(x)} ${f(y)})` : undefined}
      textAnchor="middle" dominantBaseline="central" onClick={onTap}
      className={`cursor-pointer font-mono text-[12px] font-semibold [paint-order:stroke] stroke-white stroke-[4px] dark:stroke-[#1b2128] ${ok ? 'fill-green-700 dark:fill-green-400' : 'fill-orange-700 dark:fill-orange-400'}`}
    >
      {text}
    </text>
  )
}
