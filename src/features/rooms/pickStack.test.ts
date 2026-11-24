// Tab cycling (Rayon "TAB: flick through overlapping entities"): the stack of things under a point
// of the plan (top first), and the Tab / Shift + Tab step through it.
//
// The test plan has a door on the wall that two rooms share, so the stack at the door is
// [element, face, wall, room A] and every step of Tab is checked, both ways, with the wrap around.
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, WallElement } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { nextInStack, pickStack, pickKey, type PickItem } from './pickStack'
import { installTabCycle, tabStep } from './useTabCycle'
import { wallFaceAtPoint } from './wallSides'

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [], walls: {}, walkOrder,
})

/** Room A above room B, sharing the wall at y = 300; A is 400 cm wide, 300 tall. */
const rooms = (): Room[] => [
  mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1),
  mk('B', [[0, 300], [400, 300], [400, 600], [0, 600]], 2),
]

/** A v1 document: the rooms are the source, so a wall is the wall of a room. */
const v1 = (): PlanDoc => ({ ...emptyDoc(), rooms: rooms() })

/** The wall between the two rooms, with one face of each room. */
const sharedWall = (doc: PlanDoc) =>
  doc.walls!.find((w) => {
    const seen = new Set(w.faces.flatMap((f) => (f.roomId === undefined ? [] : [f.roomId])))
    return seen.size === 2
  })!

/** The wall of room A that lies on the shared wall (the host of the door). */
const hostWall = (doc: PlanDoc) => {
  const room = doc.rooms.find((r) => r.id === 'A')!
  return room.vertices.findIndex((_v, i) => {
    const a = room.vertices[i], b = room.vertices[(i + 1) % room.vertices.length]
    return Math.abs(a.y - 300) < 1e-6 && Math.abs(b.y - 300) < 1e-6
  })
}

/** A door of 80 cm in the middle of the shared wall, opening into room A. */
function withDoor(doc: PlanDoc): PlanDoc {
  const room = doc.rooms.find((r) => r.id === 'A')!
  const at = hostWall(doc)
  const door: WallElement = {
    id: 'door-1',
    roomId: room.id,
    wallStart: room.vertices[at].id,
    ...(doc.schemaVersion === 2 ? { wallId: sharedWall(doc).id } : {}),
    kind: 'door',
    variant: 'single',
    offsetCm: 160,
    widthCm: 80,
    heightCm: 204,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  return { ...doc, elements: [door] }
}

/** The plan of the tests: a v2 document with the door on the shared wall. */
const v2 = (): PlanDoc => withDoor(convertToV2({ ...emptyDoc(), rooms: rooms() }).doc)

/** A point on the door, 8 cm into room A: the wall band (half a 10 cm wall) plus the pointer slack. */
const AT_DOOR = { x: 200, y: 292 }
/** Slack of the pointer, cm: 10 px at a zoom of 1. */
const TOL = 10

/** The viewport of the tests: the identity (1 cm = 1 px). */
const view = { toWorld: (x: number, y: number) => ({ x, y }), px: (n: number) => n }

/** Short names of a stack, to read the order in one line. */
const shape = (stack: PickItem[]) =>
  stack.map((s) => (s.kind === 'storedWall' ? (s.face ? 'face' : 'wall') : s.kind))

type Handler = (ev: Record<string, unknown>) => void

/** A `window` that only keeps the listeners (node has no DOM). */
function fakeWindow() {
  const listeners = new Map<string, Handler[]>()
  return {
    addEventListener(type: string, fn: Handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    removeEventListener(type: string, fn: Handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((x) => x !== fn))
    },
    fire(type: string, ev: Record<string, unknown>) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev)
    },
    count: (type: string) => (listeners.get(type) ?? []).length,
  }
}

/** A keydown event of the browser, as the listener sees it. */
const tabKey = (shiftKey = false) => ({
  key: 'Tab', shiftKey, ctrlKey: false, metaKey: false, altKey: false, target: null,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true },
})

beforeEach(() => {
  useUi.setState({ mode: 'edit', tool: 'select', selection: null, multi: [] })
  useDoc.setState({ doc: v2() })
})

