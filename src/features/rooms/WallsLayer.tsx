// Walls drawn once from the wall graph (docs/walls-plan.md, "Walls in the interface").
// A v2 document draws one band per stored wall, so a wall between two rooms is ONE shape, with the
// joins of the graph (`wallJoins.ts`). A v1 document keeps its room walls, drawn by `RoomsLayer`.
//
// The styles are the ones of the room walls: the type owns the fill, the renovation status and the
// renovation view decide what is shown, the bearing highlight layer adds the light tone and the
// diagonal stripes, and the selected wall (`Selection { kind: 'storedWall' }`) is outlined in
// orange. This layer draws only: the hit areas of the walls are in `RoomsLayer`.
import { useMemo } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { useDoc, useUi } from '../../model/store'
import type { StoredWall, Vec } from '../../model/types'
import { wallAppearance } from '../renovation/logic'
import { polygonPath, polylinePath } from './wallOutline'
import { wallJoinGeometry } from './wallJoins'

/** Solid walls (exterior, and bearing walls when the highlight layer is off). */
const solidClass = 'fill-slate-900 dark:fill-slate-100'

const wallClass = {
  exterior: solidClass,
  bearing: solidClass,
  partition: 'fill-slate-400 dark:fill-slate-500',
}

/** Bearing walls with the highlight layer on: light tone + thin dark diagonal stripes. */
const bearingFaceClass = 'stroke-slate-500 dark:stroke-slate-400'

export function WallsLayer() {
  const v2 = useDoc((s) => s.doc.schemaVersion === 2)
  const walls = useDoc((s) => s.doc.walls)
  const nodes = useDoc((s) => s.doc.nodes)
  const selection = useUi((s) => s.selection)
  const layers = useUi((s) => s.layers)
  const renovationView = useUi((s) => s.renovationView)
  const { px } = useViewport()
  const geometry = useMemo(() => wallJoinGeometry({ nodes, walls }), [nodes, walls])
  if (!v2 || !walls?.length) return null

  const selected = selection?.kind === 'storedWall' ? selection.wallId : null
  /** Bearing wall stripes: ~6 px apart (perpendicular), ~1 px wide, at 45°, zoom independent. */
  const stripeGap = px(6)
  const stripeTile = stripeGap * Math.SQRT2
  const propsOf = (w: StoredWall) => ({ type: w.type ?? 'partition', thicknessCm: w.thicknessCm ?? 0, status: w.status })

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
    // The two faces of the band: start+ -> end+ and start- -> end- (see wallJoins.WallBand).
    const faces = [[points[0], points[2]], [points[1], points[3]]]
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

      {/* The selected wall: the whole band, in the colour of a selected item. */}
      {selected && geometry.bands.filter((b) => b.wallId === selected).map((b) => {
        const wall = byId.get(b.wallId)
        const look = wall ? wallAppearance(propsOf(wall).type, propsOf(wall).status, renovationView) : null
        if (!look?.visible) return null
        return (
          <path key={'sel' + b.wallId} d={polygonPath(b.points)} pointerEvents="none" strokeOpacity={0.9}
            data-selected-stored-wall={b.wallId} strokeWidth={px(2)}
            className="fill-orange-500/35 stroke-orange-500" />
        )
      })}
    </g>
  )
}
