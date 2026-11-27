// Pure keyboard-shortcut matchers that must not depend on the keyboard layout.
// Kept React-free and DOM-free so a test can call them with a plain object.

/** The parts of a KeyboardEvent a shortcut matcher needs. */
export type KeyLike = {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Cmd/Ctrl+' shows or hides the canvas grid (drawn in Plan mode only).
 *
 * The physical key of `'` moves with the layout: on a US layout it is `Quote`, on a French AZERTY
 * keyboard the `'` sits on `Digit4`. So the key character and the physical code are both accepted,
 * which also covers a synthetic event that carries only one of them. Shift is allowed, because some
 * layouts need it to type `'`. Alt is refused, so the Option shortcuts keep their own meaning.
 */
export function isGridToggleShortcut(e: KeyLike): boolean {
  const isQuoteKey = e.code === 'Quote' || e.key === "'"
  return (e.metaKey || e.ctrlKey) && !e.altKey && isQuoteKey
}
