import { labelPoint } from '../../model/geometry'
import type { PlanDoc, Room } from '../../model/types'
import { goRoom } from './actions'
import { roomProgress } from './logic'

const FILL = {
  none: 'fill-slate-100 dark:fill-slate-800',
  part: 'fill-orange-200 dark:fill-orange-900/60',
  full: 'fill-green-200 dark:fill-green-900/60',
}
const CHIP = {
  none: 'border-slate-300 dark:border-slate-600',
  part: 'border-orange-600 dark:border-orange-400',
  full: 'border-green-700 text-green-700 dark:border-green-400 dark:text-green-400',
}

export function Overview({ doc, rooms }: { doc: PlanDoc; rooms: Room[] }) {
  const pts = rooms.flatMap((r) => r.vertices)
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x))
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y))
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), pad = Math.max(w, h) * 0.04
  const font = Math.max(w, h) / 38
  return (
    <section aria-label="Overview plan" className="rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-[#1b2128]">
      <svg viewBox={`${x0 - pad} ${y0 - pad} ${w + 2 * pad} ${h + 2 * pad}`} role="img" aria-label="Overview plan, colored by progress" className="mx-auto block max-h-[60vh] w-full">
        {rooms.map((r) => {
          if (r.vertices.length < 3) return null
          const { done, total, state: st } = roomProgress(doc, r)
          const lp = labelPoint([r.vertices, ...r.holes])
          return (
            <g
              key={r.id} onClick={() => goRoom(r.code)}
              role="button" tabIndex={0} aria-label={`Go to room ${r.name} (${done}/${total} measured)`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goRoom(r.code) } }}
              className="cursor-pointer"
            >
              <polygon
                points={r.vertices.map((p) => `${p.x},${p.y}`).join(' ')}
                className={`${FILL[st]} stroke-slate-700 dark:stroke-slate-300`}
                strokeWidth={font / 9} strokeDasharray={r.outdoor ? `${font / 2.5} ${font / 3}` : undefined}
              />
              <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="central" fontSize={font} className="pointer-events-none fill-slate-800 dark:fill-slate-100">{r.name}</text>
            </g>
          )
        })}
      </svg>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {rooms.map((r) => {
          const { done, total, state } = roomProgress(doc, r)
          return (
            <button
              key={r.id}
              type="button"
              data-value-state={state === 'full' ? 'measured' : undefined}
              onClick={() => goRoom(r.code)}
              className={`min-h-11 rounded-full border bg-slate-50 px-3 text-[13px] font-medium dark:bg-[#12161b] ${CHIP[state]}`}
            >
              {r.name} {done}/{total}
            </button>
          )
        })}
      </div>
    </section>
  )
}
