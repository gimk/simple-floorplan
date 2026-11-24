// Typing a length on the plan (docs/measurements-plan.md section 4): pure helpers plus the small
// store of the field that opens on a DOUBLE-CLICK on a dimension text.
//
// A dimension text writes the MEASURED value of the face it measures, with the same write as
// Measuring Mode (`setMeasurement` in features/measure/actions.ts). Which value it writes comes
// from its label:
//   - a room wall dimension text, and the helper dimension of a room face -> the survey label of
//     the face, e.g. 'SE-2';
//   - an outside face / a facade span -> the outside value 'W12-E' (only when it exists);
//   - the centre helper of a wall -> 'W12-C'.
// The key drawn on the plan (`data-dim-key`) is not always that label: an outside span of a
// selected wall is keyed 'out:R:0' and has no value of its own. `dimTextLabel` maps one to the
// other, and it is the only place that decides.
import { create } from 'zustand'
import type { Mode, ToolId, Vec } from '../../../model/types'
import { parseDecimal } from '../../../shell/panel/number'

/** The kinds of dimension text the plan draws (the `kind` of DimLineView). */
export type DimTextKind = 'wall' | 'helper' | 'outside'

/** Survey label of a room face, or a wall value: one or more words, a dash, digits, a dash, a number. */
const ROOM_FACE = /^(.+)-(\d+)$/
/** Value of a stored wall: its centre line ('W12-C') or its outside face ('W12-E'). */
const WALL_VALUE = /^(.+)-[CE]$/

/** Code and number of a room wall label ('SE-2' -> { code: 'SE', n: 2 }), or null. */
export function parseRoomWallLabel(label: string): { code: string; n: number } | null {
  const m = ROOM_FACE.exec(label)
  if (!m) return null
  const n = Number(m[2])
  return Number.isInteger(n) && n >= 1 ? { code: m[1], n } : null
}

/** True for the label of one face of a room ('SE-2'), not for 'SE-2-T', 'SE-D' or 'W12-E'. */
export const isRoomWallLabel = (label: string) => parseRoomWallLabel(label) !== null

/** True for the value of a stored wall: 'W12-C' (centre line) or 'W12-E' (outside face). */
export const isWallValueLabel = (label: string) => WALL_VALUE.test(label)

/**
 * The measurement label that one dimension text of the plan writes, or null when the text writes
 * no value (the overall length of an outside run, an outside span that is not a whole facade).
 * `facadeLabel` is the outside value of the wall of an outside helper span ('W12-E'), null when
 * that span has none.
 */
export function dimTextLabel(kind: DimTextKind, dimKey: string, facadeLabel?: string | null): string | null {
  // The overall row of an outside chain is the length of the whole run: no value of its own.
  if (kind === 'outside') return isWallValueLabel(dimKey) ? dimKey : null
  // A wall length and the helper dimensions of a wall: a room face or a wall value, as drawn.
  if (isRoomWallLabel(dimKey) || isWallValueLabel(dimKey)) return dimKey
  // An outside span of one side of the selected wall: the value of the whole facade, when there is one.
  return facadeLabel && isWallValueLabel(facadeLabel) ? facadeLabel : null
}

/**
 * True when the plan accepts a typed length: Edit mode, with the Select tool (`interactive` of
 * useRoomsFrame also says 'not in Measuring Mode', and that mode is not 'edit' anyway).
 */
export const dimEditAllowed = (mode: Mode, tool: ToolId) => mode === 'edit' && tool === 'select'

/**
 * The label of the next (delta 1) or previous (delta -1) wall of the same room, wrapping around
 * ('SE-1' -> 'SE-2', 'SE-4' -> 'SE-1' with four walls). null when the label is not a room wall
 * label: a wall value ('W12-E'), a thickness ('SE-2-T') or a diagonal ('SE-D') has no neighbour.
 */
export function stepRoomWallLabel(label: string, delta: number, faces: number): string | null {
  const at = parseRoomWallLabel(label)
  if (!at || !Number.isInteger(faces) || faces < 1) return null
  const step = ((at.n - 1 + delta) % faces + faces) % faces
  return `${at.code}-${step + 1}`
}

/** What the field holds, read from its text. */
export type DimValue =
  | { kind: 'empty' }
  | { kind: 'cm'; cm: number }
  | { kind: 'invalid'; message: string }

/**
 * Read the text of the field: empty text removes the value, a comma decimal ('412,5') gives the
 * length in cm, and anything else (a word, a length of 0 or less) is an error the field shows.
 */
export function parseDimValue(text: string): DimValue {
  if (text.trim() === '') return { kind: 'empty' }
  const cm = parseDecimal(text)
  if (cm === null) return { kind: 'invalid', message: 'Enter a number, for example 412,5' }
  if (!(cm > 0)) return { kind: 'invalid', message: 'The length must be more than 0 cm' }
  return { kind: 'cm', cm }
}

/** What the field writes, and where it sits on the plan. */
export type DimEditOpen = {
  /** Measurement label written by the text, e.g. 'SE-2' or 'W12-E'. */
  label: string
  /** Centre of the dimension text on the plan, cm. */
  at: Vec
  /** Length of the face on the plan, cm: the placeholder of the field. */
  plannedCm: number
  /** Room of a room wall text ('SE'), for Tab; undefined for a wall or an outside value. */
  roomCode?: string
  /** Number of walls of that room, so that Tab wraps around. */
  faces?: number
}

/** Tab / Shift+Tab: where the field goes next, or null when the label has no neighbour. */
export type DimEditorStep = (from: DimEditOpen, delta: number) => DimEditOpen | null

type DimEditState = {
  /** The open field, null when no dimension text is being edited. */
  edit: DimEditOpen | null
  open: (edit: DimEditOpen) => void
  close: () => void
}

/**
 * State of the one field of the plan. The dimension texts of the walls, of the helper dimensions
 * and of the outside chains all open it, and RoomsOverlay draws it, so a text of any of those
 * layers can be typed on.
 */
export const useDimEdit = create<DimEditState>()((set) => ({
  edit: null,
  open: (edit) => set({ edit }),
  close: () => set({ edit: null }),
}))
