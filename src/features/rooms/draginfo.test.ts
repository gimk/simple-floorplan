import { describe, expect, it } from 'vitest'
import type { Room } from '../../model/types'
import { forcedWallStarts } from './draginfo'

const room: Room = {
  id: 'r1',
  code: 'SE',
  name: 'Séjour',
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 400, y: 0 },
    { id: 'v2', x: 400, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
  holes: [],
  walls: {},
  walkOrder: 1,
}

describe('forcedWallStarts', () => {
  it('returns the two walls touching a dragged vertex', () => {
    const s = forcedWallStarts({ kind: 'vertex', roomId: 'r1', vertexId: 'v2' }, room)
    expect([...s].sort()).toEqual(['v1', 'v2'])
  })

  it('returns the dragged wall and its two neighbours for a wall drag', () => {
    const s = forcedWallStarts({ kind: 'wall', roomId: 'r1', wallStart: 'v1' }, room)
    expect([...s].sort()).toEqual(['v0', 'v1', 'v2'])
  })

  it('returns empty for no drag, unknown room or unknown vertex', () => {
    expect(forcedWallStarts(null, room).size).toBe(0)
    expect(forcedWallStarts({ kind: 'vertex', roomId: 'r1', vertexId: 'v2' }, undefined).size).toBe(0)
    expect(forcedWallStarts({ kind: 'vertex', roomId: 'r1', vertexId: 'nope' }, room).size).toBe(0)
    expect(forcedWallStarts({ kind: 'wall', roomId: 'r1', wallStart: 'nope' }, room).size).toBe(0)
  })
})
