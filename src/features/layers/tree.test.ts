import { describe, expect, it } from 'vitest'
import { layersDoc } from './fixture'
import { ancestorKeys, buildLayerTree, filterTree, wallWarnings, type LayerNode } from './tree'

const find = (nodes: LayerNode[], key: string): LayerNode | undefined =>
  nodes.flatMap((n) => [n, ...(find(n.children, key) ? [find(n.children, key)!] : [])]).find((n) => n.key === key)
const group = (room: LayerNode, label: string) => room.children.find((c) => c.label === label)

describe('buildLayerTree', () => {
  const tree = buildLayerTree(layersDoc())

  it('lists the rooms by walk order, the storage under its parent, then the walls without a room', () => {
    expect(tree.nodes.map((n) => n.label)).toEqual(['R1 Cuisine', 'R2 Salon', 'Walls without a room'])
    const r1 = tree.nodes[0]
    expect(r1.sel).toEqual({ kind: 'room', roomId: 'r1' })
    expect(r1.areaM2).toBeGreaterThan(10)
    expect(r1.areaM2).toBeLessThan(12)
    expect(r1.children.map((c) => c.label)).toEqual(['Walls', 'Doors & windows', 'Storage'])
    expect(group(r1, 'Storage')!.children.map((c) => c.label)).toEqual(['S1 Placard'])
    // No storage group on a room without storage; no top-level storage room.
    expect(tree.nodes[1].children.map((c) => c.label)).toEqual(['Walls', 'Doors & windows'])
  })

  it('lists the walls of a room in label order with their state', () => {
    const walls = group(tree.nodes[0], 'Walls')!.children
    expect(walls.map((w) => w.label)).toEqual(['R1-1', 'R1-2', 'R1-3', 'R1-4'])
    expect(walls[0]).toMatchObject({ sel: { kind: 'wall', roomId: 'r1', wallStart: 'r10' }, hoverLabel: 'R1-1', measured: false, locked: true, wallType: 'bearing', wallId: 'W1', warnings: [] })
    expect(walls[0].lengthCm).toBeCloseTo(390, 0)
    expect(walls[1].wallId).toBeUndefined()
  })

  it('lists the doors of a room', () => {
    const els = group(tree.nodes[0], 'Doors & windows')!.children
    expect(els).toHaveLength(1)
    expect(els[0]).toMatchObject({ label: 'Door', widthCm: 90, sel: { kind: 'element', elementId: 'd1' } })
  })

  it('puts the stored walls that no room uses in the last group', () => {
    const free = tree.nodes[2]
    expect(free.sel).toBeUndefined()
    expect(free.children.map((w) => w.label)).toEqual(['W2', 'W3', 'W4'])
    expect(free.children[0].sel).toEqual({ kind: 'storedWall', wallId: 'W2' })
    expect(free.children[0].lengthCm).toBe(200)
  })

  it('flags the overlapping walls and counts the issues', () => {
    const free = tree.nodes[2].children
    expect(free.map((w) => w.warnings)).toEqual([[], ['overlap'], ['overlap']])
    expect(tree.issueCount).toBe(2)
  })
})

describe('wallWarnings', () => {
  it('flags a wall shorter than 1 cm, and ignores a touch or a parallel wall', () => {
    const w = wallWarnings({
      nodes: [
        { id: 'a', x: 0, y: 0 }, { id: 'b', x: 0.5, y: 0 }, { id: 'c', x: 100, y: 0 }, { id: 'd', x: 100, y: 10 }, { id: 'e', x: 200, y: 10 },
        { id: 'f', x: 200, y: 0 },
      ],
      walls: [
        { id: 'W1', a: 'a', b: 'b', faces: [] },
        { id: 'W2', a: 'b', b: 'c', faces: [] },
        { id: 'W3', a: 'c', b: 'f', faces: [] }, // touches W2 end: no overlap
        { id: 'W4', a: 'd', b: 'e', faces: [] }, // parallel, 10 cm away
      ],
    })
    expect(w.get('W1')).toEqual(['short'])
    expect(w.has('W2')).toBe(false)
    expect(w.has('W3')).toBe(false)
    expect(w.has('W4')).toBe(false)
  })
})

describe('tree helpers', () => {
  const tree = buildLayerTree(layersDoc())
  it('finds the ancestors of a row', () => {
    expect(ancestorKeys(tree.nodes, 'wall:r1:r10')).toEqual(['room:r1', 'group:r1:walls'])
    expect(ancestorKeys(tree.nodes, 'room:r1')).toEqual([])
  })
  it('filters by label and keeps the way to a match', () => {
    const f = filterTree(tree.nodes, 'w3')
    expect(f.map((n) => n.label)).toEqual(['Walls without a room'])
    expect(f[0].children.map((n) => n.label)).toEqual(['W3'])
    expect(filterTree(tree.nodes, 'salon')[0].label).toBe('R2 Salon')
    expect(filterTree(tree.nodes, 'zzz')).toEqual([])
    expect(find(filterTree(tree.nodes, 'door'), 'element:d1')).toBeDefined()
  })
})
