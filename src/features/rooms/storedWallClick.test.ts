// One click on a stored wall (docs/walls-plan.md, "Walls in the interface"):
//   - the whole wall is selected, with the side of the half that was clicked;
//   - a second click on the same side, without a drag, shows the other side;
//   - Shift + click keeps the room wall group behaviour, through the room of the clicked side;
//   - a double click adds a vertex to the room of the clicked side;
//   - all of it works on a wall that no room uses (a wall left by a deleted room).
// The pointer sequence is played on a stub `window`: the code of the drag registers its listeners
// on `window`, so the tests need one (node has no DOM).
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, Vec } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { removeRoom } from '../../model/v2/write'
import { onStoredWallDouble, onStoredWallDown, storedWallDownAction } from './interaction'
import { sideOfPoint } from './wallSides'

type Handler = (ev: Record<string, unknown>) => void

/** A `window` that only keeps the listeners of the pointer sequence (no DOM needed). */
function pointerWindow() {
  const listeners = new Map<string, Handler[]>()
  return {
    addEventListener(type: string, fn: Handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    removeEventListener(type: string, fn: Handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((x) => x !== fn))
    },
    /** Send an event to every listener of one type, like a browser would. */
    fire(type: string, ev: Record<string, unknown>) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev)
    },
    count: (type: string) => (listeners.get(type) ?? []).length,
  }
}

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id,
  code: id,
  name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
})

/** Room A above room B, sharing the wall at y = 300; A is 400 cm wide, 300 tall. */
const rooms = (): Room[] => [
  mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1),
  mk('B', [[0, 300], [400, 300], [400, 600], [0, 600]], 2),
]

const v2 = (): PlanDoc => convertToV2({ ...emptyDoc(), rooms: rooms() }).doc

/** The wall between the two rooms (one face of A and one face of B). */
const sharedWall = (doc: PlanDoc) =>
  doc.walls!.find((w) => {
    const faces = new Set(w.faces.flatMap((f) => (f.roomId === undefined ? [] : [f.roomId])))
    return faces.size === 2
  })!

/** A wall that no room sees: after the deletion of room B, the walls that only B used stayed. */
const lonelyWall = (doc: PlanDoc) => doc.walls!.find((w) => w.faces.every((f) => f.roomId === undefined))!

/** World point of the plan: the viewport is the identity in these tests (1 cm = 1 px). */
const vp = { toWorld: (x: number, y: number) => ({ x, y }), px: (n: number) => n }

/** Pointer down of the left button, as the browser sends it. */
const down = (x: number, y: number, shiftKey = false) => ({
  clientX: x, clientY: y, button: 0, isPrimary: true, pointerId: 1, shiftKey,
  stopPropagation: () => {},
}) as unknown as Parameters<typeof onStoredWallDown>[0]

/** The side of the wall at the world point (x, y): what the handler must select. */
const sideAt = (doc: PlanDoc, wallId: string, x: number, y: number): 'L' | 'R' => {
  const wall = doc.walls!.find((w) => w.id === wallId)!
  const a = doc.nodes!.find((n) => n.id === wall.a)!
  const b = doc.nodes!.find((n) => n.id === wall.b)!
  return sideOfPoint(a, b, { x, y })!
}

/** The room face of one side of the shared wall (the room that the side belongs to). */
const faceOn = (doc: PlanDoc, wallId: string, side: 'L' | 'R') =>
  doc.walls!.find((w) => w.id === wallId)!.faces.find((f) => f.side === side && f.roomId !== undefined)!

/**
 * A world point of a wall, in the middle of the face of `roomId`, a little off the centre line
 * towards that room: a click there selects the side of that room.
 */
const pointOnWall = (doc: PlanDoc, wallId: string, roomId: string): Vec => {
  const wall = doc.walls!.find((w) => w.id === wallId)!
  const a = doc.nodes!.find((n) => n.id === wall.a)!
  const b = doc.nodes!.find((n) => n.id === wall.b)!
  const face = wall.faces.find((f) => f.roomId === roomId)!
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const t = (face.from + face.to) / 2
  const mid = { x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len }
  // Left of a -> b is (-dy, dx): side L is that way, side R is the other way.
  const k = face.side === 'L' ? 3 : -3
  return { x: mid.x - ((b.y - a.y) / len) * k, y: mid.y + ((b.x - a.x) / len) * k }
}

