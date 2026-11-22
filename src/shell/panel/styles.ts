// One look for every sidebar block, field and button (docs/sidebar-plan.md §3).
// One border colour, one radius, one padding, one heading style, light + dark.
// Focus rings are NOT repeated here: the base layer of src/index.css already draws
// `outline: 2px solid #ea580c; outline-offset: 1px` on :focus-visible for button,
// input, select, textarea, summary and [tabindex] — that is the app-wide orange-700 ring.
// Touch targets: h-9 (36 px) on fine pointers, `pointer-coarse:h-11` (44 px) on coarse ones.

/** Bordered block used by every panel section. */
export const PANEL_CARD = 'rounded-lg border border-black/10 text-sm dark:border-white/10'

/** The single padding step inside a panel section. */
export const SECTION_PAD = 'p-2'

/** One heading style. */
export const HEADING = 'text-sm font-semibold text-slate-900 dark:text-slate-100'

/** One muted/help colour. */
export const MUTED = 'text-xs text-slate-500 dark:text-slate-400'

/** Text/number/select input. */
export const INPUT =
  'h-9 w-full min-w-0 rounded-md border border-black/15 bg-white px-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-white/15 dark:bg-[#12161b] dark:text-slate-100 dark:placeholder:text-slate-500 pointer-coarse:h-11'

/** Added to an input whose current text is rejected. */
export const INPUT_INVALID = 'border-red-500 dark:border-red-400'

/** Input drawn inside a group that owns the border (so a unit chip can sit in the field). */
export const INPUT_BARE =
  'h-9 w-full min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus-visible:outline-none dark:text-slate-100 dark:placeholder:text-slate-500 pointer-coarse:h-11'

/** Bordered wrapper of a bare input: orange focus ring on focus-within, red when invalid. */
export const inputGroup = (invalid: boolean) =>
  `flex items-center rounded-md border bg-white dark:bg-[#12161b] ${
    invalid
      ? 'border-red-500 dark:border-red-400'
      : 'border-black/15 focus-within:border-orange-700 focus-within:ring-2 focus-within:ring-orange-700/25 dark:border-white/15 dark:focus-within:border-orange-400 dark:focus-within:ring-orange-400/25'
  }`

/** Bordered action button. */
export const BTN =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-black/10 px-2 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10 pointer-coarse:min-h-11'

/** Inline error text under a field. */
export const ERROR = 'text-xs text-red-600 dark:text-red-400'

/** Soft chip (used by Segmented when it is not a bordered group). */
export const CHIP_ACTIVE = 'bg-orange-700 text-white'
export const CHIP_IDLE = 'hover:bg-black/5 dark:hover:bg-white/10'
