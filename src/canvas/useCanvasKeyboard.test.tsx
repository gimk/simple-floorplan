import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtboard, createDefaultProject } from '../model/schema'
import { useDoc } from '../model/store'
import { useUi } from '../shell/uiStore'
import type { Opening, ProjectDoc, FurnitureItem } from '../model/types'
import { createRectRoom } from '../features/rooms/ops'
import { Viewport } from './Viewport'
import {
  arrowDelta, canvasItems, describeSelection, itemToSelection, nudgeSelection, selectedItemIndex, tabTarget,
} from './useCanvasKeyboard'

function makeDoc(): ProjectDoc {
  const doc = createDefaultProject()
  const a = createArtboard('Plan A', 0, 0)
  a.id = 'ab1'
  const room = createRectRoom({ x: 0, y: 0 }, { x: 400, y: 300 }, 'Kitchen')
  room.id = 'r1'
  a.rooms = [room]
  const door: Opening = { id: 'o1', kind: 'door', roomId: 'r1', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 90 }
  a.openings = [door]
  const sofa: FurnitureItem = { id: 'f1', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 100, widthCm: 200, depthCm: 90, rotationDeg: 0, color: '#888' }
  a.furniture = [sofa]
  doc.artboards = [a]
  return doc
}

describe('tab order', () => {
  it('lists rooms, openings, then furniture', () => {
    expect(canvasItems(makeDoc().artboards[0]).map((i) => i.kind)).toEqual(['room', 'opening', 'furniture'])
  })
  it('selects the first item, then walks, then leaves the canvas', () => {
    expect(tabTarget(-1, 3, false)).toBe(0)
    expect(tabTarget(0, 3, false)).toBe(1)
    expect(tabTarget(2, 3, false)).toBeNull()
    expect(tabTarget(2, 3, true)).toBe(1)
    expect(tabTarget(0, 3, true)).toBeNull()
    expect(tabTarget(-1, 3, true)).toBeNull()
    expect(tabTarget(-1, 0, false)).toBeNull()
  })
  it('finds the selected item, a wall counting as its room', () => {
    const items = canvasItems(makeDoc().artboards[0])
    expect(selectedItemIndex(items, itemToSelection('ab1', items[2]), 'ab1')).toBe(2)
    expect(selectedItemIndex(items, { kind: 'wall', artboardId: 'ab1', roomId: 'r1', edgeIndex: 1 }, 'ab1')).toBe(0)
    expect(selectedItemIndex(items, { kind: 'none' }, 'ab1')).toBe(-1)
    expect(selectedItemIndex(items, itemToSelection('ab1', items[0]), 'other')).toBe(-1)
  })
})

describe('arrow nudge', () => {
  it('maps keys to 1 cm or 10 cm steps', () => {
    expect(arrowDelta('ArrowLeft', false)).toEqual({ dx: -1, dy: 0 })
    expect(arrowDelta('ArrowDown', true)).toEqual({ dx: 0, dy: 10 })
    expect(arrowDelta('a', false)).toBeNull()
  })
  it('moves furniture, an opening, and a room with its opening and furniture; one undo step each', () => {
    const doc = makeDoc()
    useDoc.getState().hydrate(doc)
    const f = nudgeSelection(doc, { kind: 'furniture', artboardId: 'ab1', furnitureId: 'f1' }, 10, 0)!
    useDoc.getState().update(f)
    expect(useDoc.getState().doc.artboards[0].furniture[0].xCm).toBe(110)
    useDoc.getState().undo()
    expect(useDoc.getState().doc.artboards[0].furniture[0].xCm).toBe(100)

    const o = nudgeSelection(useDoc.getState().doc, { kind: 'opening', artboardId: 'ab1', openingId: 'o1' }, 0, 1)!
    useDoc.getState().update(o)
    expect(useDoc.getState().doc.artboards[0].openings[0].yCm).toBe(1)

    useDoc.getState().hydrate(makeDoc())
    const r = nudgeSelection(useDoc.getState().doc, { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] }, 5, 2)!
    useDoc.getState().update(r)
    const a = useDoc.getState().doc.artboards[0]
    expect(a.rooms[0].vertices[0]).toEqual({ x: 5, y: 2 })
    expect(a.openings[0].xCm).toBeCloseTo(205)
    expect(a.furniture[0].xCm).toBe(105)
  })
  it('does nothing without a movable selection', () => {
    expect(nudgeSelection(makeDoc(), { kind: 'none' }, 1, 0)).toBeNull()
    expect(nudgeSelection(makeDoc(), { kind: 'furniture', artboardId: 'ab1', furnitureId: 'zz' }, 1, 0)).toBeNull()
  })
})

describe('describeSelection', () => {
  const doc = makeDoc()
  it('describes each kind', () => {
    expect(describeSelection(doc, { kind: 'none' })).toBe('')
    expect(describeSelection(doc, { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] })).toBe('Room Kitchen, 12.00 square meters')
    expect(describeSelection(doc, { kind: 'wall', artboardId: 'ab1', roomId: 'r1', edgeIndex: 0 })).toMatch(/^Wall 1 of Kitchen, \d+ centimeters$/)
    expect(describeSelection(doc, { kind: 'opening', artboardId: 'ab1', openingId: 'o1' })).toMatch(/^Door, 90/)
    expect(describeSelection(doc, { kind: 'furniture', artboardId: 'ab1', furnitureId: 'f1' })).toMatch(/^Sofa, 200 by 90/)
  })
  it('counts the items of a furniture group that still exist', () => {
    expect(describeSelection(doc, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['f1'] })).toBe(
      '1 furniture item selected',
    )
    expect(describeSelection(doc, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['f1', 'gone'] })).toBe(
      '1 furniture item selected',
    )
    expect(describeSelection(doc, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['gone'] })).toBe('')
  })
})

describe('arrow nudge of a furniture group', () => {
  it('moves every selected item by the same delta in one undo step', () => {
    const doc = makeDoc()
    const second: FurnitureItem = { id: 'f2', name: 'Chair', shape: 'rect', xCm: 300, yCm: 200, widthCm: 50, depthCm: 50, rotationDeg: 0, color: '#888' }
    doc.artboards[0].furniture = [...doc.artboards[0].furniture, second]
    useDoc.getState().hydrate(doc)
    const change = nudgeSelection(
      useDoc.getState().doc,
      { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['f1', 'f2'] },
      0,
      10,
    )!
    useDoc.getState().update(change)
    expect(useDoc.getState().doc.artboards[0].furniture.map((f) => [f.xCm, f.yCm])).toEqual([
      [100, 110],
      [300, 210],
    ])
    useDoc.getState().undo()
    expect(useDoc.getState().doc.artboards[0].furniture.map((f) => [f.xCm, f.yCm])).toEqual([
      [100, 100],
      [300, 200],
    ])
    // A group whose ids are all gone cannot move.
    expect(
      nudgeSelection(makeDoc(), { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['zz', 'yy'] }, 1, 0),
    ).toBeNull()
  })
})

describe('Viewport markup', () => {
  beforeEach(() => useUi.getState().set({ selection: { kind: 'none' } }))
  it('is a focusable labelled application with a polite live region', () => {
    const html = renderToStaticMarkup(<Viewport>{null}</Viewport>)
    expect(html).toContain('role="application"')
    expect(html).toContain('aria-label="Floor plan canvas"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-live="polite"')
  })
})
