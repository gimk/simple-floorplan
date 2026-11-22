// Pure helpers for the tape and pin inspectors (TapePanel, PinPanel). No React here.
import { fmtCm } from '../../model/geometry'
import type { TapeMeasure } from '../../model/types'
import type { StatItem } from '../../shell/panel'
import { tracedCm } from './logic'

/** Name (and id) of the tape fields: kept from the pre-migration markup. */
export const TAPE_FIELD_NAMES = {
  realLength: 'tapeLength',
  note: 'tapeNote',
} as const

/** Name (and id) of the pin text field: kept from the pre-migration markup. */
export const PIN_FIELD_NAMES = {
  note: 'pinNote',
} as const

/** Stats of a tape: the length drawn on the plan, in cm. */
export const tapeStats = (t: Pick<TapeMeasure, 'a' | 'b'>): StatItem[] => [
  { label: 'Drawn length', value: `${fmtCm(tracedCm(t))} cm` },
]

/** Patch for the "Real length" field: an emptied field clears the measured value. */
export const realLengthPatch = (cm: number | null): Partial<TapeMeasure> => ({ actualCm: cm ?? undefined })

/** Patch for the tape note: empty text clears the note, as before the migration. */
export const notePatch = (text: string): Partial<TapeMeasure> => ({ note: text ? text : undefined })

/** Patch for the pin text: empty text clears it, as before the migration. */
export const pinTextPatch = (text: string) => ({ text: text ? text : undefined })