describe('the pick stack under a point', () => {
  it('gives [element, face, wall, room A, room B] on a door of a wall that two rooms share', () => {
    const doc = v2()
    const wall = sharedWall(doc)
    const stack = pickStack(doc, AT_DOOR, TOL)
    expect(shape(stack)).toEqual(['element', 'face', 'wall', 'room', 'room'])

    // The element is the door.
    expect(stack[0]).toEqual({ kind: 'element', elementId: 'door-1' })
    // The face is the face of the side of the point: the same face a click gives (wallSides).
    const face = wallFaceAtPoint(doc, wall.id, AT_DOOR)
    expect(face).not.toBeNull()
    expect(stack[1]).toEqual({ kind: 'storedWall', wallId: wall.id, side: face!.side, face: face!.key })
    // The wall is the same wall, with the side of the point and no face.
    expect(stack[2]).toEqual({ kind: 'storedWall', wallId: wall.id, side: face!.side })
    // The floor is room A: the side of the door.
    expect(stack[3]).toEqual({ kind: 'room', roomId: 'A' })
    // Then the room on the other side of the wall (Chrome test R3-5: Tab must reach the rooms).
    expect(stack[4]).toEqual({ kind: 'room', roomId: 'B' })
  })

  it('does not repeat an item, and gives one item per thing', () => {
    const stack = pickStack(v2(), AT_DOOR, TOL)
    expect(new Set(stack.map(pickKey)).size).toBe(stack.length)
  })

  it('gives the rooms of the wall (pointer side first) when the point is inside the band only', () => {
    const doc = v2()
    const wall = sharedWall(doc)
    // 2 cm from the centre line: the wall band (half of 10 cm), but not the floor of a room.
    const stack = pickStack(doc, { x: 200, y: 298 }, 2)
    expect(shape(stack)).toEqual(['element', 'face', 'wall', 'room', 'room'])
    expect(stack.slice(0, 3).every((s) => s.kind === 'element' || (s.kind === 'storedWall' && s.wallId === wall.id))).toBe(true)
  })

  it('has no item when the point is far from everything', () => {
    expect(pickStack(v2(), { x: 5000, y: 5000 }, TOL)).toEqual([])
  })

  it('gives a room wall in a v1 document (no stored wall)', () => {
    const doc = v1()
    const stack = pickStack(doc, AT_DOOR, TOL)
    // The two room walls on that line, then the floor of room A.
    expect(shape(stack)).toEqual(['wall', 'wall', 'room'])
    expect(stack[0]).toEqual({ kind: 'wall', roomId: 'A', wallStart: 'A-v2' })
    expect(stack[2]).toEqual({ kind: 'room', roomId: 'A' })
  })

  it('gives the corner of a room within the slack of the pointer', () => {
    // 7 cm from the corner, inside the floor (the inside faces are 5 cm from the centre lines).
    const stack = pickStack(v1(), { x: 7, y: 7 }, 12)
    // The two walls that meet at the corner come first (the order of the stack), then the corner,
    // then the floor of room A.
    expect(shape(stack)).toEqual(['wall', 'wall', 'vertex', 'room'])
    expect(stack[2]).toEqual({ kind: 'vertex', roomId: 'A', vertexId: 'A-v0' })
  })
})

