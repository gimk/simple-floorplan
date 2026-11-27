// One look for every sidebar block, field and button (docs/sidebar-plan.md §3).
// One border colour, one radius, one padding, one heading style.
// The app is DARK ONLY (src/shell/theme.ts keeps data-theme="dark" on <html>), so these
// constants carry the dark appearance directly: no `dark:` pairs, no light base classes.
// Surfaces use the tokens of src/index.css (bg-surface-0/1/2); grays are the slate family.
// Focus rings are NOT repeated here: the base layer of src/index.css already draws
// `outline: 2px solid #ea580c; outline-offset: 1px` on :focus-visible for button,
// input, select, textarea, summary and [tabindex] — that is the app-wide orange-700 ring.
// Touch targets: h-9 (36 px) on fine pointers, `pointer-coarse:h-11` (44 px) on coarse ones.
// Type scale: nothing readable goes below 12 px (text-xs); 11 and 10 px are reserved for
// non-text decoration such as a shortcut glyph.

/** Bordered block used by every panel section. */
export const PANEL_CARD = 'rounded-lg border border-white/10 bg-surface-1 text-sm'

/**
 * Spacing scale of the panel: card padding p-3, gap between blocks gap-3, gap between rows gap-2,
 * gap between a label and its field gap-1. Row padding is p-2.
 */
export const SECTION_PAD = 'p-3'

/** Gap between the rows inside a card body. */
export const ROW_GAP = 'gap-2'

/** Gap between a label and its field, or a field and its hint. */
export const FIELD_GAP = 'gap-1'

/** One selectable row inside a card. The padding and the border are the same when the row is
 * selected, so a selection does not move anything (unselected = transparent border). */
export const ROW = 'rounded-md border p-2'
export const ROW_OFF = 'border-transparent'
export const ROW_ON = 'border-orange-500/60 bg-orange-500/15'

/** One heading style. */
export const HEADING = 'text-sm font-semibold text-slate-100'

/** One inspector label: 12 px, medium weight, readable on the surface colours. */
export const LABEL = 'text-xs font-medium text-slate-300'

/** One muted/help colour. */
export const MUTED = 'text-xs text-slate-400'

/** A hint line under a label: same 12 px as the label, regular weight, one step quieter. */
export const HINT = 'text-xs font-normal text-slate-400'

/** Text/number/select input. */
export const INPUT =
  'h-9 w-full min-w-0 rounded-md border border-white/30 bg-surface-0 px-2 text-sm text-slate-100 placeholder:text-slate-500 hover:border-white/50 pointer-coarse:h-11'

/** Added to an input whose current text is rejected. */
export const INPUT_INVALID = 'border-red-400'

/** Input drawn inside a group that owns the border (so a unit chip can sit in the field). */
export const INPUT_BARE =
  'h-9 w-full min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus-visible:outline-none pointer-coarse:h-11'

/** Bordered wrapper of a bare input: orange focus ring on focus-within, red when invalid. */
export const inputGroup = (invalid: boolean) =>
  `flex items-center rounded-md border bg-surface-0 ${
    invalid
      ? 'border-red-400'
      : 'border-white/30 hover:border-white/50 focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-400/25'
  }`

/** Bordered action button. */
export const BTN =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-white/10 px-2 text-sm hover:bg-white/10 disabled:opacity-50 pointer-coarse:min-h-11'

/** Filled primary action button (accent colour). */
export const BTN_PRIMARY =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-transparent bg-accent px-3 text-sm font-medium text-white hover:bg-accent-bright disabled:opacity-50 pointer-coarse:min-h-11'

/** Red danger action button (delete). */
export const BTN_DANGER =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-red-400/50 px-3 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50 pointer-coarse:min-h-11'

/** Inline error text under a field. */
export const ERROR = 'text-xs text-red-400'

/** Soft chip (used by Segmented when it is not a bordered group). */
export const CHIP_ACTIVE = 'bg-orange-700 text-white'
export const CHIP_IDLE = 'hover:bg-white/10'

/** Value state colours: grey estimated, green measured, purple solved. */
export const MEASURED_TEXT = 'text-emerald-400'
export const MEASURED_FILL = 'fill-emerald-400'
/** A measured value the plan does not fit: amber, with the "~" of the text (docs/measurements-plan.md). */
export const MISMATCH_TEXT = 'text-amber-400'
export const MISMATCH_FILL = 'fill-amber-400'
export const MISMATCH_HEX = '#b45309'
export const ESTIMATED_TEXT = 'text-slate-400'
export const ESTIMATED_FILL = 'fill-slate-300'
export const SOLVED_TEXT = 'text-violet-400'
export const SOLVED_FILL = 'fill-violet-400'
export const SOLVED_STROKE = 'stroke-violet-400'
export const SOLVED_BG = 'bg-violet-950'
export const SOLVED_BORDER = 'border-violet-400'
export const SOLVED_ACCENT = 'accent-violet-600'
export const SOLVED_HEX = '#6d28d9'
