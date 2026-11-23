// Every derivative of autodiff.ts against a central finite difference (docs/walls-plan.md phase 4b).
// The expressions read two unknowns (index 0 and 1) from `values`.
import { describe, expect, it } from 'vitest'
import {
  add, atan2, cos, cst, div, gradList, hypot, mergeGrad, mul, neg, scale, sin, sqrt, sub, variable, type D,
} from './autodiff'

/** The two unknown values that the test expressions read. */
let values: [number, number] = [0, 0]

const x0 = (): D => variable(0, values[0])
const x1 = (): D => variable(1, values[1])

/** Evaluate f with the two unknowns set to `xs`. */
const at = (f: () => D, xs: [number, number]): D => {
  values = xs
  return f()
}

/** Central difference of f with respect to the unknown k, at xs. */
const fd = (f: () => D, k: number, xs: [number, number], h: number): number => {
  const lo: [number, number] = [xs[0], xs[1]]
  const hi: [number, number] = [xs[0], xs[1]]
  lo[k] = xs[k] - h
  hi[k] = xs[k] + h
  return (at(f, hi).v - at(f, lo).v) / (2 * h)
}

/** Check the exact gradient of f against a central difference, and return the value. */
const check = (f: () => D, xs: [number, number], h = 1e-6): D => {
  const d = at(f, xs)
  const g = new Map(gradList(d))
  for (const k of [0, 1]) {
    const numeric = fd(f, k, xs, h)
    expect(Math.abs((g.get(k) ?? 0) - numeric)).toBeLessThan(1e-6 * Math.max(1, Math.abs(numeric)))
  }
  return d
}

describe('autodiff', () => {
  it('gives the value and the derivative of a constant and of an unknown', () => {
    expect(gradList(cst(3))).toEqual([])
    expect(gradList(variable(2, 7))).toEqual([[2, 1]])
  })

  it('adds and subtracts', () => {
    check(() => add(x0(), x1()), [1.5, -2.25])
    check(() => sub(x0(), x1()), [1.5, -2.25])
    expect(gradList(sub(x1(), x0()))).toEqual([[0, -1], [1, 1]])
  })

  it('negates and scales', () => {
    check(() => neg(x0()), [2, 0])
    check(() => scale(x0(), -3.5), [2, 0])
    expect(gradList(scale(x1(), 0))).toEqual([])
  })

  it('multiplies', () => {
    check(() => mul(x0(), x1()), [3, -4])
    // The gradient of x0 * x0 is 2 x0.
    expect(gradList(at(() => mul(x0(), x0()), [3, 0]))).toEqual([[0, 6]])
  })

  it('divides', () => {
    check(() => div(x0(), x1()), [3, -4])
    check(() => div(x1(), add(x0(), cst(1))), [-0.5, 2])
  })

  it('takes a square root', () => {
    check(() => sqrt(x0()), [9, 0])
    check(() => sqrt(add(mul(x0(), x0()), mul(x1(), x1()))), [3, 4])
    // At 0 the derivative of the square root is infinite: it gives 0, not NaN.
    expect(gradList(at(() => sqrt(x0()), [0, 0]))).toEqual([])
  })

  it('takes sin and cos', () => {
    check(() => sin(x0()), [0.7, 0])
    check(() => cos(x0()), [0.7, 0])
    check(() => sin(mul(x0(), x1())), [0.7, 1.3])
  })

  it('takes a hypotenuse', () => {
    check(() => hypot(x0(), x1()), [3, 4])
    check(() => hypot(sub(x0(), x1()), add(x0(), cst(2))), [3, 4])
    expect(at(() => hypot(cst(0), cst(0)), [0, 0]).v).toBe(0)
  })

  it('takes atan2', () => {
    check(() => atan2(x1(), x0()), [3, 4])
    check(() => atan2(x0(), x1()), [-3, 4])
    // A vector near the negative x axis: the angle is close to pi, the derivative is finite.
    check(() => atan2(x1(), x0()), [-2, 0.5])
  })

  it('keeps the gradient sparse, and merges the terms of one unknown', () => {
    // (x0 - x0) has a zero derivative in x0, so the term goes away.
    expect(gradList(at(() => sub(x0(), x0()), [2, 5]))).toEqual([])
    expect(gradList(at(() => add(scale(x0(), 2), scale(x0(), -2)), [2, 5]))).toEqual([])
    expect(mergeGrad([[0, 1], [0, 2], [1, 0], [2, -1]])).toEqual([[0, 3], [2, -1]])
  })

  it('chains through a longer expression', () => {
    // len = hypot(x0 * 2, x1 + 3) / sqrt(x0 + 4)
    const f = () => div(hypot(scale(x0(), 2), add(x1(), cst(3))), sqrt(add(x0(), cst(4))))
    check(f, [1.25, -0.5])
    check(f, [-0.75, 2], 1e-7)
  })
})
