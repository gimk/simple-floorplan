import { describe, expect, it } from 'vitest'
import { inGroup, selectedItems, toggleItem, type SelItem, type SelState } from './selection'

const room = (id: string): SelItem => ({ kind: 'room', roomId: id })
const wall = (r: string, w: string): SelItem => ({ kind: 'wall', roomId: r, wallStart: w })
const empty: SelState = { selection: null, multi: [] }

describe('multi-selection', () => {
  it('adds items of the same kind; the last one is primary', () => {
    let s = toggleItem(empty, room('a'))
    expect(selectedItems(s)).toEqual([room('a')])
    s = toggleItem(s, room('b'))
    expect(selectedItems(s)).toEqual([room('a'), room('b')])
    expect(s.selection).toEqual(room('b'))
    expect(inGroup(s, room('a'))).toBe(true)
  })
  it('removes an item that is already selected', () => {
    let s = toggleItem(toggleItem(toggleItem(empty, room('a')), room('b')), room('c'))
    s = toggleItem(s, room('c'))
    expect(selectedItems(s)).toEqual([room('a'), room('b')])
    expect(s.selection).toEqual(room('b'))
    s = toggleItem(s, room('b'))
    expect(selectedItems(s)).toEqual([room('a')])
    expect(s.multi).toEqual([])
    s = toggleItem(s, room('a'))
    expect(s).toEqual(empty)
  })
  it('a different kind starts a new selection', () => {
    const s = toggleItem(toggleItem(toggleItem(empty, room('a')), room('b')), wall('a', 'v1'))
    expect(selectedItems(s)).toEqual([wall('a', 'v1')])
  })
  it('elements are never grouped', () => {
    const el: SelItem = { kind: 'element', elementId: 'e1' }
    const s = toggleItem(toggleItem(empty, el), { kind: 'element', elementId: 'e2' })
    expect(selectedItems(s)).toEqual([{ kind: 'element', elementId: 'e2' }])
  })
  it('an old group is ignored when the primary item is set alone', () => {
    const s = toggleItem(toggleItem(empty, room('a')), room('b'))
    expect(selectedItems({ ...s, selection: room('z') })).toEqual([room('z')])
    expect(selectedItems({ ...s, selection: null })).toEqual([])
  })
})
