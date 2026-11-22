// Comma-decimal parsing and formatting for the sidebar field primitives.
// Reuses the helpers the app already has instead of adding a second parser:
//   - parseCommaNumber() in src/features/background/rotate.ts ("4,25" -> 4.25)
//   - fmtCm() in src/model/geometry.ts ("412,5")
import { parseCommaNumber } from '../../features/background/rotate'
import { fmtCm } from '../../model/geometry'

/**
 * Parse a text field value: "4,25", "4.25", " 412 ", "-12,5".
 * Returns null for empty text and for anything that is not one finite number.
 */
export const parseDecimal = (text: string): number | null => {
  if (text.trim() === '') return null
  const n = parseCommaNumber(text)
  return Number.isFinite(n) ? n : null
}

/** Value shown in a cm field: "412", "412,5", "" when there is no value. */
export const formatCmInput = (cm: number | null | undefined): string => {
  if (cm == null) return ''
  return Number.isFinite(cm) ? fmtCm(cm) : ''
}

/** Fixed decimals with a French comma separator: (12, 2) -> "12,00", (3.456, 2) -> "3,46". */
export const formatDecimal = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return ''
  const fixed = Math.abs(value).toFixed(digits)
  const safe = value < 0 && Number(fixed) !== 0 ? `-${fixed}` : fixed
  return safe.replace('.', ',')
}

/** Same as formatDecimal but 2 decimals: m², %, area deltas. */
export const formatM2 = (value: number): string => formatDecimal(value, 2)
