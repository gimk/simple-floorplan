// The BASE position of a wall that the solver moved, drawn as a thin dashed purple line
// (docs/solver-plan.md, "Purple everywhere"): "a thin dashed purple outline of the base position of
// the hovered change".
//
// It is drawn for the element the user hovers (the existing hover path of the Solve tab rows and of
// Measuring Mode, `useUi.hoverLabel` -> features/rooms/hoverTarget.ts) and for the stored wall the
// user selected. Nothing is drawn when the solver is Off, when the wall has no recorded position
// change, or when the base position is the position the plan shows.
//
// The base position of a node is `doc.solver.baseNodes[nodeId]`; a node the solve did not move keeps
// its current position. The layer draws over the wall bands (it is mounted in RoomsOverlay), so the
// dashed line stays visible, and it never takes a pointer event.
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Vec } from '../../model/types'
import { storedWallLine } from './hoverTarget'
import { solverChangeForLabel, solverChangeForWall } from '../solver/lookup'
import { SOLVED_STROKE } from '../../shell/panel/styles'
import { useViewport } from '../../canvas/Viewport'

/** The two ends of the BASE position of a stored wall, or null when the solver did not move it. */
export function wallBaseLine(doc: PlanDoc, wallId: string): { wallId: string; a: Vec; b: Vec } | null {
  // Only a position change moves the wall: a thickness change keeps the centre line.
  if (!solverChangeForWall(doc, wallId, 'position')) return null
  const wall = (doc.walls ?? []).find((w) => w.id === wallId)
  if (!wall) return null
  const node = (id: string): Vec | null => {
    const base = doc.solver?.baseNodes?.[id]
    if (base) return { x: base.x, y: base.y }
    const n = (doc.nodes ?? []).find((x) => x.id === id)
    return n ? { x: n.x, y: n.y } : null
  }
  const a = node(wall.a)
  const b = node(wall.b)
  return a && b ? { wallId, a, b } : null
}

/** Wall whose base position must be shown for a hover label, or null. */
export function ghostWallOfLabel(doc: PlanDoc, hoverLabel: string | null): string | null {
  return hoverLabel ? solverChangeForLabel(doc, hoverLabel)?.wallId ?? null : null
}

export function SolverGhostLayer() {
  const doc = useDoc((s) => s.doc)
  const hoverLabel = useUi((s) => s.hoverLabel)
  const selection = useUi((s) => (s.selection?.kind === 'storedWall' ? s.selection.wallId : null))
  const { px } = useViewport()
  if (!doc.solver?.enabled) return null
  // The selected wall first, then the hovered element (a stored wall value 'W12-C' / 'W12-E', or a
  // room wall value 'KI-2' that names one stored wall). A wall with no change of its own is skipped.
  const wallId = [selection, ghostWallOfLabel(doc, hoverLabel)].find((id) => !!id && !!wallBaseLine(doc, id)) ?? null
  if (!wallId) return null
  const line = wallBaseLine(doc, wallId)
  if (!line) return null
  // The wall of the plan: the line of its two nodes on the plan now.
  const now = storedWallLine(doc, wallId)
  if (now && Math.hypot(now.a.x - line.a.x, now.a.y - line.a.y) < 0.01
    && Math.hypot(now.b.x - line.b.x, now.b.y - line.b.y) < 0.01) return null
  return (
    <g data-solver-ghost={wallId} data-solver-ghost-label={hoverLabel ?? ''} pointerEvents="none" aria-hidden="true">
      <line x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y}
        strokeWidth={px(2)} strokeDasharray={`${px(7)} ${px(5)}`} strokeLinecap="round"
        className={SOLVED_STROKE} />
    </g>
  )
}
