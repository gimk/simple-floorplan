// "Solve whole plan": all rooms in one fit (globalSolve.ts), then the plan takes the result. Pure, cm.
import { planPrecision, roundTo } from '../../model/precision'
import type { PlanDoc } from '../../model/types'
import type { GraphConflict } from '../../model/wallGraph'
import { solveGlobal, type GlobalSolved, type GlobalSurface, type OutOfSquare, type RoomAngles, type SurfaceMode } from './globalSolve'
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
  /** Before / after area of each surface reference (empty when the mode is 'off'). */
  surfaces: GlobalSurface[]
  /** Rooms that overlap or nearly touch (from the wall graph): the user should check them. */
  conflicts?: { roomCodes: string[]; kind: GraphConflict['kind']; detail: string }[]
  /** Room corners that the fit did not keep at a right angle (Room angles = Free only). */
  outOfSquare?: OutOfSquare[]
}

export type GlobalApplyOptions = {
  keepLocked?: boolean
  /** How to use doc.apartment.references: 'off' (default), 'guide' or 'match'. */
  surfaceMode?: SurfaceMode
  /** Accuracy of a surface reference, in % of its surface. Default 1.5. */
  surfaceSigmaPct?: number
  /** A wall that the data does not determine, but that moved from its prior, gets a usual thickness. Default false. */
  snapThickness?: boolean
  /** 'square' (default) keeps walls drawn horizontal or vertical at their drawn angle; 'free' lets them turn. */
  angles?: RoomAngles
}

/** Usual wall thicknesses (cm) for the snap option. */
export const USUAL_THICKNESSES_CM = [5, 7, 10, 15, 20, 30]

/** The usual thickness nearest to a value (the smaller one on a tie). */
export function nearestUsualThickness(cm: number): number {
  return USUAL_THICKNESSES_CM.reduce((best, t) => (Math.abs(t - cm) < Math.abs(best - cm) ? t : best))
}

/** A thickness change of one wall (all its room walls): from the prior to the value written. */
export type ThicknessChange = { walls: string[]; fromCm: number; toCm: number }

/** One corner move, in cm. */
export type CornerMove = { roomId: string; code: string; vertexIndex: number; dxCm: number; dyCm: number; distCm: number }

export type GlobalPreview = { moves: CornerMove[]; thicknessChanges: ThicknessChange[]; report: GlobalReport }

const round1 = (v: number) => roundTo(v, 0.1)

/** One decimal with a comma: 12.44 -> "12,4". */
const fmt1 = (v: number) => v.toFixed(1).replace('.', ',')

/**
 * Solve every room together and move all corners to the result. Thicknesses that the values
 * found are written to the walls (both sides). Returns the same doc when nothing can be solved.
 */
