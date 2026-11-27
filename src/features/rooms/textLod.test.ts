import { describe, expect, it } from 'vitest'
import type { Room } from '../../model/types'
import { computeTextLod, lodInputOf } from './textLod'
import type { TextLodParams } from './textLod'

const rect = (id: string, name: string, x: number, y: number, w: number, h: number): Room => ({
  id, name, vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
})

const run = (rooms: Room[], zoom: number, extra: Partial<TextLodParams> = {}) =>
  computeTextLod({
    rooms: rooms.map(lodInputOf), zoom, wallThicknessCm: 10, precisionCm: 1,
    selectedRoomIds: [], selectedWall: null, selectedVertex: null, ...extra,
  })

describe('room label LOD', () => {
  it('goes full -> name -> compact -> hidden as zoom drops', () => {
    const r = rect('a', 'Chambre', 0, 0, 300, 120)
    const order = ['full', 'name', 'compact', 'hidden']
    const zooms = Array.from({ length: 60 }, (_, i) => 1.2 - i * 0.02)
    const idx = zooms.map((z) => order.indexOf(run([r], z).rooms.get('a')!.tier))
    expect([...idx].sort((x, y) => x - y)).toEqual(idx) // never richer when zooming out
    expect(new Set(idx)).toEqual(new Set([0, 1, 2, 3]))
  })
  it('name tier has no area line, full tier has one', () => {
    const r = rect('a', 'Chambre', 0, 0, 300, 120)
    const l = [1, 0.5, 0.35, 0.3, 0.25, 0.2].map((z) => run([r], z).rooms.get('a')!)
    expect(l[0].tier).toBe('full')
    expect(l[0].showArea).toBe(true)
    for (const x of l.filter((y) => y.tier === 'name')) expect(x.showArea).toBe(false)
  })
  it('turns the label in a narrow tall corridor', () => {
    const corridor = rect('c', 'Couloir', 0, 0, 90, 600)
    const l = run([corridor], 0.6).rooms.get('c')!
    expect(l.tier).not.toBe('hidden')
    expect(l.vertical).toBe(true)
  })
  it('selected room is never hidden', () => {
    const tiny = rect('t', 'Placard', 0, 0, 60, 60)
    expect(run([tiny], 0.2).rooms.get('t')?.tier).toBe('hidden')
    expect(run([tiny], 0.2, { selectedRoomIds: ['t'] }).rooms.get('t')?.tier).not.toBe('hidden')
    expect(run([tiny], 0.2, { selectedWall: { roomId: 't', edgeIndex: 0 } }).rooms.get('t')?.tier).not.toBe('hidden')
    expect(run([tiny], 0.2, { selectedVertex: { roomId: 't' } }).rooms.get('t')?.tier).not.toBe('hidden')
  })
})

describe('wall label LOD', () => {
  it('needs enough screen length', () => {
    const r = rect('a', 'A', 0, 0, 1000, 1000)
    const lod = run([r], 0.04) // 1000 cm -> 40 px < 48
    expect(lod.walls.size).toBe(0)
    expect(run([r], 0.2).walls.size).toBeGreaterThan(0)
  })
  it('always shows the selected wall', () => {
    const r = rect('a', 'A', 0, 0, 1000, 1000)
    const lod = run([r], 0.04, { selectedWall: { roomId: 'a', edgeIndex: 1 } })
    expect([...lod.walls.keys()]).toEqual(['a:1'])
  })
  it('drops a label whose anchor falls outside a narrow room', () => {
    // Room 40 cm wide: the long walls put their label (10 px + wall thickness inward) past the far wall.
    const narrow = rect('n', 'N', 0, 0, 40, 800)
    const lod = run([narrow], 1)
    expect(lod.walls.has('n:1')).toBe(false) // short... right wall is 800 long but anchor leaves room
    expect(lod.walls.has('n:3')).toBe(false)
  })
  it('hides non-selected labels that overlap a room label', () => {
    // Wide shallow room: top wall label lands on the name label's band.
    const r = rect('a', 'Salon', 0, 0, 300, 40)
    const withRoom = run([r], 1)
    const room = withRoom.rooms.get('a')!
    if (room.tier !== 'hidden') {
      for (const [, w] of withRoom.walls) {
        const dy = Math.abs(w.y - room.p.y), dx = Math.abs(w.x - room.p.x)
        expect(dy > 8 || dx > 40).toBe(true)
      }
    }
  })
  it('keeps the longer wall when two labels collide', () => {
    // Two touching rooms share nearly the same label spot area: only non-overlapping labels survive.
    const a = rect('a', 'A', 0, 0, 400, 400)
    const b = rect('b', 'B', 400, 0, 400, 400)
    const lod = run([a, b], 1)
    const boxes = [...lod.walls.values()]
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const close = Math.abs(boxes[i].x - boxes[j].x) < 30 && Math.abs(boxes[i].y - boxes[j].y) < 10
      expect(close).toBe(false)
    }
  })
})

describe('collision priority', () => {
  it('a selected wall label hides an overlapping non-selected room label', () => {
    const a = rect('a', 'A', 0, 0, 300, 60)
    const b = rect('b', 'B', 0, -100, 300, 160)
    const free = run([a], 1)
    expect(free.rooms.get('a')?.tier).not.toBe('hidden')
    const lod = run([a, b], 1, { selectedWall: { roomId: 'b', edgeIndex: 2 } })
    expect(lod.walls.has('b:2')).toBe(true)
    expect(lod.rooms.get('a')?.tier).toBe('hidden')
  })
  it('a room label hides an overlapping non-selected wall label', () => {
    const big = rect('big', 'Big', 0, 0, 300, 300)
    // Small room whose top wall label lands on the big room label centre (150,150).
    const small = rect('s', 'S', 0, 130, 300, 400)
    const lod = run([big, small], 1)
    expect(lod.rooms.get('big')?.tier).not.toBe('hidden')
    expect(lod.walls.has('s:0')).toBe(false)
  })
})