let win: ReturnType<typeof pointerWindow>

beforeEach(() => {
  win = pointerWindow()
  ;(globalThis as unknown as { window: unknown }).window = win
  useUi.setState({ mode: 'edit', tool: 'select', selection: null, multi: [] })
  useDoc.setState({ doc: v2() })
})

describe('a click on a stored wall', () => {
  it('selects the whole wall with the side of the half that was clicked', () => {
    const doc = v2()
    const wall = sharedWall(doc)
    // 20 cm below the wall: the half of room B. 20 cm above: the half of room A.
    const below = { x: 200, y: 320 }
    onStoredWallDown(down(below.x, below.y), vp, wall.id)
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: wall.id, side: sideAt(doc, wall.id, 200, 320) })

    useUi.setState({ selection: null })
    onStoredWallDown(down(200, 280), vp, wall.id)
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: wall.id, side: sideAt(doc, wall.id, 200, 280) })
    // The two halves of the wall give the two sides.
    expect(sideAt(doc, wall.id, 200, 320)).not.toBe(sideAt(doc, wall.id, 200, 280))
  })

  it('shows the other side on a second click without a drag', () => {
    const doc = v2()
    const wall = sharedWall(doc)
    // First click: the side under the pointer.
    onStoredWallDown(down(200, 280), vp, wall.id)
    win.fire('pointerup', { pointerId: 1 })
    const first = (useUi.getState().selection as { side: 'L' | 'R' }).side
    // Second click on the same half, without a drag: the other side.
    onStoredWallDown(down(200, 280), vp, wall.id)
    win.fire('pointerup', { pointerId: 1 })
    const second = useUi.getState().selection as { kind: string; wallId: string; side: 'L' | 'R' }
    expect(second.kind).toBe('storedWall')
    expect(second.wallId).toBe(wall.id)
    expect(second.side).toBe(first === 'L' ? 'R' : 'L')
    // The listeners of the drag are gone after the click.
    expect(win.count('pointermove')).toBe(0)
    // A third click comes back to the first side.
    onStoredWallDown(down(200, 280), vp, wall.id)
    win.fire('pointerup', { pointerId: 1 })
    expect((useUi.getState().selection as { side: 'L' | 'R' }).side).toBe(first)
  })

  it('selects a wall that no room uses any more, after the deletion of its room', () => {
    const kept = removeRoom(v2(), 'B')
    useDoc.setState({ doc: kept })
    const wall = lonelyWall(kept)
    onStoredWallDown(down(200, 450), vp, wall.id)
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: wall.id, side: sideAt(kept, wall.id, 200, 450) })
  })

  it('keeps the room wall group behaviour on Shift + click (room of the clicked side)', () => {
    const doc = v2()
    const wall = sharedWall(doc)
    const side = sideAt(doc, wall.id, 200, 320)
    // The face of the room that lies on the clicked side of the stored wall.
    const face = faceOn(doc, wall.id, side)
    onStoredWallDown(down(200, 320, true), vp, wall.id)
    win.fire('pointerup', { pointerId: 1 })
    expect(useUi.getState().selection).toEqual({ kind: 'wall', roomId: face.roomId, wallStart: face.wallStart })
    // A second Shift + click on another wall of the same side builds a group of room walls.
    const other = doc.walls!.find((w) => w.id !== wall.id && w.faces.some((f) => f.roomId === face.roomId))!
    const at = pointOnWall(doc, other.id, face.roomId!)
    onStoredWallDown(down(at.x, at.y, true), vp, other.id)
    win.fire('pointerup', { pointerId: 1 })
    const ui = useUi.getState()
    expect(ui.multi).toHaveLength(2)
    expect(ui.selection?.kind).toBe('wall')
  })

  it('drags the whole wall on the graph, in one undo step, also when no room uses it', () => {
    const kept = removeRoom(v2(), 'B')
    useDoc.setState({ doc: kept })
    const wall = lonelyWall(kept)
    const a = kept.nodes!.find((n) => n.id === wall.a)!
    const b = kept.nodes!.find((n) => n.id === wall.b)!
    onStoredWallDown(down(200, 450), vp, wall.id)
    // 10 cm lower, Alt held: no snapping, so the wall moves exactly 10 cm along its normal.
    win.fire('pointermove', { pointerId: 1, clientX: 200, clientY: 460, shiftKey: false, altKey: true })
    win.fire('pointerup', { pointerId: 1 })
    const moved = useDoc.getState().doc
    const a2 = moved.nodes!.find((n) => n.id === wall.a)!
    const b2 = moved.nodes!.find((n) => n.id === wall.b)!
    // A horizontal wall moves down (its normal points down when a -> b goes to the right).
    const dy = Math.abs(b.y - a.y) < 1e-6 ? 1 : 0
    expect(Math.round((a2.y - a.y) * 10) / 10).toBe(10 * dy)
    expect(Math.round((b2.y - b.y) * 10) / 10).toBe(10 * dy)
    // One undo step for the whole drag.
    useDoc.temporal.getState().undo()
    const back = useDoc.getState().doc
    expect(back.nodes!.find((n) => n.id === wall.a)!.y).toBe(a.y)
    expect(back.nodes!.find((n) => n.id === wall.b)!.y).toBe(b.y)
  })
})

