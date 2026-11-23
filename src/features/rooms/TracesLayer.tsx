// Traced walls on the plan (docs/walls-plan.md phase 6): dashed centre line, translucent band of
// the wall thickness, length label. With the Select tool a trace is selectable and, with
// Delete / Backspace, deletable (see features/rooms/interaction.ts, deleteSelection).
import { useViewport } from '../../canvas/Viewport'
import { dist, fmtCm } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import type { TraceWall } from '../../model/types'

/** Label angle along the trace, always readable (not upside down). */
const labelAngle = (t: TraceWall) => {
  let ang = (Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x) * 180) / Math.PI
  if (ang > 90 || ang < -90) ang += 180
  return ang
}

export function TracesLayer() {
  const traces = useDoc((s) => s.doc.traces)
  const selection = useUi((s) => s.selection)
  const tool = useUi((s) => s.tool)
  const mode = useUi((s) => s.mode)
  const { px, zoom } = useViewport()
  if (!traces?.length) return null
  // Only the Select tool picks a trace; the Wall and Make room tools draw over them.
  const interactive = tool === 'select' && mode === 'edit'
  const selected = selection?.kind === 'trace' ? selection.id : null

  return (
    <g data-traces="">
      {traces.map((t) => {
        const len = dist(t.a, t.b)
        const mx = (t.a.x + t.b.x) / 2, my = (t.a.y + t.b.y) / 2
        const ang = labelAngle(t)
        const rad = (ang * Math.PI) / 180
        // The label sits on one side of the line, clear of the band: midpoint + normal * offset.
        const off = t.thicknessCm / 2 + px(9)
        const lx = mx - Math.sin(rad) * off, ly = my + Math.cos(rad) * off
        const isSel = selected === t.id
        return (
          <g key={t.id} data-trace={t.id} data-trace-type={t.type} data-trace-thickness={t.thicknessCm}>
            {/* The band: the wall mass the trace stands for. */}
            <line x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} pointerEvents="none"
              strokeWidth={Math.max(t.thicknessCm, px(2))} strokeLinecap="butt"
              className={isSel ? 'stroke-orange-400/30' : 'stroke-slate-400/30 dark:stroke-slate-300/25'} />
            {/* The centre line: the line that a room wall will follow. */}
            <line x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} pointerEvents="none"
              strokeWidth={px(isSel ? 2.5 : 1.6)} strokeLinecap="round" strokeDasharray={`${px(7)} ${px(4)}`}
              className={isSel ? 'stroke-orange-600 dark:stroke-orange-400' : 'stroke-slate-600 dark:stroke-slate-300'} />
            {len * zoom >= 24 && (
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={px(11)}
                transform={`rotate(${ang} ${lx} ${ly})`} pointerEvents="none" paintOrder="stroke"
                strokeWidth={px(3)} strokeLinejoin="round" data-trace-length={Math.round(len)}
                className={`stroke-[#f6f7f5] dark:stroke-[#12161b] ${isSel ? 'fill-orange-700 dark:fill-orange-300' : 'fill-slate-600 dark:fill-slate-300'}`}>
                {fmtCm(len)}
              </text>
            )}
          </g>
        )
      })}

      {/* Hit areas of the Select tool: last, so they take the click above rooms and walls. */}
      {interactive && traces.map((t) => (
        <line key={'hit' + t.id} x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} stroke="transparent"
          strokeLinecap="round" strokeWidth={Math.max(t.thicknessCm, px(18))} style={{ cursor: 'pointer' }}
          data-trace-hit={t.id}
          aria-label={`Traced wall, ${fmtCm(dist(t.a, t.b))} cm, ${t.type}, ${fmtCm(t.thicknessCm)} cm thick`}
          onPointerDown={(e) => {
            if (e.button !== 0 || !e.isPrimary) return
            e.stopPropagation()
            useUi.getState().select({ kind: 'trace', id: t.id })
          }} />
      ))}
    </g>
  )
}
