// Units of the lengths written on the plan (docs/measurements-plan.md section 5): centimetres
// (default), metres or millimetres, with 0 to 3 decimals. Pure: no store, no React.
//
// The plan writes BARE numbers, as architects do ("412,5", "4,13", "4125"). The unit itself is
// written in the View menu, in the legends and in the tooltips (see `unitSuffix`).
//
// Rules:
//   - the decimal separator is a comma (as `fmtCm` in model/geometry.ts);
//   - cm and mm drop the trailing zeros ("412,50" -> "412,5", "412,0" -> "412");
//   - m KEEPS the trailing zeros ("4,10"), and uses at least 2 decimals (0 or 1 -> 2), so a
//     metre length always reads like an architect writes it;
//   - a value rounds half up (Math.round), the same rule as `fmtCm`, so the default units
//     (cm, 1 decimal) give exactly the text `fmtCm` gives today;
//   - -0 is written "0".

/** Units of a length on the plan. Same shape as `CanvasUnits` of the store. */
export type LengthUnits = { unit: 'cm' | 'm' | 'mm'; decimals: number }

/** The units of the plan before the user changes anything: centimetres, 1 decimal (as `fmtCm`). */
export const DEFAULT_UNITS: LengthUnits = { unit: 'cm', decimals: 1 }

/** Suffix of the unit, for tooltips and legends: 'cm' | 'm' | 'mm'. */
export const unitSuffix = (units: LengthUnits | undefined): 'cm' | 'm' | 'mm' => units?.unit ?? DEFAULT_UNITS.unit

/**
 * Digits after the comma of a length in `units`: 0 to 3 (a missing or odd setting falls back to 1
 * for cm and mm, 2 for m). Metres use at least 2 decimals.
 */
export function unitDecimals(units: LengthUnits | undefined): number {
  const raw = units?.decimals
  const d = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(3, Math.max(0, Math.round(raw))) : 1
  return unitSuffix(units) === 'm' ? Math.max(2, d) : d
}

/** A length in cm written in the unit, before rounding: 412,5 cm -> 4,125 m or 4125 mm. */
export const unitValue = (cm: number, units: LengthUnits | undefined): number => {
  const v = Number.isFinite(cm) ? cm : 0
  switch (unitSuffix(units)) {
    case 'm':
      return v / 100
    case 'mm':
      return v * 10
    default:
      return v
  }
}

/** Round to `decimals`, half up (as `fmtCm`), and turn -0 into 0. */
const roundDecimals = (v: number, decimals: number): number => {
  const f = 10 ** decimals
  const r = Math.round(v * f) / f
  return r === 0 ? 0 : r
}

/**
 * A length in cm as the plan writes it, in the units of the View menu, without a unit suffix:
 *   412,5 cm -> "412,5" (cm, 1) | "4,13" (m, 2) | "4125" (mm, 0)
 *   412 cm   -> "412"   (cm, 1) | "4,10" (m, 2) | "4120" (mm, 0)
 * The default units (cm, 1 decimal) give exactly what `fmtCm` gives.
 */
export function fmtLen(cm: number, units: LengthUnits | undefined = DEFAULT_UNITS): string {
  const unit = unitSuffix(units)
  const decimals = unitDecimals(units)
  const v = roundDecimals(unitValue(cm, units), decimals)
  // Metres keep their trailing zeros ("4,10"); cm and mm drop them ("412", "4125").
  const text = unit === 'm' ? v.toFixed(decimals) : String(v)
  return text.replace('.', ',')
}