describe('storedWallDownAction', () => {
  const doc = () => v2()

  it('selects the clicked side of a wall that is not selected', () => {
    const d = doc()
    const wall = sharedWall(d)
    const at = { x: 200, y: 320 }
    const side = sideAt(d, wall.id, at.x, at.y)
    expect(storedWallDownAction({ doc: d, wallId: wall.id, side, prev: null, shift: false, at }))
      .toEqual({ select: { kind: 'storedWall', wallId: wall.id, side }, group: null, flip: false })
  })

  it('asks for the other side when the clicked side is already selected', () => {
    const d = doc()
    const wall = sharedWall(d)
    const at = { x: 200, y: 320 }
    const side = sideAt(d, wall.id, at.x, at.y)
    const prev = { kind: 'storedWall', wallId: wall.id, side } as const
    // No selection change at the pointer down: the side switches at the end of the click.
    expect(storedWallDownAction({ doc: d, wallId: wall.id, side, prev, shift: false, at }))
      .toEqual({ select: null, group: null, flip: true })
  })

  it('switches to the side that was clicked on the same wall', () => {
    const d = doc()
    const wall = sharedWall(d)
    const prevSide = sideAt(d, wall.id, 200, 320)
    const clicked = prevSide === 'L' ? 'R' : 'L'
    const at = { x: 200, y: prevSide === 'L' ? 280 : 320 }
    expect(storedWallDownAction({ doc: d, wallId: wall.id, side: clicked, prev: { kind: 'storedWall', wallId: wall.id, side: prevSide }, shift: false, at }))
      .toEqual({ select: { kind: 'storedWall', wallId: wall.id, side: clicked }, group: null, flip: false })
  })

  it('gives no group item for a side with no room (outside)', () => {
    const kept = removeRoom(v2(), 'B')
    const wall = lonelyWall(kept)
    const action = storedWallDownAction({ doc: kept, wallId: wall.id, side: 'L', prev: null, shift: true, at: { x: 200, y: 450 } })
    expect(action.group).toBeNull()
  })
})

describe('a double click on a stored wall', () => {
  it('adds a vertex to the room of the clicked side', () => {
    const doc = v2()
    const wall = sharedWall(doc)
    const side = sideAt(doc, wall.id, 200, 320)
    const room = faceOn(doc, wall.id, side).roomId!
    const before = doc.rooms.find((r) => r.id === room)!.vertices.length
    onStoredWallDouble({ clientX: 200, clientY: 320 }, vp, wall.id)
    const after = useDoc.getState().doc.rooms.find((r) => r.id === room)!.vertices.length
    expect(after).toBe(before + 1)
    // The other room did not change.
    expect(useDoc.getState().doc.rooms.find((r) => r.id !== room)!.vertices.length)
      .toBe(doc.rooms.find((r) => r.id !== room)!.vertices.length)
  })

  it('does nothing on a side that no room covers', () => {
    const kept = removeRoom(v2(), 'B')
    useDoc.setState({ doc: kept })
    const wall = lonelyWall(kept)
    const before = useDoc.getState().doc
    onStoredWallDouble({ clientX: 200, clientY: 450 }, vp, wall.id)
    expect(useDoc.getState().doc).toBe(before)
  })
})