describe('the Tab order', () => {
  it('flicks through the stack and wraps around', () => {
    const doc = v2()
    const stack = pickStack(doc, AT_DOOR, TOL)
    expect(stack.length).toBe(5)
    // Nothing selected: the top of the stack.
    expect(nextInStack(stack, null)).toEqual(stack[0])
    // Then each item, and the last one comes back to the top.
    expect(nextInStack(stack, stack[0])).toEqual(stack[1])
    expect(nextInStack(stack, stack[1])).toEqual(stack[2])
    expect(nextInStack(stack, stack[2])).toEqual(stack[3])
    expect(nextInStack(stack, stack[3])).toEqual(stack[4])
    expect(nextInStack(stack, stack[4])).toEqual(stack[0])
    // Shift + Tab goes the other way, with the same wrap around.
    expect(nextInStack(stack, stack[0], true)).toEqual(stack[4])
    expect(nextInStack(stack, stack[4], true)).toEqual(stack[3])
  })

  it('does nothing when the stack has one item (the browser keeps Tab)', () => {
    // The middle of room A: the floor only.
    const stack = pickStack(v2(), { x: 200, y: 100 }, TOL)
    expect(stack).toEqual([{ kind: 'room', roomId: 'A' }])
    expect(nextInStack(stack, null)).toBeNull()
    expect(nextInStack(stack, stack[0])).toBeNull()
  })

  it('selects the next item of the stack at the last pointer position', () => {
    const ui = () => useUi.getState()
    // Nothing selected, the pointer on the door: Tab selects the door.
    expect(tabStep(false, AT_DOOR, view)).toBe(true)
    expect(ui().selection).toEqual({ kind: 'element', elementId: 'door-1' })
    // Then the face, the wall and the floor, then the door again.
    expect(tabStep(false, AT_DOOR, view)).toBe(true)
    expect(ui().selection?.kind).toBe('storedWall')
    expect(tabStep(false, AT_DOOR, view)).toBe(true)
    const third = ui().selection
    expect(third?.kind).toBe('storedWall')
    expect(tabStep(false, AT_DOOR, view)).toBe(true)
    expect(ui().selection).toEqual({ kind: 'room', roomId: 'A' })
    expect(tabStep(false, AT_DOOR, view)).toBe(true)
    expect(ui().selection).toEqual({ kind: 'room', roomId: 'B' })
    expect(tabStep(false, AT_DOOR, view)).toBe(true)
    expect(ui().selection).toEqual({ kind: 'element', elementId: 'door-1' })
    // Shift + Tab: back to the room across the wall.
    expect(tabStep(true, AT_DOOR, view)).toBe(true)
    expect(ui().selection).toEqual({ kind: 'room', roomId: 'B' })
  })

  it('leaves the Tab key alone in Measuring mode, with another tool, and away from the plan', () => {
    useUi.setState({ mode: 'measure' })
    expect(tabStep(false, AT_DOOR, view)).toBe(false)
    expect(useUi.getState().selection).toBeNull()

    useUi.setState({ mode: 'edit', tool: 'wall' })
    expect(tabStep(false, AT_DOOR, view)).toBe(false)
    expect(useUi.getState().selection).toBeNull()

    useUi.setState({ tool: 'select' })
    // No pointer position on the plan yet.
    expect(tabStep(false, null, view)).toBe(false)
    expect(useUi.getState().selection).toBeNull()
  })
})

describe('the Tab key listener', () => {
  it('selects on Tab at the last pointer position over the plan, and keeps Tab when nothing changes', () => {
    const win = fakeWindow()
    ;(globalThis as unknown as { window: unknown }).window = win
    const uninstall = installTabCycle(() => view)
    try {
      win.fire('pointermove', { clientX: AT_DOOR.x, clientY: AT_DOOR.y, target: null })
      const first = tabKey()
      win.fire('keydown', first)
      expect(useUi.getState().selection).toEqual({ kind: 'element', elementId: 'door-1' })
      // The focus does not move: the browser must not act on the key.
      expect(first.defaultPrevented).toBe(true)

      // A Shift + Tab goes back: room B, across the wall (the bottom of the stack).
      useUi.setState({ selection: { kind: 'element', elementId: 'door-1' } })
      win.fire('keydown', tabKey(true))
      expect(useUi.getState().selection).toEqual({ kind: 'room', roomId: 'B' })

      // Over the middle of a room the stack has one item: Tab keeps its browser meaning.
      win.fire('pointermove', { clientX: 200, clientY: 100, target: null })
      const alone = tabKey()
      win.fire('keydown', alone)
      expect(alone.defaultPrevented).toBe(false)
      // The selection does not change (still room B from the Shift + Tab above).
      expect(useUi.getState().selection).toEqual({ kind: 'room', roomId: 'B' })

      // Ctrl / Alt / Cmd + Tab belong to the browser.
      win.fire('pointermove', { clientX: AT_DOOR.x, clientY: AT_DOOR.y, target: null })
      const ctrl = { ...tabKey(), ctrlKey: true }
      win.fire('keydown', ctrl)
      expect(ctrl.defaultPrevented).toBe(false)
    } finally {
      uninstall()
      expect(win.count('keydown')).toBe(0)
      expect(win.count('pointermove')).toBe(0)
      delete (globalThis as unknown as { window?: unknown }).window
    }
  })
})
