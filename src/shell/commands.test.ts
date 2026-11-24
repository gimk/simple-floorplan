// Command palette data: the list of commands, the filter, the arrow-key index and Shift+P.
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../model/store'
import type { StoredWall, WallType } from '../model/types'
import { TOOLS } from './tools'
import { BOOLEAN_LAYER_KEYS, MODE_LAYER_KEYS } from './view/layers'
import {
  commandList, filterCommands, fold, groupRows, matches, moveIndex, resetSnapMemory, searchText,
  selectGroup, storedWallsOfType, toggleAllSnap, wallTypeOf, type Command,
} from './commands'

const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

const wall = (id: string, type?: WallType): StoredWall => ({ id, a: 'n1', b: 'n2', faces: [], type })

const WALLS: StoredWall[] = [
  wall('W1', 'bearing'),
  wall('W2', 'bearing'),
  wall('W3', 'partition'),
  wall('W4'), // no type = partition (the app default)
]

const byId = (list: Command[], id: string): Command => {
  const c = list.find((x) => x.id === id)
  if (!c) throw new Error(`no command ${id}`)
  return c
}

beforeEach(() => {
  resetSnapMemory()
  applyState(useUi, {
    mode: 'edit', tool: 'select', selection: null, multi: [], dimStyle: 'lines',
    canvasUnits: { unit: 'cm', decimals: 1 },
    snap: { grid: true, gridCm: 5, angles: true, vertices: true },
  })
  applyState(useDoc, { doc: { ...emptyDoc(), walls: WALLS } })
  useDoc.temporal.getState().clear()
})

describe('commandList', () => {
  it('has one command per tool, with the letter key as its shortcut', () => {
    const list = commandList()
    for (const t of TOOLS) {
      const c = byId(list, `tool:${t.id}`)
      expect(c.group).toBe('Tools')
      expect(c.shortcut).toBe(t.key.toUpperCase())
      expect(c.enabled).toBe(true)
    }
    byId(list, 'tool:wall').run()
    expect(useUi.getState().tool).toBe('wall')
    byId(list, 'tool:select').run()
    expect(useUi.getState().tool).toBe('select')
  })

  it('has undo, redo and fit to view', () => {
    const list = commandList()
    expect(byId(list, 'edit:undo').enabled).toBe(false) // an empty history
    expect(byId(list, 'edit:redo').enabled).toBe(false)
    expect(byId(list, 'view:fit').shortcut).toBe('0')
  })

  it('toggles every layer, and knows the labels', () => {
    const list = commandList()
    for (const key of BOOLEAN_LAYER_KEYS) expect(byId(list, `layer:${key}`).title).toContain('Layer:')
    for (const key of MODE_LAYER_KEYS) expect(byId(list, `layer-mode:${key}`).title).toContain('Layer:')

    const before = useUi.getState().layers.background
    byId(list, 'layer:background').run()
    expect(useUi.getState().layers.background).toBe(!before)
  })

  it('cycles a three-state layer: auto -> on -> off -> auto', () => {
    applyState(useUi, { layers: { ...useUi.getState().layers, roomCodes: 'auto' } })
    byId(commandList(), 'layer-mode:roomCodes').run()
    expect(useUi.getState().layers.roomCodes).toBe('on')
    byId(commandList(), 'layer-mode:roomCodes').run()
    expect(useUi.getState().layers.roomCodes).toBe('off')
    byId(commandList(), 'layer-mode:roomCodes').run()
    expect(useUi.getState().layers.roomCodes).toBe('auto')
  })

  it('sets the wall length style and the units', () => {
    byId(commandList(), 'view:dims-text').run()
    expect(useUi.getState().dimStyle).toBe('text')
    byId(commandList(), 'view:units-m').run()
    expect(useUi.getState().canvasUnits.unit).toBe('m')
    // The unit now in use is not offered again.
    expect(byId(commandList(), 'view:units-m').enabled).toBe(false)
    expect(byId(commandList(), 'view:dims-text').enabled).toBe(false)
  })

  it('switches Measuring Mode on and off', () => {
    const list = commandList()
    expect(byId(list, 'view:measure-mode').title).toBe('Measuring Mode')
    byId(list, 'view:measure-mode').run()
    expect(useUi.getState().mode).toBe('measure')
    expect(byId(commandList(), 'view:measure-mode').title).toBe('Exit Measuring Mode')
  })

  it('runs the shortcuts dialog only when the shell gives it', () => {
    expect(byId(commandList(), 'help:shortcuts').enabled).toBe(false)
    let opened = 0
    const list = commandList({ openShortcuts: () => { opened++ } })
    const c = byId(list, 'help:shortcuts')
    expect(c.enabled).toBe(true)
    c.run()
    expect(opened).toBe(1)
  })

  it('offers both export formats for a plan with rooms', () => {
    const empty = commandList()
    expect(byId(empty, 'export:svg').enabled).toBe(false)
    expect(byId(empty, 'export:pdf').enabled).toBe(false)
    applyState(useDoc, {
      doc: {
        ...emptyDoc(),
        walls: WALLS,
        rooms: [{
          id: 'R1', code: 'SE', name: 'Séjour', holes: [], walls: {}, walkOrder: 1,
          vertices: [{ id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 300, y: 0 }, { id: 'v2', x: 300, y: 300 }],
        }],
      },
    })
    const list = commandList()
    expect(byId(list, 'export:svg').enabled).toBe(true)
    expect(byId(list, 'export:pdf').enabled).toBe(true)
  })
})

