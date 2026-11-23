// Forward-mode automatic differentiation with one value and a SPARSE gradient
// (docs/walls-plan.md phase 4b: "Walls in any direction").
//
// A number D = { v, g }: `v` is the value, `g` maps the index of each unknown to the derivative of
// that value with respect to the unknown. Unknowns that a value does not use are not in `g`, so a
// row of the solver keeps a short gradient, and a length row that only uses two walls keeps two
// terms.
//
// Every function returns the exact derivative (no finite differences). All arithmetic is double
// precision, so a fit with these expressions has the same accuracy as a hand-written gradient.
//
// The solver writes each row ONCE as a function of the unknowns (a length, a distance, an angle, an
// area) and the Gauss-Newton step reads the gradient of that function, so no row has a separate
// derivative formula that can disagree with its value.

/** A number whose derivative with respect to each unknown is known. */
export type D = {
  /** Value. */
  v: number
  /** Derivative of the value with respect to each unknown (index -> d v / d x). */
  g: Map<number, number>
}

/** A constant: no derivative. */
export const cst = (v: number): D => ({ v, g: new Map() })

/** The unknown number `index`, which has the value `v`. */
export const variable = (index: number, v: number): D => ({ v, g: new Map([[index, 1]]) })

/** Empty gradient, shared by the helpers below. */
const NONE: Map<number, number> = new Map()

/**
 * k1 * g1 + k2 * g2. Terms that cancel to 0 are removed, so the gradient stays exactly sparse.
 */
function combine(g1: Map<number, number>, k1: number, g2: Map<number, number>, k2: number): Map<number, number> {
  const g = new Map<number, number>()
  for (const [i, c] of g1) {
    const v = c * k1
    if (v !== 0) g.set(i, v)
  }
  for (const [i, c] of g2) {
    const v = c * k2
    const prev = g.get(i) ?? 0
    const sum = prev + v
    if (sum === 0) g.delete(i)
    else g.set(i, sum)
  }
  return g
}

/** a + b */
export const add = (a: D, b: D): D => ({ v: a.v + b.v, g: combine(a.g, 1, b.g, 1) })

/** a - b */
export const sub = (a: D, b: D): D => ({ v: a.v - b.v, g: combine(a.g, 1, b.g, -1) })

/** -a */
export const neg = (a: D): D => ({ v: -a.v, g: combine(a.g, -1, NONE, 0) })

/** a * k, for a constant k */
export const scale = (a: D, k: number): D => (k === 0 ? cst(0) : { v: a.v * k, g: combine(a.g, k, NONE, 0) })

/** a * b (product rule) */
export const mul = (a: D, b: D): D => ({ v: a.v * b.v, g: combine(a.g, b.v, b.g, a.v) })

/** a / b */
export const div = (a: D, b: D): D => {
  const v = a.v / b.v
  return { v, g: combine(a.g, 1 / b.v, b.g, -a.v / (b.v * b.v)) }
}

/** Square root (0 where the value is 0 or negative: a length never is). */
export const sqrt = (a: D): D => {
  const v = Math.sqrt(Math.max(0, a.v))
  return { v, g: v === 0 ? new Map() : combine(a.g, 1 / (2 * v), NONE, 0) }
}

/** sin(a), with a in radians */
export const sin = (a: D): D => ({ v: Math.sin(a.v), g: combine(a.g, Math.cos(a.v), NONE, 0) })

/** cos(a), with a in radians */
export const cos = (a: D): D => ({ v: Math.cos(a.v), g: combine(a.g, -Math.sin(a.v), NONE, 0) })

/** A value that is never used as a divisor. */
const TINY = 1e-12

/** hypot(a, b) */
export const hypot = (a: D, b: D): D => {
  const v = Math.hypot(a.v, b.v)
  const l = v || TINY
  return { v, g: combine(a.g, a.v / l, b.g, b.v / l) }
}

/** atan2(y, x): the angle of the vector (x, y), in radians in (-pi, pi]. */
export const atan2 = (y: D, x: D): D => {
  const v = Math.atan2(y.v, x.v)
  const d = x.v * x.v + y.v * y.v || TINY
  return { v, g: combine(y.g, x.v / d, x.g, -y.v / d) }
}

/** The gradient as a list of [unknown index, derivative], with no zero term. */
export function gradList(d: D, eps = 0): [number, number][] {
  const out: [number, number][] = []
  for (const [i, k] of d.g) if (Math.abs(k) > eps) out.push([i, k])
  return out.sort((a, b) => a[0] - b[0])
}

/** Sum of the terms that use the same unknown (some callers build a gradient by hand). */
export function mergeGrad(terms: [number, number][], eps = 0): [number, number][] {
  const m = new Map<number, number>()
  for (const [v, k] of terms) m.set(v, (m.get(v) ?? 0) + k)
  return [...m].filter(([, k]) => Math.abs(k) > eps).sort((a, b) => a[0] - b[0])
}
