// Suggested measurements (docs/walls-plan.md phase 2b): which value to measure NEXT, and why.
//
// Every candidate is one row that the solver could add: a room wall inside face, the diagonal of a
// room, or a wall thickness. With C = covariance of the unknowns after the fit (inverse of the
// normal matrix), a candidate of gradient g and sigma s takes away
//
//     gain = (C g)ᵀ W (C g) / (s² + gᵀ C g)          (cm²)
//
// from the summed variance of the unknowns that matter (W: wall positions and thicknesses). The
// list is greedy: after the best candidate, C is updated as if the value was measured
// (Sherman-Morrison, rank 1) and the rest is scored again. So the list is "measure these, in this
// order", not "these values all give the same information".
//
// Pure: no store, no side effect. The panel writes the value the user types.
import type { PlanDoc } from '../../model/types'
import { thicknessIds } from '../../model/survey'
import {
  covarianceTimes, GLOBAL_SOLVE_DEFAULTS, solveGlobalWithModel,
  type CandidateQuantity, type GlobalOptions, type Grad, type SolveModel,
} from './globalSolve'

export type SuggestionKind = 'wall' | 'diagonal' | 'thickness'

export type Suggestion = {
  /** Survey ID the user types: "SE-2", "SE-D", "SE-6-T". */
  label: string
  kind: SuggestionKind
  roomId: string
  /** For a wall or a thickness: start vertex id of the wall. */
  wallStart?: string
  /** For a diagonal: the two inside corner indexes of the room. */
  diagonal?: [number, number]
  /** Uncertainty of the value now (cm): the standard deviation of its solved value. */
  nowSdCm: number
  /** Solved value of the quantity now (cm): what the plan says before the measurement. */
  plannedCm: number
  /** Reduction of the summed variance of the unknowns (cm²). */
  gain: number
  /** Short reason shown under the label. */
  reason: string
}

/** A measured value that the plan does not fit: measure it again. */
export type Remeasure = { label: string; measuredCm: number; solvedCm: number; diffCm: number }

export type SuggestOptions = GlobalOptions & {
  /** Maximum number of suggestions (default 10). */
  limit?: number
  /** Sigma of a value the user types in (default 1 cm: a tape measure). */
  sigmaCm?: number
  /** Smallest gain that is worth a measurement, in cm² (default 0.25: a 0.5 cm sd). */
  minGainCm?: number
  /**
   * Smallest gain of a CHECK value (a diagonal of a room that the data already finds), in cm².
   * Lower than minGainCm: a check value brings little new data, but it is the only way to find
   * a wrong measurement (default 0.02).
   */
  checkMinGainCm?: number
}

export type SuggestResult = { suggestions: Suggestion[]; remeasure: Remeasure[] }

/** A candidate row, ready to score. */
type Candidate = {
  q: CandidateQuantity
  label: string
  kind: SuggestionKind
  roomId: string
  wallStart?: string
  diagonal?: [number, number]
  plannedCm: number
  grad: Grad
}

const NO_SUGGESTIONS: Suggestion[] = []

/** A value is present when it is a positive, finite number (empty values are removed on purpose). */
const hasValue = (doc: Pick<PlanDoc, 'measurements'>, label: string): boolean => {
  const cm = doc.measurements[label]?.actualCm
  return !!cm && Number.isFinite(cm) && cm > 0
}

/**
 * The diagonal of a room that the list offers: the one the room already has, else the longest one.
 * Adjacent corners cannot be a diagonal.
 */
function pickDiagonal(model: SolveModel, roomId: string, n: number, current?: [number, number]): [number, number] | null {
  const valid = (i: number, j: number) =>
    Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0 && i < n && j < n &&
    i !== j && (j + 1) % n !== i && (i + 1) % n !== j
  if (current && valid(current[0], current[1])) return current
  let best: [number, number] | null = null
  let bestCm = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!valid(i, j)) continue
      const q = model.quantity({ kind: 'diagonal', roomId, i, j })
      if (!q) continue
      if (!best || q.value > bestCm) {
        best = [i, j]
        bestCm = q.value
      }
    }
  }
  return best
}

