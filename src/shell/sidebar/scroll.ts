// Scroll helpers of the sidebar shell (docs/sidebar-plan-3.md step 5): a new selection must
// show the top of its Inspect card. The scrolling container is the <aside> in App.tsx, found
// by walking up the parents. `getComputedStyle` and `scrollTo` may not exist in a test render.

/** Overflow-y of a node; `getComputedStyle` does not exist in every test render. */
const overflowYOf = (node: HTMLElement): string =>
  typeof getComputedStyle === 'function' ? getComputedStyle(node).overflowY : ''

/** Nearest ancestor of `el` that scrolls, or null. */
export function scrollParent(el: HTMLElement | null, overflowY: (node: HTMLElement) => string = overflowYOf): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const value = overflowY(node)
    if ((value === 'auto' || value === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

/** Put the top of `el` in view. Returns the scroller it used, or null. */
export function scrollToTop(el: HTMLElement | null, overflowY?: (node: HTMLElement) => string): HTMLElement | null {
  const scroller = scrollParent(el, overflowY)
  if (scroller && typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: 0 })
  return scroller
}
