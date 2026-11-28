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

const { selectionRef, toolRef } = vi.hoisted(() => ({
  selectionRef: { current: { kind: 'none' } as Selection },
  toolRef: { current: 'select' as string },
}))

// The server renderer asks zustand for the frozen initial snapshot, so the selection comes from this
// fake instead of the real UI store.
vi.mock('../../shell/uiStore', () => {
  const useUi = (pick: (s: { mode: string; selection: Selection; tool: string }) => unknown) =>
    pick({ mode: 'design', selection: selectionRef.current, tool: toolRef.current })
  useUi.getState = () => ({
    mode: 'design',
    selection: selectionRef.current,
    tool: toolRef.current,
    activeArtboardId: 'ab1',
    set: () => {},
  })
  return { useUi }
})

const { FurnitureLayer } = await import('./FurnitureLayer')

const AB = 'ab1'

const board = (rotationDeg = 0): Artboard => ({
  id: AB, name: 'Plan A', xCm: 1000, yCm: 500, ceilingHeightCm: 250, precisionCm: 1,
  rooms: [], openings: [],
  furniture: [
    { id: 'f1', name: 'Sofa', model: 'box', shape: 'rect', xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, rotationDeg, color: '#4b5563' },
    { id: 'f2', name: 'Chair', model: 'box', shape: 'rect', xCm: 300, yCm: 200, widthCm: 40, depthCm: 40, rotationDeg: 0, color: '#4b5563' },
    { id: 'f3', name: 'Rug', model: 'box', shape: 'rect', xCm: 500, yCm: 500, widthCm: 200, depthCm: 200, rotationDeg: 0, color: '#4b5563' },
  ],
})

/** True when the shape of that item is drawn with the selected orange stroke. */
const itemSelected = (html: string, id: string): boolean => {
  const start = html.indexOf(`data-furniture-id="${id}"`)
  if (start < 0) return false
  // The item outline is one of the item's own shapes (after its plan symbol, if any), which all come
  // before the first non-interactive element (the arrow or the label group).
  const next = html.indexOf('pointer-events="none"', start)
  const own = html.slice(start, next < 0 ? undefined : next)
  return [...own.matchAll(/<(?:rect|ellipse|path)[^>]*>/g)].some((m) => m[0].includes('stroke="#fb923c"'))
}

describe('FurnitureLayer with a furniture group', () => {
  it('marks every item of the group as selected and draws ONE dashed union outline', () => {
    selectionRef.current = { kind: 'furnitureMulti', artboardId: AB, furnitureIds: ['f1', 'f2'] }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)

    expect(itemSelected(html, 'f1')).toBe(true)
    expect(itemSelected(html, 'f2')).toBe(true)
    expect(itemSelected(html, 'f3')).toBe(false)

    // One rectangle and group handles (no single-item handle group).
    expect(html.split('data-testid="furniture-multi-outline"')).toHaveLength(2)
    expect(html).not.toContain('data-testid="furniture-handles"')
    expect(html).toContain('data-testid="furniture-multi-handles"')

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

  it('draws the furniture of a mixed multi selection as selected, without furniture handles', () => {
    selectionRef.current = {
      kind: 'multi',
      artboardId: AB,
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'furniture', furnitureId: 'f2' },
      ],
    }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)

    expect(itemSelected(html, 'f2')).toBe(true)
    expect(itemSelected(html, 'f1')).toBe(false)
    expect(itemSelected(html, 'f3')).toBe(false)
    // A mixed selection has no furniture-only handles and no group outline.
    expect(html).not.toContain('data-testid="furniture-handles"')
    expect(html).not.toContain('furniture-multi-outline')
  })

  it('a group of another artboard leaves every item alone', () => {
    selectionRef.current = { kind: 'furnitureMulti', artboardId: 'other', furnitureIds: ['f1', 'f2'] }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)
    expect(html).not.toContain('furniture-multi-outline')
    expect(itemSelected(html, 'f1')).toBe(false)
    expect(html).not.toContain('data-testid="furniture-handles"')
  })
})

/** The markup of the <rect> that carries that edge handle. */
const edgeTag = (html: string, key: string): string => {
  const at = html.indexOf(`data-edge-handle="${key}"`)
  if (at < 0) return ''
  return html.slice(html.lastIndexOf('<rect', at), html.indexOf('>', at) + 1)
}

