// Red highlight of the footprints that clash (docs/plan.md 7.4). Drawn in world coordinates
// over the rooms, with no pointer events, so the plan stays editable underneath. The stroke
// width is divided by the zoom, so it stays one hairline at every zoom level.
import { useMemo } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { useDoc } from '../../model/store'
import type { PlanDoc, Vec } from '../../model/types'
import { clashFootprints, findClashes } from './clash'

const pathOf = (pts: Vec[]) => `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}Z`

type ShapesProps = {
  doc: PlanDoc
  /** Screen pixels -> world units (see useViewport). */
  px: (px: number) => number
}

/** Presentational shapes, so the layer can be rendered without the store or the canvas. */
export function ClashShapes({ doc, px }: ShapesProps) {
  const footprints = useMemo(() => {
    const all = clashFootprints(doc)
    const clashing = new Set<string>()
    for (const c of findClashes(doc, all)) {
      clashing.add(c.a)
      if (c.b) clashing.add(c.b)
    }
    return all.filter((f) => clashing.has(f.elementId))
  }, [doc])

  if (!footprints.length) return null
  return (
    <g data-layer="clashes" aria-hidden="true" pointerEvents="none">
      {footprints.map((f, i) => (
        <path
          key={`${f.elementId}:${i}`}
          d={pathOf(f.points)}
          strokeWidth={px(1.5)}
          strokeLinejoin="round"
          data-clash-element={f.elementId}
          className="fill-red-500/20 stroke-red-600 dark:fill-red-400/20 dark:stroke-red-400"
        />
      ))}
    </g>
  )
}

export function ClashLayer() {
  const doc = useDoc((s) => s.doc)
  const { px } = useViewport()
  return <ClashShapes doc={doc} px={px} />
}
