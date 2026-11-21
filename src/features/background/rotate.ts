// Pure helpers for background rotation and calibration input (docs/plan.md 7.2 #12).

/** Wrap an angle to (-180, 180]. */
export const normalizeDeg = (d: number): number => {
  if (!Number.isFinite(d)) return 0
  let r = d % 360
  if (r > 180) r -= 360
  else if (r <= -180) r += 360
  return r
}

/** Rotate by delta (e.g. ±90 for the quarter-turn buttons), result in (-180, 180]. */
export const rotateBy = (d: number, delta: number): number => normalizeDeg(d + delta)

/** Parse a decimal number that may use a comma separator ("4,25" -> 4.25). */
export const parseCommaNumber = (s: string): number => {
  const t = s.trim()
  if (!t) return NaN
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