describe('select similar', () => {
  it('defaults a wall without a type to a partition', () => {
    expect(wallTypeOf(wall('X'))).toBe('partition')
    expect(storedWallsOfType(WALLS, 'partition').map((w) => w.id)).toEqual(['W3', 'W4'])
    expect(storedWallsOfType(WALLS, 'bearing').map((w) => w.id)).toEqual(['W1', 'W2'])
  })

  it('selects all bearing walls as one group (the Shift + click group API)', () => {
    byId(commandList(), 'select:bearing').run()
    const ui = useUi.getState()
    expect(ui.multi.map((m) => (m.kind === 'storedWall' ? m.wallId : '?'))).toEqual(['W1', 'W2'])
    expect(ui.selection).toEqual({ kind: 'storedWall', wallId: 'W2' })
  })

  it('selects all partitions, default type included', () => {
    byId(commandList(), 'select:partitions').run()
    expect(useUi.getState().multi.map((m) => (m.kind === 'storedWall' ? m.wallId : '?'))).toEqual(['W3', 'W4'])
  })

  it('selects all rooms', () => {
    applyState(useDoc, {
      doc: {
        ...emptyDoc(),
        walls: WALLS,
        rooms: [
          { id: 'R1', code: 'A', name: 'A', holes: [], walls: {}, walkOrder: 1, vertices: [] },
          { id: 'R2', code: 'B', name: 'B', holes: [], walls: {}, walkOrder: 2, vertices: [] },
        ],
      },
    })
    byId(commandList(), 'select:rooms').run()
    expect(useUi.getState().multi.map((m) => (m.kind === 'room' ? m.roomId : '?'))).toEqual(['R1', 'R2'])
  })

  it('"walls of this type" needs a selected stored wall, then reads its type', () => {
    expect(byId(commandList(), 'select:same-type').enabled).toBe(false)
    applyState(useUi, { selection: { kind: 'storedWall', wallId: 'W3' }, multi: [] })
    const c = byId(commandList(), 'select:same-type')
    expect(c.enabled).toBe(true)
    expect(c.title).toContain('partitions')
    c.run()
    expect(useUi.getState().multi.map((m) => (m.kind === 'storedWall' ? m.wallId : '?'))).toEqual(['W3', 'W4'])
  })

  it('selectGroup clears the selection for an empty list', () => {
    selectGroup([{ kind: 'room', roomId: 'R1' }])
    expect(useUi.getState().selection).toEqual({ kind: 'room', roomId: 'R1' })
    selectGroup([])
    expect(useUi.getState().selection).toBe(null)
    expect(useUi.getState().multi).toEqual([])
  })
})