/** Every target of the plan that has no value yet, with its gradient at the solved x. */
function buildCandidates(doc: Pick<PlanDoc, 'rooms' | 'measurements'>, model: SolveModel): Candidate[] {
  const out: Candidate[] = []
  // Room wall -> group id, from the report (a group lists the labels of its room walls).
  const groupOfLabel = new Map<string, number>()
  for (const g of model.solved.groups) for (const w of g.walls) if (!groupOfLabel.has(w)) groupOfLabel.set(w, g.id)

  for (const r of doc.rooms) {
    const n = r.vertices.length
    for (let i = 0; i < n; i++) {
      const label = `${r.code}-${i + 1}`
      if (hasValue(doc, label)) continue
      const q = model.quantity({ kind: 'wall', roomId: r.id, wallIndex: i })
      if (!q) continue
      out.push({
        q: { kind: 'wall', roomId: r.id, wallIndex: i },
        label, kind: 'wall', roomId: r.id, wallStart: r.vertices[i].id,
        plannedCm: q.value, grad: q.grad,
      })
    }
    // Thicknesses: only the labels that thicknessIds gives, so a shared wall has ONE candidate.
    for (const t of thicknessIds(doc, r)) {
      if (hasValue(doc, t.label)) continue
      const index = t.wallStart ? r.vertices.findIndex((v) => v.id === t.wallStart) : -1
      const groupId = index >= 0 ? groupOfLabel.get(`${r.code}-${index + 1}`) : undefined
      if (groupId === undefined) continue
      const q = model.quantity({ kind: 'thickness', groupId })
      if (!q) continue
      out.push({
        q: { kind: 'thickness', groupId },
        label: t.label, kind: 'thickness', roomId: r.id,
        ...(t.wallStart ? { wallStart: t.wallStart } : {}),
        plannedCm: q.value, grad: q.grad,
      })
    }
    // One diagonal per room, and only when the room has no diagonal value yet: it is a check value.
    if (n >= 4 && !hasValue(doc, `${r.code}-D`)) {
      const pair = pickDiagonal(model, r.id, n, r.diagonal)
      if (pair) {
        const q = model.quantity({ kind: 'diagonal', roomId: r.id, i: pair[0], j: pair[1] })
        if (q) {
          out.push({
            q: { kind: 'diagonal', roomId: r.id, i: pair[0], j: pair[1] },
            label: `${r.code}-D`, kind: 'diagonal', roomId: r.id, diagonal: pair,
            plannedCm: q.value, grad: q.grad,
          })
        }
      }
    }
  }
  return out
}

const dot = (g: Grad, v: number[]) => g.reduce((s, [i, k]) => s + k * v[i], 0)

/** Short reason for a suggestion, in the words of the plan. */
function reasonFor(kind: SuggestionKind, nowSdCm: number, determined?: boolean): string {
  if (kind === 'thickness' && determined === false) return 'thickness not found by the data'
  if (nowSdCm > 5) return 'position only from the drawing'
  return 'check value (adds redundancy)'
}

/**
 * Greedy list of the best measurements, and the measured values that do not fit.
 * Pure: the same document and options always give the same list.
 */
