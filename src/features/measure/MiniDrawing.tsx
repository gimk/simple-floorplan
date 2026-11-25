import { fmtCm, roomWalls } from '../../model/geometry'
import type { PlanDoc, Room, Vec } from '../../model/types'
import { inputId } from './actions'
import { adjacentItems, itemSpan } from './logic'

const W = 340, PAD = 40
const f = (n: number) => n.toFixed(1)

/** Mini drawing of one room: wall IDs, start arrows, diagonal, doors/windows/radiators. Read-only. */
export type DrawingPin = { n: number; at: Vec; active?: boolean }
export type DrawingTape = { a: Vec; b: Vec; label: string }

export function MiniDrawing({ doc, room, focused, pins, tapes, marks, onPick }: {
  doc: PlanDoc; room: Room; focused: string | null
  /** Numbered dots (world cm). */
  pins?: DrawingPin[]
  /** Placed ad-hoc tapes of this room (world cm). */
  tapes?: DrawingTape[]
  /** Extra points to show (world cm), e.g. the first tape point already tapped. */
  marks?: Vec[]
  /** When set, a tap anywhere on the drawing calls this with the world point (cm) instead of focusing a field. */
  onPick?: (p: Vec) => void
}) {
  const v = room.vertices
  if (v.length < 3) return null
  const xs = v.map((p) => p.x), ys = v.map((p) => p.y)
  const minx = Math.min(...xs), miny = Math.min(...ys)
  const w = Math.max(1, Math.max(...xs) - minx), h = Math.max(1, Math.max(...ys) - miny)
  const s = Math.min((W - 2 * PAD) / w, 220 / h)
  const H = h * s + 2 * PAD, ox = PAD + (W - 2 * PAD - w * s) / 2
  const T = (p: Vec): Vec => ({ x: ox + (p.x - minx) * s, y: PAD + (p.y - miny) * s })
  const P = v.map(T)
  const unT = (x: number, y: number): Vec => ({ x: (x - ox) / s + minx, y: (y - PAD) / s + miny })
  const walls = roomWalls(room)
  const val = (label: string) => doc.measurements[label]?.actualCm
  const focus = (label: string) => document.getElementById(inputId(label))?.focus()
  const labelText = (label: string) => { const x = val(label); return x != null ? `${label} · ${fmtCm(x)}` : label }
  /** Enter / Space activate a hit target, like a native button. */
  const keyTap = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
  }

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
            {/* wide transparent hit line along the whole wall (≥ 40 px touch target) */}
            <line
              x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)}
              stroke="transparent" strokeWidth={44} strokeLinecap="round"
              role="button" tabIndex={0} aria-label={`Focus measurement ${label}`}
              style={{ cursor: 'pointer' }}
              onClick={() => focus(label)} onKeyDown={keyTap(() => focus(label))}
            />
            {(focused === label || focused === `${label}-T`) && <line x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} className="stroke-orange-600 dark:stroke-orange-400" strokeWidth={7} strokeLinecap="round" pointerEvents="none" />}
            <polygon points={tri.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')} className="fill-slate-500 dark:fill-slate-400" pointerEvents="none" />
            <Label x={mx} y={my} angle={ang} text={labelText(label)} ok={val(label) != null} onTap={() => focus(label)} />
          </g>
        )
      })}

      {/* ad-hoc tapes */}
      {tapes?.map((t, i) => {
        const a = T(t.a), b = T(t.b)
        return (
          <g key={`tp${i}`} pointerEvents="none">
            <line x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} className="stroke-cyan-600 dark:stroke-cyan-400" strokeWidth={2} strokeDasharray="2 3" />
            <circle cx={f(a.x)} cy={f(a.y)} r={3.5} className="fill-cyan-600 dark:fill-cyan-400" />
            <circle cx={f(b.x)} cy={f(b.y)} r={3.5} className="fill-cyan-600 dark:fill-cyan-400" />
            <text x={f((a.x + b.x) / 2)} y={f((a.y + b.y) / 2 - 8)} textAnchor="middle" className="fill-cyan-700 font-mono text-[11px] font-semibold [paint-order:stroke] stroke-white stroke-[3px] dark:fill-cyan-300 dark:stroke-[#1b2128]">{t.label}</text>
          </g>
        )
      })}
      {marks?.map((m, i) => { const q = T(m); return <circle key={`mk${i}`} cx={f(q.x)} cy={f(q.y)} r={5} className="fill-cyan-600 stroke-white dark:fill-cyan-400" strokeWidth={2} pointerEvents="none" /> })}

      {/* pins */}
      {pins?.map((p) => {
        const q = T(p.at)
        return (
          <g key={`pin${p.n}`} pointerEvents="none">
            <circle cx={f(q.x)} cy={f(q.y)} r={p.active ? 11 : 9} className={`fill-orange-600 ${p.active ? 'stroke-slate-900 dark:stroke-white' : 'stroke-white dark:stroke-[#1b2128]'}`} strokeWidth={2} />
            <text x={f(q.x)} y={f(q.y)} textAnchor="middle" dominantBaseline="central" className="fill-white font-sans text-[11px] font-bold">{p.n}</text>
          </g>
        )
      })}

      {onPick && (
        <rect
          x={0} y={0} width={W} height={H} fill="transparent" style={{ cursor: 'crosshair' }} data-pick-surface
          onClick={(e) => {
            const svg = e.currentTarget.ownerSVGElement
            if (!svg) return
            const r = svg.getBoundingClientRect()
            if (!r.width) return
            const k = W / r.width
            onPick(unT((e.clientX - r.left) * k, (e.clientY - r.top) * k))
          }}
        />
      )}
    </svg>
  )
}

function Label({ x, y, angle, text, ok, onTap }: { x: number; y: number; angle: number; text: string; ok: boolean; onTap: () => void }) {
  return (
    <g
      role="button" tabIndex={0} aria-label={text}
      onClick={onTap}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap() } }}
      style={{ cursor: 'pointer' }}
    >
      {/* transparent hit area ≥ 40×40 px so the label is easy to tap on a phone */}
      <rect x={f(x - 22)} y={f(y - 22)} width={44} height={44} fill="transparent" />
      <text
        x={f(x)} y={f(y)}
        transform={angle ? `rotate(${f(angle)} ${f(x)} ${f(y)})` : undefined}
        textAnchor="middle" dominantBaseline="central" pointerEvents="none"
        className={`font-mono text-[12px] font-semibold [paint-order:stroke] stroke-white stroke-[4px] dark:stroke-[#1b2128] ${ok ? 'fill-green-700 dark:fill-green-400' : 'fill-orange-700 dark:fill-orange-400'}`}
      >
        {text}
      </text>
    </g>
  )
}