describe('filter', () => {
  const all = commandList()

  it('keeps every command for an empty query', () => {
    expect(filterCommands(all, '')).toHaveLength(all.length)
    expect(filterCommands(all, '   ')).toHaveLength(all.length)
  })

  it('matches a substring of the title, without case', () => {
    const ids = filterCommands(all, 'WALL').map((c) => c.id)
    expect(ids).toContain('tool:wall')
    expect(ids).toContain('view:dims-lines')
    expect(ids).not.toContain('select:rooms')
  })

  it('needs every word of the query, in any order', () => {
    expect(filterCommands(all, 'units mm').map((c) => c.id)).toEqual(['view:units-mm'])
    expect(filterCommands(all, 'mm units').map((c) => c.id)).toEqual(['view:units-mm'])
    expect(filterCommands(all, 'units zzz')).toEqual([])
  })

  it('matches the extra search words too', () => {
    expect(filterCommands(all, 'magnet').map((c) => c.id)).toEqual(['view:snap-off'])
    expect(filterCommands(all, 'download pdf').map((c) => c.id)).toEqual(['export:pdf'])
  })

  it('finds a tool by its letter key', () => {
    expect(filterCommands(all, 'tool cutout')).toHaveLength(1)
    expect(filterCommands(all, 'x').map((c) => c.id)).toContain('tool:cutout')
  })

  it('ignores accents in the query', () => {
    expect(fold('Séjour')).toBe('sejour')
    const c: Command = { id: 't', title: 'Séjour', group: 'Selection', enabled: true, run: () => {} }
    expect(matches(c, 'sejour')).toBe(true)
    expect(searchText(c)).toBe('sejour selection')
  })

  it('returns nothing for a query that matches no command', () => {
    expect(filterCommands(all, 'zzzz')).toEqual([])
  })
})

describe('moveIndex', () => {
  it('moves and wraps around', () => {
    expect(moveIndex(0, 1, 3)).toBe(1)
    expect(moveIndex(2, 1, 3)).toBe(0)
    expect(moveIndex(0, -1, 3)).toBe(2)
    expect(moveIndex(1, 0, 3)).toBe(1)
  })

  it('stays at 0 for an empty list', () => {
    expect(moveIndex(0, 1, 0)).toBe(0)
    expect(moveIndex(4, -1, 0)).toBe(0)
  })
})

describe('toggleAllSnap (Shift+P)', () => {
  it('turns every snapping off, then puts the same set back', () => {
    applyState(useUi, { snap: { grid: true, gridCm: 5, angles: false, vertices: true } })
    expect(toggleAllSnap()).toBe(false)
    expect(useUi.getState().snap).toEqual({ grid: false, gridCm: 5, angles: false, vertices: false })
    // The grid step is not lost.
    expect(toggleAllSnap()).toBe(true)
    expect(useUi.getState().snap).toEqual({ grid: true, gridCm: 5, angles: false, vertices: true })
  })

  it('turns everything on when there is nothing to remember', () => {
    applyState(useUi, { snap: { grid: false, gridCm: 1, angles: false, vertices: false } })
    expect(toggleAllSnap()).toBe(true)
    expect(useUi.getState().snap).toEqual({ grid: true, gridCm: 1, angles: true, vertices: true })
  })

  it('is the command of the palette too', () => {
    applyState(useUi, { snap: { grid: true, gridCm: 5, angles: true, vertices: true } })
    byId(commandList(), 'view:snap-off').run()
    expect(useUi.getState().snap.grid).toBe(false)
    expect(useUi.getState().snap.angles).toBe(false)
    expect(useUi.getState().snap.vertices).toBe(false)
  })

  it('groups the rows and keeps the index of each one', () => {
    const list = commandList()
    const groups = groupRows(list)
    expect(groups[0].group).toBe('Tools')
    expect(groups[0].rows).toHaveLength(TOOLS.length)
    // Row 0 is the first tool, and its index is the place in the flat list.
    expect(groups[0].rows[0].command.id).toBe('tool:select')
    expect(groups[0].rows[0].index).toBe(0)
    // Every command is in exactly one group, in order.
    const flat = groups.flatMap((g) => g.rows)
    expect(flat.map((r) => r.command.id)).toEqual(list.map((c) => c.id))
    expect(flat.map((r) => r.index)).toEqual(list.map((_, i) => i))
    // A group is never split in two.
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length)
  })

  it('groups an empty list as nothing', () => {
    expect(groupRows([])).toEqual([])
  })
})