export function suggestMeasurements(
  doc: Pick<PlanDoc, 'rooms' | 'measurements' | 'apartment'>,
  opts: SuggestOptions = {},
): SuggestResult {
  const limit = Math.max(0, Math.floor(opts.limit ?? 10))
  const sigma = opts.sigmaCm ?? 1
  const minGain = opts.minGainCm ?? 0.25
  const checkMinGain = opts.checkMinGainCm ?? 0.02
  const model = solveGlobalWithModel(doc, opts)

  // Measured values that the fit cannot explain: the outlier rows of the solve.
  const measureSigma = opts.measureSigmaCm ?? GLOBAL_SOLVE_DEFAULTS.measureSigmaCm
  const remeasure: Remeasure[] = model.solved.residuals
    .filter((r) => (r.kind === 'wall' || r.kind === 'diagonal') && Math.abs(r.diffCm) > 3 * measureSigma)
    .map((r) => ({ label: r.label, measuredCm: r.measuredCm, solvedCm: r.solvedCm, diffCm: r.diffCm }))
    .sort((a, b) => Math.abs(b.diffCm) - Math.abs(a.diffCm) || a.label.localeCompare(b.label))

  const candidates = buildCandidates(doc, model)
  if (!model.chol || !candidates.length || !limit) return { suggestions: NO_SUGGESTIONS, remeasure }

  // W: 1 on the centre line and the thickness of a wall. A free corner is not a wall position.
  const matters = new Array<boolean>(model.x.length).fill(false)
  for (const g of model.groupVars) {
    matters[g.coord] = true
    matters[g.thick] = true
  }
  const weight = (v: number[]) => v.reduce((s, x, i) => (matters[i] ? s + x * x : s), 0)

  // v = C g for each candidate. The covariance is never built: two triangular solves are enough.
  let live: { c: Candidate; v: number[] }[] = []
  for (const c of candidates) {
    const v = covarianceTimes(model.chol, c.grad)
    if (v) live.push({ c, v })
  }

  const suggestions: Suggestion[] = []
  while (suggestions.length < limit && live.length) {
    let pickIdx = -1
    let pickGain = 0
    let pickVar = 0
    for (let i = 0; i < live.length; i++) {
      const gv = dot(live[i].c.grad, live[i].v) // gᵀ C g
      const gain = weight(live[i].v) / (sigma * sigma + gv)
      if (pickIdx < 0 || gain > pickGain + 1e-12) {
        pickIdx = i
        pickGain = gain
        pickVar = Math.max(0, gv)
      }
    }
    if (pickIdx < 0 || pickGain < minGain) break
    const picked = live[pickIdx]
    const nowSdCm = Math.sqrt(pickVar)
    const determined = picked.c.kind === 'thickness' && picked.c.q.kind === 'thickness'
      ? model.solved.groups[picked.c.q.groupId]?.determined
      : undefined
    suggestions.push({
      label: picked.c.label,
      kind: picked.c.kind,
      roomId: picked.c.roomId,
      ...(picked.c.wallStart ? { wallStart: picked.c.wallStart } : {}),
      ...(picked.c.diagonal ? { diagonal: picked.c.diagonal } : {}),
      nowSdCm,
      plannedCm: picked.c.plannedCm,
      gain: pickGain,
      reason: reasonFor(picked.c.kind, nowSdCm, determined),
    })

    // C <- C - (C g)(C g)ᵀ / (s² + gᵀ C g), so the other candidates lose what this one brings.
    const w = picked.v
    const d = sigma * sigma + pickVar
    live = live
      .filter((_, i) => i !== pickIdx)
      .map((item) => ({ c: item.c, v: item.v.map((x, k) => x - (w[k] * dot(item.c.grad, w)) / d) }))
  }
  // Check values: diagonals that were not picked above, because the walls of their room already
  // find it. Each one adds redundancy, so a wrong value can be found. Best gain first.
  const checks = live
    .filter((item) => item.c.kind === 'diagonal')
    .map((item) => {
      const gv = Math.max(0, dot(item.c.grad, item.v))
      return { item, gv, gain: weight(item.v) / (sigma * sigma + gv) }
    })
    .filter((x) => x.gain >= checkMinGain)
    .sort((a, b) => b.gain - a.gain || a.item.c.label.localeCompare(b.item.c.label))
  for (const { item, gv, gain } of checks) {
    if (suggestions.length >= limit) break
    suggestions.push({
      label: item.c.label,
      kind: item.c.kind,
      roomId: item.c.roomId,
      ...(item.c.diagonal ? { diagonal: item.c.diagonal } : {}),
      nowSdCm: Math.sqrt(gv),
      plannedCm: item.c.plannedCm,
      gain,
      reason: 'check value (adds redundancy)',
    })
  }
  return { suggestions, remeasure }
}
