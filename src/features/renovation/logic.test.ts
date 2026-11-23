import { describe, expect, it } from 'vitest'
import { area } from '../../model/geometry'
import type { PlanDoc, Room, WallProps } from '../../model/types'
import {
  demolishedLinks,
  hasRenovationStatus,
  mergedGroups,
  piecesPath,
  renovationRooms,
  renovationSummary,
  renovationTotals,
  wallAppearance,
} from './logic'

type P = [number, number]

/** Room from a corner list. Wall key of wall i = `<id>_v<i>` (polygon order). */
const room = (id: string, code: string, name: string, pts: P[], walls: Record<number, WallProps> = {}, extra: Partial<Room> = {}): Room => ({
  id,
  code,
  name,
  holes: [],
  walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}_v${i}`, x, y })),
  walls: Object.fromEntries(Object.entries(walls).map(([i, p]) => [`${id}_v${i}`, p])),
  ...extra,
})

const demolish: WallProps = { type: 'partition', thicknessCm: 10, status: 'demolish' }
const build: WallProps = { type: 'partition', thicknessCm: 10, status: 'new' }

/** Séjour (0..400 × 0..300) + Cuisine (400..600 × 0..300), sharing the x = 400 line. */
const flat = (walls: { se?: Record<number, WallProps>; cu?: Record<number, WallProps> } = {}): PlanDoc => ({
  projectId: 'p',
  title: 'T',
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  rooms: [
    room('a', 'SE', 'Séjour', [[0, 0], [400, 0], [400, 300], [0, 300]], walls.se),
    room('b', 'CU', 'Cuisine', [[400, 0], [600, 0], [600, 300], [400, 300]], walls.cu),
  ],
})

describe('renovation: wall appearance', () => {
  it('keeps a plain wall in every view', () => {
    for (const view of ['before', 'after', 'both'] as const) {
      expect(wallAppearance('partition', undefined, view)).toEqual({ visible: true, style: 'type', structural: false })
      expect(wallAppearance('bearing', 'existing', view)).toEqual({ visible: true, style: 'type', structural: false })
    }
  })

  it('hides new walls before the works and draws them green in both', () => {
    expect(wallAppearance('partition', 'new', 'before').visible).toBe(false)
    expect(wallAppearance('partition', 'new', 'after')).toEqual({ visible: true, style: 'new', structural: false })
    expect(wallAppearance('partition', 'new', 'both')).toEqual({ visible: true, style: 'new', structural: false })
  })

  it('hides demolished walls after the works and draws them red in both', () => {
    expect(wallAppearance('partition', 'demolish', 'after').visible).toBe(false)
    // 'before' shows the wall as it was.
    expect(wallAppearance('partition', 'demolish', 'before')).toEqual({ visible: true, style: 'type', structural: false })
    expect(wallAppearance('partition', 'demolish', 'both')).toEqual({ visible: true, style: 'demolish', structural: false })
  })

  it('flags a bearing or exterior wall marked for demolition', () => {
    expect(wallAppearance('bearing', 'demolish', 'both').structural).toBe(true)
    expect(wallAppearance('exterior', 'demolish', 'both').structural).toBe(true)
    expect(wallAppearance('bearing', 'demolish', 'after').structural).toBe(true)
    expect(wallAppearance('bearing', 'new', 'both').structural).toBe(false)
  })
})

describe('renovation: merged rooms', () => {
  it('reports whether any wall carries a status', () => {
    expect(hasRenovationStatus(flat())).toBe(false)
    expect(hasRenovationStatus(flat({ se: { 1: demolish } }))).toBe(true)
    expect(hasRenovationStatus(flat({ se: { 1: build } }))).toBe(true)
  })

  it('links two rooms through a demolished shared wall, from either side', () => {
    // SE-2 is the wall a_v1 -> a_v2 (x = 400); CU-4 is b_v3 -> b_v0 (x = 400).
    expect(demolishedLinks(flat({ se: { 1: demolish } }).rooms)).toHaveLength(1)
    expect(demolishedLinks(flat({ cu: { 3: demolish } }).rooms)).toHaveLength(1)
    expect(demolishedLinks(flat().rooms)).toHaveLength(0)
    expect(demolishedLinks(flat({ se: { 0: demolish } }).rooms)).toHaveLength(0) // outer wall
    expect(mergedGroups(flat({ se: { 1: demolish } }).rooms)).toHaveLength(1)
  })

  it('does not merge rooms for a new wall', () => {
    const doc = flat({ se: { 1: build } })
    expect(mergedGroups(doc.rooms)).toHaveLength(0)
    expect(renovationRooms(doc, 'after')).toHaveLength(2)
  })

  it('keeps the rooms apart before the works and in the both view', () => {
    const doc = flat({ se: { 1: demolish } })
    for (const view of ['before', 'both'] as const) {
      const rooms = renovationRooms(doc, view)
      expect(rooms).toHaveLength(2)
      expect(rooms.map((r) => r.name)).toEqual(['Séjour', 'Cuisine'])
      expect(rooms.every((r) => !r.merged)).toBe(true)
    }
    // Inside face: 390 x 290 cm = 11.31 m² (default 10 cm walls).
    expect(renovationRooms(doc, 'before')[0].areaM2).toBeCloseTo(11.31, 2)
  })

  it('shows one merged room with a summed area after the works', () => {
    const doc = flat({ se: { 1: demolish } })
    const after = renovationRooms(doc, 'after')
    expect(after).toHaveLength(1)
    const merged = after[0]
    expect(merged.merged).toBe(true)
    expect(merged.name).toBe('Séjour + Cuisine')
    expect(merged.roomIds).toEqual(['a', 'b'])
    expect(merged.codes).toEqual(['SE', 'CU'])
    // Add-up check on inside faces: SE 11.31 + CU 5.51 (190 x 290) = 16.82.
    // 11.31 + 5.51 + the floor under the demolished wall (290 inside × 10 thick = 0.29) = 17.11 (= 590 × 290).
    expect(merged.areaM2).toBeCloseTo(17.11, 2)
    expect(merged.id).toBe('a') // a click selects the first room of the group
    // Display only: the document keeps both rooms.
    expect(doc.rooms).toHaveLength(2)
  })

  it('unions the outlines of a merged group', () => {
    const merged = renovationRooms(flat({ se: { 1: demolish } }), 'after')[0]
    expect(merged.pieces).toHaveLength(1)
    const [exterior, ...holes] = merged.pieces[0]
    expect(holes).toHaveLength(0)
    // 600 × 300 cm.
    expect(area(exterior) / 10000).toBeCloseTo(18, 2)
    const xs = exterior.map((p) => p.x)
    const ys = exterior.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(0, 1)
    expect(Math.max(...xs)).toBeCloseTo(600, 1)
    expect(Math.min(...ys)).toBeCloseTo(0, 1)
    expect(Math.max(...ys)).toBeCloseTo(300, 1)
  })

  it('merges a chain of three rooms into one group', () => {
    const doc: PlanDoc = {
      ...flat({ se: { 1: demolish } }),
      rooms: [
        room('a', 'A', 'Un', [[0, 0], [200, 0], [200, 200], [0, 200]]),
        room('b', 'B', 'Deux', [[200, 0], [400, 0], [400, 200], [200, 200]], { 3: demolish }),
        room('c', 'C', 'Trois', [[400, 0], [600, 0], [600, 200], [400, 200]], { 3: demolish }),
      ],
    }
    const after = renovationRooms(doc, 'after')
    expect(after).toHaveLength(1)
    expect(after[0].codes).toEqual(['A', 'B', 'C'])
    // Inside faces: 3 × 190 × 190 = 10.83, plus the floor under the two demolished walls (2 × 190 × 10 = 0.38) = 11.21 (= 590 × 190).
    expect(after[0].name).toBe('Un + Deux + Trois')
    expect(after[0].areaM2).toBeCloseTo(11.21, 2)
  })

  it('keeps rooms that only touch through a kept wall apart', () => {
    // Three rooms, only one shared wall demolished: A + B merge, C stays alone.
    const doc: PlanDoc = {
      ...flat(),
      rooms: [
        room('a', 'A', 'Un', [[0, 0], [200, 0], [200, 200], [0, 200]], { 1: demolish }),
        room('b', 'B', 'Deux', [[200, 0], [400, 0], [400, 200], [200, 200]]),
        room('c', 'C', 'Trois', [[400, 0], [600, 0], [600, 200], [400, 200]]),
      ],
    }
    const after = renovationRooms(doc, 'after')
    expect(after).toHaveLength(2)
    expect(after[0].codes).toEqual(['A', 'B'])
    expect(after[1].codes).toEqual(['C'])
  })

  it('writes one SVG path per merged outline', () => {
    const path = piecesPath(renovationRooms(flat({ se: { 1: demolish } }), 'after')[0].pieces)
    expect(path.startsWith('M')).toBe(true)
    expect((path.match(/Z/g) ?? []).length).toBe(1)
  })
})

describe('renovation: areas', () => {
  it('sums indoor rooms only', () => {
    const doc: PlanDoc = {
      ...flat(),
      rooms: [
        ...flat({ se: { 1: demolish } }).rooms,
        room('o', 'BA', 'Balcon', [[0, 300], [400, 300], [400, 400], [0, 400]], {}, { outdoor: true }),
      ],
    }
    // Inside faces: SE 11.31 + CU 5.51 = 16.82 before. After, the demolished wall adds 290 × 10 = 0.29 (17.11). The balcony is outdoor.
    expect(renovationTotals(doc, 'before')).toEqual({ areaM2: 16.82, rooms: 2 })
    expect(renovationTotals(doc, 'after')).toEqual({ areaM2: 17.11, rooms: 1 })
  })

  it('gives before / after totals and nothing without a status', () => {
    expect(renovationSummary(flat())).toBeNull()
    const summary = renovationSummary(flat({ se: { 1: demolish } }))
    expect(summary).not.toBeNull()
    expect(summary!.before).toEqual({ areaM2: 16.82, rooms: 2 })
    expect(summary!.after).toEqual({ areaM2: 17.11, rooms: 1 })
  })
})