describe('FurnitureLayer resize handles', () => {
  it('adds one invisible edge strip per side, before the corner handles', () => {
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f1' }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)

    for (const key of ['-1:0', '1:0', '0:-1', '0:1']) {
      const tag = edgeTag(html, key)
      expect(tag).not.toBe('')
      expect(tag).toContain('fill="transparent"')
    }

    // Left and right strips span the depth (thickness 10 across), top and bottom span the width.
    expect(edgeTag(html, '-1:0')).toContain('height="50"')
    expect(edgeTag(html, '-1:0')).toContain('width="10"')
    expect(edgeTag(html, '0:-1')).toContain('width="100"')
    expect(edgeTag(html, '0:-1')).toContain('height="10"')
    // A left strip is centred on the edge: x = -width/2 - 10/2.
    expect(edgeTag(html, '-1:0')).toContain('x="-55"')

    // Corners stay on top: every edge strip comes before the first white (corner) handle.
    const handles = html.slice(html.indexOf('data-testid="furniture-handles"'))
    const lastEdge = Math.max(...['-1:0', '1:0', '0:-1', '0:1'].map((k) => handles.indexOf(`data-edge-handle="${k}"`)))
    const firstWhite = handles.indexOf('fill="#fff"')
    expect(lastEdge).toBeGreaterThan(-1)
    expect(firstWhite).toBeGreaterThan(-1)
    expect(lastEdge).toBeLessThan(firstWhite)
  })

  it('points the edge cursors across the edge, swapping them for a quarter turn', () => {
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f1' }

    const flat = renderToStaticMarkup(<FurnitureLayer artboard={board(0)} />)
    expect(edgeTag(flat, '-1:0')).toContain('cursor:ew-resize')
    expect(edgeTag(flat, '1:0')).toContain('cursor:ew-resize')
    expect(edgeTag(flat, '0:-1')).toContain('cursor:ns-resize')
    expect(edgeTag(flat, '0:1')).toContain('cursor:ns-resize')

    const turned = renderToStaticMarkup(<FurnitureLayer artboard={board(90)} />)
    expect(edgeTag(turned, '-1:0')).toContain('cursor:ns-resize')
    expect(edgeTag(turned, '1:0')).toContain('cursor:ns-resize')
    expect(edgeTag(turned, '0:-1')).toContain('cursor:ew-resize')
    expect(edgeTag(turned, '0:1')).toContain('cursor:ew-resize')

    // Each cursor is the nearest of the 4 two-way cursors to the turned handle direction.
    const edgeAt = (deg: number) => edgeTag(renderToStaticMarkup(<FurnitureLayer artboard={board(deg)} />), '-1:0')
    expect(edgeAt(10)).toContain('cursor:ew-resize')
    expect(edgeAt(30)).toContain('cursor:nwse-resize')
    expect(edgeAt(80)).toContain('cursor:ns-resize')
    expect(edgeAt(150)).toContain('cursor:nesw-resize')
    expect(edgeAt(190)).toContain('cursor:ew-resize')
  })

  it('turns the corner cursors with the item rotation', () => {
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f1' }
    const cornerTag = (html: string, key: string): string => {
      const at = html.indexOf(`data-corner-handle="${key}"`)
      return at < 0 ? '' : html.slice(html.lastIndexOf('<rect', at), html.indexOf('>', at) + 1)
    }
    const flat = renderToStaticMarkup(<FurnitureLayer artboard={board(0)} />)
    expect(cornerTag(flat, '-1:-1')).toContain('cursor:nwse-resize')
    expect(cornerTag(flat, '1:-1')).toContain('cursor:nesw-resize')
    const turned = renderToStaticMarkup(<FurnitureLayer artboard={board(90)} />)
    expect(cornerTag(turned, '-1:-1')).toContain('cursor:nesw-resize')
    expect(cornerTag(turned, '1:-1')).toContain('cursor:nwse-resize')
    expect(cornerTag(turned, '1:1')).toContain('cursor:nesw-resize')
    expect(cornerTag(turned, '-1:1')).toContain('cursor:nwse-resize')
    const tilted = renderToStaticMarkup(<FurnitureLayer artboard={board(45)} />)
    expect(cornerTag(tilted, '-1:-1')).toContain('cursor:ns-resize')
  })

  it('draws 4 edge strips, 4 corner handles and 1 rotate handle for a group selection', () => {
    selectionRef.current = { kind: 'furnitureMulti', artboardId: AB, furnitureIds: ['f1', 'f2'] }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)
    const handles = html.slice(html.indexOf('data-testid="furniture-multi-handles"'))
    for (const key of ['-1:0', '1:0', '0:-1', '0:1']) {
      expect(edgeTag(handles, key)).toContain('fill="transparent"')
    }
    // 4 white corner rects + 1 white rotate circle.
    expect(handles.match(/fill="#fff"/g)).toHaveLength(5)
    expect(handles).toContain('<circle')
  })
})
/** Markup of the radius handle circle of one corner. */
const radiusTag = (html: string, index: number): string => {
  const at = html.indexOf(`data-radius-handle="${index}"`)
  if (at < 0) return ''
  return html.slice(html.lastIndexOf('<circle', at), html.indexOf('></circle>', at) + 11)
}