export function applyGlobal(doc: PlanDoc, opts: GlobalApplyOptions = {}): { doc: PlanDoc; report: GlobalReport; solved: GlobalSolved; thicknessChanges: ThicknessChange[] } {
  const solved = solveGlobal(doc, {
    keepLocked: opts.keepLocked ?? true,
    surfaceMode: opts.surfaceMode ?? 'off',
    ...(opts.angles !== undefined ? { angles: opts.angles } : {}),
    ...(opts.surfaceSigmaPct !== undefined ? { surfaceSigmaPct: opts.surfaceSigmaPct } : {}),
    references: doc.apartment?.references ?? [],
  })
  // Corners and thicknesses take the precision of the plan; 0.1 cm when the user turned it off.
  const step = planPrecision(doc) || 0.1
  const snap = (v: number) => roundTo(v, step)
  const fit = solved.residuals.filter((r) => r.kind === 'wall' || r.kind === 'diagonal' || r.kind === 'centre' || r.kind === 'outside')
  const worst = fit.reduce<(typeof fit)[number] | null>((a, r) => (!a || Math.abs(r.diffCm) > Math.abs(a.diffCm) ? r : a), null)
  const found = solved.groups.filter((g) => g.determined)
  const report: GlobalReport = {
    rooms: doc.rooms.length,
    rmsCm: solved.rmsCm,
    lockedKept: solved.residuals.filter((x) => x.kind === 'locked').length,
    foundThicknesses: found.map((g) => ({ walls: g.walls, cm: round1(g.thicknessCm) })),
    ...(worst && Math.abs(worst.diffCm) > 1 ? { worst: { label: worst.label, diffCm: worst.diffCm } } : {}),
    surfaces: solved.surfaces,
    conflicts: pairConflicts(doc, solved.conflicts ?? []),
    outOfSquare: solved.outOfSquare,
  }
  const ok = doc.rooms.every((r) => solved.rooms[r.id]?.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
  if (!ok || !fit.length) return { doc, report, solved, thicknessChanges: [] }

  // Thickness of each room wall from the walls the values found ("SE-4" -> cm).
  // A wall that the data does not determine, but that moved from its prior, can snap to a usual value.
  const thick = new Map<string, number>()
  const thicknessChanges: ThicknessChange[] = []
  for (const g of solved.groups) {
    let cm: number | null = null
    if (g.determined) cm = snap(g.thicknessCm)
    else if (opts.snapThickness && Math.abs(g.thicknessCm - g.priorThicknessCm) > 0.01) cm = nearestUsualThickness(g.thicknessCm)
    if (cm === null || !(cm > 0)) continue
    for (const w of g.walls) thick.set(w, cm)
    if (Math.abs(cm - g.priorThicknessCm) >= 0.05) thicknessChanges.push({ walls: g.walls, fromCm: round1(g.priorThicknessCm), toCm: round1(cm) })
  }
  const rooms = doc.rooms.map((r) => {
    const pts = solved.rooms[r.id]
    const walls = { ...r.walls }
    r.vertices.forEach((v, i) => {
      const cm = thick.get(`${r.code}-${i + 1}`)
      if (cm && cm > 0) walls[v.id] = { ...wallProps(r, v.id), thicknessCm: cm }
    })
    return { ...r, walls, vertices: r.vertices.map((v, i) => ({ ...v, x: snap(pts[i].x), y: snap(pts[i].y) })) }
  })
  return { doc: { ...doc, rooms }, report, solved, thicknessChanges }
}

/** Graph conflicts with room codes instead of room ids, one per pair of rooms and kind. */
function pairConflicts(doc: PlanDoc, list: GraphConflict[]): NonNullable<GlobalReport['conflicts']> {
  const codeOf = (id: string) => doc.rooms.find((r) => r.id === id)?.code ?? id
  const seen = new Set<string>()
  const out: NonNullable<GlobalReport['conflicts']> = []
  for (const c of list) {
    const roomCodes = [...new Set(c.roomIds.map(codeOf))]
    const key = `${c.kind}:${roomCodes.join('+')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ roomCodes, kind: c.kind, detail: c.detail })
  }
  return out
}

/**
 * Show what "Solve whole plan" would do, with no change to the document: every corner move
 * (largest first) and the thickness changes.
 */
export function previewGlobal(doc: PlanDoc, opts: GlobalApplyOptions = {}): GlobalPreview {
  const r = applyGlobal(doc, opts)
  const moves: CornerMove[] = []
  r.doc.rooms.forEach((room, ri) => {
    const before = doc.rooms[ri]
    room.vertices.forEach((v, i) => {
      const dxCm = v.x - before.vertices[i].x, dyCm = v.y - before.vertices[i].y
      const distCm = Math.hypot(dxCm, dyCm)
      if (distCm > 1e-9) moves.push({ roomId: room.id, code: room.code, vertexIndex: i, dxCm, dyCm, distCm })
    })
  })
  moves.sort((a, b) => b.distCm - a.distCm)
  return { moves, thicknessChanges: r.thicknessChanges, report: r.report }
}

/**
 * One line per surface reference, e.g.
 * "DPE 2023 (SE): 12,4 -> 12,9 m2, ref 13,0 m2 (-0,8 %)".
 * The difference is after − reference, in % of the reference.
 */
export function describeSurface(s: GlobalSurface): string {
  const pct = s.diffPct > 0 ? `+${fmt1(s.diffPct)}` : fmt1(s.diffPct)
  return `${s.label}${s.roomCode ? ` (${s.roomCode})` : ''}: ${fmt1(s.beforeM2)} → ${fmt1(s.afterM2)} m², `
    + `ref ${fmt1(s.referenceM2)} m² (${pct} %)`
}

/** One-line summary for the panel: the fit, then one line per surface reference. */
export function describeGlobal(r: GlobalReport): string {
  const f = fmt1
  const parts = [`Solved ${r.rooms} rooms together: fit error ${f(r.rmsCm)} cm rms`]
  if (r.lockedKept) parts.push(`${r.lockedKept} locked wall${r.lockedKept === 1 ? '' : 's'} kept`)
  if (r.worst) parts.push(`largest: ${r.worst.label} ${r.worst.diffCm >= 0 ? '+' : ''}${f(r.worst.diffCm)} cm`)
  parts.push(r.foundThicknesses.length
    ? `thickness found for ${r.foundThicknesses.map((t) => `${t.walls.join('/')} (${f(t.cm)} cm)`).join(', ')}`
    : 'no thickness found from the values (measure CODE-n-T at a door frame)')
  const lines = [parts.join('; ') + '.']
  for (const s of r.surfaces ?? []) lines.push(describeSurface(s))
  for (const q of r.outOfSquare ?? []) lines.push(`Out of square: room ${q.roomCode} ${f(q.deg)}°`)
  for (const c of r.conflicts ?? []) {
    const what = c.kind === 'same-side-overlap' ? 'overlap' : 'touch without sharing one wall'
    lines.push(`Check: rooms ${c.roomCodes.join(' and ')} ${what} (${c.detail})`)
  }
  return lines.join('\n')
}
