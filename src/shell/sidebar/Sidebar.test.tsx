// Sidebar shell: three tabs, the Inspect context and the Plan / Solve panels.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { scrollParent, scrollToTop } from './scroll'
import { Sidebar } from './Sidebar'

describe('Sidebar shell', () => {
  it('renders the three tabs with Inspect active', () => {
    const html = renderToString(<Sidebar />)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('>Inspect<')
    expect(html).toContain('>Solve<')
    expect(html).toContain('>Plan<')
    expect(html).toContain('role="tabpanel"')
  })

  it('gives the Solve tab the whole-plan sections', () => {
    const html = renderToString(<Sidebar />)
    expect(html).toContain('-panel-solve"')
    expect(html).toContain('aria-label="Solver"')
    expect(html).toContain('aria-label="Progress"')
    expect(html).toContain('aria-label="Settings"')
    // The whole-plan tools live there now, not in the room card.
    expect(html).toContain('name="solveKeepLocked"')
    expect(html).toContain('aria-label="Precision of solved corners and thicknesses"')
  })

  it('mounts the panels unchanged, including the layer checkboxes', () => {
    const html = renderToString(<Sidebar />)
    expect(html).toContain('aria-label="Selection"')
    expect(html).toContain('aria-label="Apartment"')
    expect(html).toContain('name="layer-background"')
    expect(html).toContain('name="layer-notes"')
  })

  it('gives the Plan tab one collapsible section per global tool', () => {
    const html = renderToString(<Sidebar />)
    for (const title of ['Background', 'Layers', 'Calculators', 'Export']) {
      expect(html).toContain(`aria-label="${title}"`)
    }
    // The sections own their content: no double border box around them any more.
    expect(html).not.toContain('<details')
    expect(html).toContain('name="wastePct"')
    expect(html).toContain('name="coverage"')
    expect(html).toContain('name="exportA3"')
    expect(html).toContain('name="exportWithBg"')
  })
})

describe('Sidebar Inspect context', () => {
  it('puts the breadcrumb before the cards of the Inspect tab', () => {
    const html = renderToString(<Sidebar />)
    const breadcrumb = html.indexOf('aria-label="Selection"')
    const apartment = html.indexOf('aria-label="Apartment"')
    expect(breadcrumb).toBeGreaterThan(-1)
    expect(apartment).toBeGreaterThan(breadcrumb)
  })

  it('shows no room, wall or vertex card when nothing is selected', () => {
    // The one-context rule itself is covered in features/rooms/panel.test.tsx: a server
    // render of the shell always reads the initial state of the stores.
    const html = renderToString(<Sidebar />)
    expect(html).not.toContain('aria-label="Room"')
    expect(html).not.toContain('aria-label="Walls"')
    expect(html).not.toContain('aria-label="On this wall"')
    expect(html).not.toContain('aria-label="Vertex"')
    expect(html).not.toContain('aria-label="Previous wall"')
  })
})

describe('scroll to the top of the Inspect card', () => {
  type FakeNode = HTMLElement & { parentElement: FakeNode | null; overflowY: string; scrolls: { top: number }[] }
  /** Fake element tree: `parentElement` chain with the sizes, the overflow and a scroll spy. */
  const node = (overflowY: string, scrollHeight: number, clientHeight: number): FakeNode => {
    const scrolls: { top: number }[] = []
    const el = {
      parentElement: null as FakeNode | null,
      scrollHeight,
      clientHeight,
      overflowY,
      scrolls,
      scrollTo: ({ top }: { top: number }) => { scrolls.push({ top }) },
    }
    return el as unknown as FakeNode
  }
  const readOverflow = (n: HTMLElement) => (n as unknown as FakeNode).overflowY
  const chain = (leaf: FakeNode, ...parents: FakeNode[]) => {
    let cur: FakeNode = leaf
    for (const p of parents) { cur.parentElement = p; cur = p }
    return leaf
  }

  it('finds the first scrolling ancestor and scrolls it to the top', () => {
    const aside = node('auto', 900, 600)
    const inner = node('visible', 900, 900)
    const leaf = chain(node('visible', 100, 100), inner, aside)
    expect(scrollParent(leaf, readOverflow)).toBe(aside)
    expect(scrollToTop(leaf, readOverflow)).toBe(aside)
    expect(aside.scrolls).toEqual([{ top: 0 }])
  })

  it('does nothing when no ancestor scrolls or `scrollTo` is missing', () => {
    const flat = chain(node('visible', 100, 100), node('hidden', 100, 100))
    expect(scrollParent(flat, readOverflow)).toBeNull()
    expect(scrollToTop(flat, readOverflow)).toBeNull()

    const aside = node('scroll', 900, 600)
    delete (aside as unknown as { scrollTo?: unknown }).scrollTo
    const leaf = chain(node('visible', 100, 100), aside)
    expect(() => scrollToTop(leaf, readOverflow)).not.toThrow()
    expect(aside.scrolls).toEqual([])
  })

  it('does nothing without an element', () => {
    expect(scrollParent(null)).toBeNull()
    expect(scrollToTop(null)).toBeNull()
  })
})