describe('FurnitureLayer corner radius handles', () => {
  it('draws one radius handle inside each corner of a single rect item', () => {
    toolRef.current = 'select'
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f1' }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={board()} />)

    for (const i of [0, 1, 2, 3]) expect(radiusTag(html, i)).not.toBe('')

    // f1 is 100 x 50 with the default 4 cm radius. Each handle sits px(12) inside its corner on both
    // axes (px = cm in this test): top-left = (-38, -13), and so on clockwise.
    expect(radiusTag(html, 0)).toContain('cx="-38"')
    expect(radiusTag(html, 0)).toContain('cy="-13"')
    expect(radiusTag(html, 1)).toContain('cx="38"')
    expect(radiusTag(html, 1)).toContain('cy="-13"')
    expect(radiusTag(html, 2)).toContain('cx="38"')
    expect(radiusTag(html, 2)).toContain('cy="13"')
    expect(radiusTag(html, 3)).toContain('cx="-38"')
    expect(radiusTag(html, 3)).toContain('cy="13"')
    // A small white circle with the selection ring, and a plain cursor (no resize).
    expect(radiusTag(html, 0)).toContain('r="4"')
    expect(radiusTag(html, 0)).toContain('fill="#fff"')
    expect(radiusTag(html, 0)).toContain('stroke="#fb923c"')
    expect(radiusTag(html, 0)).toContain('cursor:default')

    // Drawn last in the handle group, so they take the click over the edges and corners.
    expect(html.indexOf('data-radius-handle="0"')).toBeGreaterThan(html.indexOf('data-edge-handle="0:1"'))
    expect(html.indexOf('data-radius-handle="0"')).toBeGreaterThan(html.lastIndexOf('cursor:nwse-resize'))
  })

  it('follows a per-corner radius: the handle moves in by the radius of its own corner', () => {
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f1' }
    const perCorner: Artboard = {
      ...board(),
      furniture: [
        { id: 'f1', name: 'Sofa', model: 'box', shape: 'rect', xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563', cornerRadiiCm: [20, 4, 4, 4] },
      ],
    }
    const html = renderToStaticMarkup(<FurnitureLayer artboard={perCorner} />)
    // Top-left radius 20 > px(12): its handle sits 20 cm in from both edges.
    expect(radiusTag(html, 0)).toContain('cx="-30"')
    expect(radiusTag(html, 0)).toContain('cy="-5"')
    // The other corners keep the px(12) inset.
    expect(radiusTag(html, 1)).toContain('cx="38"')
  })

  it('draws no radius handles for a circle, a group, a tiny item or another tool', () => {
    // A circle has no corners.
    const circleBoard: Artboard = {
      ...board(),
      furniture: [
        { id: 'f1', name: 'Table', shape: 'circle', xCm: 100, yCm: 100, widthCm: 100, depthCm: 100, rotationDeg: 0, color: '#4b5563' },
      ],
    }
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f1' }
    expect(renderToStaticMarkup(<FurnitureLayer artboard={circleBoard} />)).not.toContain('data-radius-handle')

    // A group selection keeps the shared handle group only.
    selectionRef.current = { kind: 'furnitureMulti', artboardId: AB, furnitureIds: ['f1', 'f2'] }
    expect(renderToStaticMarkup(<FurnitureLayer artboard={board()} />)).not.toContain('data-radius-handle')

    // f2 (40 x 40) is too small on screen: 40 * zoom 1 stays under 48 px.
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f2' }
    expect(renderToStaticMarkup(<FurnitureLayer artboard={board()} />)).not.toContain('data-radius-handle')

    // The select tool is required.
    toolRef.current = 'rect'
    selectionRef.current = { kind: 'furniture', artboardId: AB, furnitureId: 'f1' }
    expect(renderToStaticMarkup(<FurnitureLayer artboard={board()} />)).not.toContain('data-radius-handle')
    toolRef.current = 'select'
  })
})
