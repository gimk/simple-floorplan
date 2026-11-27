// Shared colours for everything drawn on the canvas (SVG layers, overlays and the SVG export).
// Keep hex values here: one place to change the look, no duplicated literals.

/** Selection and active-tool accent (orange 400). */
export const CANVAS_SELECT = '#fb923c'
/** Stronger accent for large selection chrome such as the marquee and the artboard frame (orange 500). */
export const CANVAS_SELECT_STRONG = '#f97316'
/** Deepest accent: reference-image frame and calibration marks (orange 600). */
export const CANVAS_SELECT_DEEP = '#ea580c'
/** Soft translucent accent fills. */
export const CANVAS_SELECT_FILL = 'rgba(251,146,60,0.12)'
export const CANVAS_SELECT_FILL_HOVER = 'rgba(251,146,60,0.3)'
export const CANVAS_MARQUEE_FILL = 'rgba(249,115,22,0.08)'

/** Canvas and export sheet background (same value as --color-surface-0). */
export const CANVAS_BG = '#12161b'
/** Halo drawn around labels (paint-order stroke) so text stays readable over lines. Same as the background. */
export const CANVAS_HALO = CANVAS_BG

/** Label and handle fills. */
export const CANVAS_LABEL = '#f1f5f9'
export const CANVAS_HANDLE_FILL = '#fff'
/** Invalid or destructive preview. */
export const CANVAS_DANGER = '#f87171'
