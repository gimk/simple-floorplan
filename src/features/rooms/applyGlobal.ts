// "Solve whole plan": all rooms in one fit (globalSolve.ts), then the plan takes the result. Pure, cm.
import { planPrecision, roundTo } from '../../model/precision'
import type { PlanDoc } from '../../model/types'
import { solveGlobal, type GlobalSolved } from './globalSolve'
import { wallProps } from './walls'

export type GlobalReport = {
  rooms: number
  rmsCm: number
  /** Locked walls with no measured value that kept their length. */
  lockedKept: number
  /** Walls whose thickness the values found (not only the estimate from the wall type). */
  foundThicknesses: { walls: string[]; cm: number }[]
  /** Largest measured-minus-solved difference, if > 1 cm. */
  worst?: { label: string; diffCm: number }
}

const round1 = (v: number) => roundTo(v, 0.1)

/**
 * Solve every room together and move all corners to the result. Thicknesses that the values
 * found are written to the walls (both sides). Returns the same doc when nothing can be solved.
 */
export function applyGlobal(doc: PlanDoc, opts: { keepLocked?: boolean } = {}): { doc: PlanDoc; report: GlobalReport; solved: GlobalSolved } {
  const solved = solveGlobal(doc, { keepLocked: opts.keepLocked ?? true })
  // Corners and thicknesses take the precision of the plan; 0.1 cm when the user turned it off.
  const step = planPrecision(doc) || 0.1
  const snap = (v: number) => roundTo(v, step)
  const fit = solved.residuals.filter((r) => r.kind === 'wall' || r.kind === 'diagonal')
  const worst = fit.reduce<(typeof fit)[number] | null>((a, r) => (!a || Math.abs(r.diffCm) > Math.abs(a.diffCm) ? r : a), null)
  const found = solved.groups.filter((g) => g.determined)
  const report: GlobalReport = {
    rooms: doc.rooms.length,
    rmsCm: solved.rmsCm,
    lockedKept: solved.residuals.filter((x) => x.kind === 'locked').length,
    foundThicknesses: found.map((g) => ({ walls: g.walls, cm: round1(g.thicknessCm) })),
    ...(worst && Math.abs(worst.diffCm) > 1 ? { worst: { label: worst.label, diffCm: worst.diffCm } } : {}),
  }
  const ok = doc.rooms.every((r) => solved.rooms[r.id]?.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
  if (!ok || !fit.length) return { doc, report, solved }

  // Thickness of each room wall from the walls the values found ("SE-4" -> cm).
  const thick = new Map<string, number>()
  for (const g of found) for (const w of g.walls) thick.set(w, snap(g.thicknessCm))
  const rooms = doc.rooms.map((r) => {
    const pts = solved.rooms[r.id]
    const walls = { ...r.walls }
    r.vertices.forEach((v, i) => {
      const cm = thick.get(`${r.code}-${i + 1}`)
      if (cm && cm > 0) walls[v.id] = { ...wallProps(r, v.id), thicknessCm: cm }
    })
    return { ...r, walls, vertices: r.vertices.map((v, i) => ({ ...v, x: snap(pts[i].x), y: snap(pts[i].y) })) }
  })
  return { doc: { ...doc, rooms }, report, solved }
}

/** One-line summary for the panel. */
export function describeGlobal(r: GlobalReport): string {
  const f = (n: number) => n.toFixed(1).replace('.', ',')
  const parts = [`Solved ${r.rooms} rooms together: fit error ${f(r.rmsCm)} cm rms`]
  if (r.lockedKept) parts.push(`${r.lockedKept} locked wall${r.lockedKept === 1 ? '' : 's'} kept`)
  if (r.worst) parts.push(`largest: ${r.worst.label} ${r.worst.diffCm >= 0 ? '+' : ''}${f(r.worst.diffCm)} cm`)
  parts.push(r.foundThicknesses.length
    ? `thickness found for ${r.foundThicknesses.map((t) => `${t.walls.join('/')} (${f(t.cm)} cm)`).join(', ')}`
    : 'no thickness found from the values (measure CODE-n-T at a door frame)')
  return parts.join('; ') + '.'
}
