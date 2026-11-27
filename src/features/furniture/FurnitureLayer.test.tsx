// SSR test of the canvas look of a furniture GROUP (FurnitureLayer + a 'furnitureMulti' selection).
//
// No DOM library (jsdom, happy-dom, @testing-library) is installed in this repo, so a real pointer
// drag cannot be dispatched: the markup comes from react-dom/server and the store is a small fake.
// The viewport context defaults to px = cm and zoom 1, so the box of the outline is readable in cm.
//   f1 Sofa 100 x 50 at (100, 100), f2 Chair 40 x 40 at (300, 200), f3 Rug (not selected).
// Union of f1 + f2 = x 50..320, y 75..220; the outline is that box plus px(4) of padding.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Artboard, Selection } from '../../model/types'

const { selectionRef } = vi.hoisted(() => ({ selectionRef: { current: { kind: 'none' } as Selection } }))

// The server renderer asks zustand for the frozen initial snapshot, so the selection comes from this
// fake instead of the real UI store.
vi.mock('../../shell/uiStore', () => {
  const useUi = (pick: (s: { mode: string; selection: Selection }) => unknown) =>
    pick({ mode: 'design', selection: selectionRef.current })
  useUi.getState = () => ({
    mode: 'design',
    selection: selectionRef.current,
    activeArtboardId: 'ab1',
    set: () => {},
  })
  return { useUi }
})

const { FurnitureLayer } = await import('./FurnitureLayer')

const AB = 'ab1'

const board = (): Artboard => ({
  id: AB, name: 'Plan A', xCm: 1000, yCm: 500, ceilingHeightCm: 250, precisionCm: 1,
  rooms: [], openings: [],
  furniture: [
    { id: 'f1', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563' },
    { id: 'f2', name: 'Chair', shape: 'rect', xCm: 300, yCm: 200, widthCm: 40, depthCm: 40, rotationDeg: 0, color: '#4b5563' },
    { id: 'f3', name: 'Rug', shape: 'rect', xCm: 500, yCm: 500, widthCm: 200, depthCm: 200, rotationDeg: 0, color: '#4b5563' },
  ],
})

/** True when the shape of that item is drawn with the selected orange stroke. */
const itemSelected = (html: string, id: string): boolean => {
  const start = html.indexOf(`data-furniture-id="${id}"`)
  if (start < 0) return false
  // The first shape after the item marker is the item itself (the group has none).
  const shape = /<(?:rect|ellipse)[^>]*>/.exec(html.slice(start))
  return !!shape && shape[0].includes('stroke="#fb923c"')
}

describe('FurnitureLayer with a furniture group', () => {
  it('marks every item of the group as selected and draws ONE dashed union outline', () => {
    selectionRef.current = { kind: 'furnitureMulti', artboardId: AB, furnitureIds: ['f1', 'f2'] }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)

    expect(itemSelected(html, 'f1')).toBe(true)
    expect(itemSelected(html, 'f2')).toBe(true)
    expect(itemSelected(html, 'f3')).toBe(false)

    // One rectangle, no resize or rotate handles.
    expect(html.split('data-testid="furniture-multi-outline"')).toHaveLength(2)
    expect(html).not.toContain('data-testid="furniture-handles"')

    // Union box + px(4) padding, in cm (px = cm in this test).
    const rect = /<rect data-testid="furniture-multi-outline"[^>]*>/.exec(html)![0]
    expect(rect).toContain('x="46"')
    expect(rect).toContain('y="71"')
    expect(rect).toContain('width="278"')
    expect(rect).toContain('height="153"')
    expect(rect).toContain('fill="none"')
    expect(rect).toContain('stroke-dasharray="4 3"')
    expect(rect).toContain('stroke-width="1"')
  })

  it('a single selection keeps its handles and shows no group outline', () => {
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f1' }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)
    expect(html).toContain('data-testid="furniture-handles"')
    expect(html).not.toContain('furniture-multi-outline')
    expect(itemSelected(html, 'f1')).toBe(true)
    expect(itemSelected(html, 'f2')).toBe(false)
  })

  it('a group of another artboard leaves every item alone', () => {
    selectionRef.current = { kind: 'furnitureMulti', artboardId: 'other', furnitureIds: ['f1', 'f2'] }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)
    expect(html).not.toContain('furniture-multi-outline')
    expect(itemSelected(html, 'f1')).toBe(false)
    expect(html).not.toContain('data-testid="furniture-handles"')
  })
})
