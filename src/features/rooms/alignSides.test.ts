// "In line on" of a stored wall (docs/walls-plan.md, "Walls in the interface", review finding 2):
// the card names the sides of the WALL ('Side A' = side L, 'Side B' = side R), while the document
// stores the value relative to a ROOM face ('room' = inside face of the room the solver takes
// first, 'other' = the face on the other side, 'center' = the centre line).
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { removeRoom } from '../../model/v2/write'
import { alignOfSideChoice, alignSideChoice, wallOwnerSide } from './cards'

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id,
  code: id,
  name: id === 'A' ? 'Entrée' : 'Couloir',
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
})

/** Room A above room B, sharing the wall A-1 / B-3; A comes first in the walk order. */
const plan = (): PlanDoc =>
  convertToV2({
    projectId: 'p',
    title: 't',
    rooms: [
      mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1),
      mk('B', [[0, 300], [400, 300], [400, 600], [0, 600]], 2),
    ],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
  }).doc

/** The wall between the two rooms. */
const sharedWall = (doc: PlanDoc) =>
  doc.walls!.find((w) => w.faces.some((f) => f.roomId === 'A') && w.faces.some((f) => f.roomId === 'B'))!

/** Side of the wall that room 'A' lies on. */
const sideOfA = (doc: PlanDoc, wallId: string) =>
  doc.rooms.find((r) => r.code === 'A')!.cycle!.find((f) => f.wallId === wallId)!.side

const other = (side: 'L' | 'R') => (side === 'L' ? 'R' : 'L')

describe('In line on of a stored wall', () => {
  it('takes the owner side from the first room of the walk order', () => {
    const doc = plan()
    const id = sharedWall(doc).id
    // Room A is first in the walk order, so its face is the inside face the value 'room' names.
    expect(wallOwnerSide(doc, id)).toBe(sideOfA(doc, id))
  })

  it('shows the side of the wall, not the room face', () => {
    const doc = plan()
    const id = sharedWall(doc).id
    const owner = wallOwnerSide(doc, id)!
    expect(alignSideChoice('room', owner)).toBe(owner)
    expect(alignSideChoice(undefined, owner)).toBe(owner)
    expect(alignSideChoice('other', owner)).toBe(other(owner))
    expect(alignSideChoice('center', owner)).toBe('center')
  })

  it('writes the value the solver reads back, and keeps the default value out of the document', () => {
    const doc = plan()
    const owner = wallOwnerSide(doc, sharedWall(doc).id)!
    for (const side of ['L', 'R'] as const) {
      const stored = alignOfSideChoice(side, owner)
      expect(alignSideChoice(stored, owner)).toBe(side)
    }
    // 'room' is the default of a wall: a choice that means it writes nothing.
    expect(alignOfSideChoice(owner, owner)).toBeUndefined()
    expect(alignOfSideChoice(other(owner), owner)).toBe('other')
    expect(alignOfSideChoice('center', owner)).toBe('center')
  })

  it('keeps side A for a single wall that no room sees', () => {
    const doc = removeRoom(plan(), 'B')
    const lonely = doc.walls!.find((w) => w.faces.every((f) => f.roomId === undefined))!
    expect(wallOwnerSide(doc, lonely.id)).toBeUndefined()
    // Without a room side there is nothing to convert: side A is the room value, side B the other.
    expect(alignSideChoice('room', undefined)).toBe('L')
    expect(alignSideChoice('other', undefined)).toBe('R')
    expect(alignOfSideChoice('L', undefined)).toBeUndefined()
    expect(alignOfSideChoice('R', undefined)).toBe('other')
  })
})
