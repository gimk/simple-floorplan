// ONE face of a stored wall is selected by a click (docs/walls-plan.md, "Walls in the interface").
// The test wall has FOUR faces: two room faces on one side, a room face and an outside span on the
// other side. A click at 4 points gives 4 different selections; a second click on a face selects
// the face directly across.
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { onStoredWallDown } from './interaction'
import { faceByKey, faceKeyOf, sideFaceKeys, storedWallView, wallFaceAcross, wallFaceAtPoint } from './wallSides'

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
    fire(type: string, ev: Record<string, unknown>) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev)
    },
  }
}

const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [], walls: {}, walkOrder,
})

/**
 * The wall y = 300, x 0..400. Below it (side L when a is the left end): rooms B1 (0..200) and B2
 * (200..400). Above it: room A (0..250), then the outside from 250 to 400.
 */
const plan = (): PlanDoc => convertToV2({
  ...emptyDoc(),
  rooms: [
    mk('A', [[0, 0], [250, 0], [250, 300], [0, 300]], 1),
    mk('B1', [[0, 300], [200, 300], [200, 600], [0, 600]], 2),
    mk('B2', [[200, 300], [400, 300], [400, 600], [200, 600]], 3),
  ],
}).doc

/** The long wall: the one with four faces. */
const longWall = (doc: PlanDoc) =>
  doc.walls!.find((w) => w.faces.some((f) => f.roomId === 'A') && w.faces.some((f) => f.roomId === 'B1'))!

const vp = { toWorld: (x: number, y: number) => ({ x, y }), px: (n: number) => n }

const down = (x: number, y: number, shiftKey = false) => ({
  clientX: x, clientY: y, button: 0, isPrimary: true, pointerId: 1, shiftKey,
  stopPropagation: () => {},
}) as unknown as Parameters<typeof onStoredWallDown>[0]

let win: ReturnType<typeof pointerWindow>

beforeEach(() => {
  win = pointerWindow()
  ;(globalThis as unknown as { window: unknown }).window = win
  useUi.setState({ mode: 'edit', tool: 'select', selection: null, multi: [] })
  useDoc.setState({ doc: plan() })
})

/** The four click points: B1, B2 (below), A, outside (above). */
const POINTS = { b1: { x: 100, y: 320 }, b2: { x: 300, y: 320 }, a: { x: 100, y: 280 }, out: { x: 330, y: 280 } }

describe('faces of a stored wall', () => {
  it('has two room faces on one side, a room face and an outside span on the other', () => {
    const doc = plan()
    const view = storedWallView(doc, longWall(doc).id)!
    const kinds = view.sides.map((s) => s.faces.map((f) => f.kind).join(','))
    expect(kinds.sort()).toEqual(['outside,room'.split(',').reverse().join(','), 'room,room'].sort())
  })

  it('writes the key of a face: room:<roomId>:<wallStart>, out:<side>:<index>', () => {
    const doc = plan()
    const view = storedWallView(doc, longWall(doc).id)!
    for (const s of view.sides) {
      const keys = sideFaceKeys(s)
      expect(keys).toHaveLength(s.faces.length)
      s.faces.forEach((f, i) => {
        if (f.kind === 'room') expect(keys[i]).toBe(`room:${f.roomId}:${f.wallStart}`)
        else expect(keys[i]).toBe(`out:${s.side}:0`)
        expect(keys[i]).toBe(faceKeyOf(s.side, f, 0))
        expect(faceByKey(view, keys[i])?.face).toBe(f)
      })
    }
    expect(faceByKey(view, 'room:nobody:x')).toBeNull()
  })

  it('finds the face under a point, and the face across', () => {
    const doc = plan()
    const id = longWall(doc).id
    const picks = Object.values(POINTS).map((p) => wallFaceAtPoint(doc, id, p)!)
    expect(new Set(picks.map((p) => p.key)).size).toBe(4)
    const b1 = wallFaceAtPoint(doc, id, POINTS.b1)!
    expect(b1.key.startsWith('room:B1:')).toBe(true)
    // Across B1 (below): room A. Across B2: the outside span. Across the outside span: room B2.
    expect(wallFaceAcross(doc, id, POINTS.b1)!.key.startsWith('room:A:')).toBe(true)
    expect(wallFaceAcross(doc, id, POINTS.b2)!.key).toMatch(/^out:/)
    expect(wallFaceAcross(doc, id, POINTS.out)!.key.startsWith('room:B2:')).toBe(true)
    // A click past the end of the wall is clamped to the first / last face.
    expect(wallFaceAtPoint(doc, id, { x: -50, y: 320 })!.key).toBe(b1.key)
  })
})

describe('a click on a face of a stored wall', () => {
  it('selects 4 different faces, by clicks at 4 points', () => {
    const id = longWall(plan()).id
    const seen: string[] = []
    for (const p of Object.values(POINTS)) {
      useUi.setState({ selection: null })
      onStoredWallDown(down(p.x, p.y), vp, id)
      win.fire('pointerup', { pointerId: 1 })
      const sel = useUi.getState().selection as { kind: string; wallId: string; side: string; face: string }
      expect(sel.kind).toBe('storedWall')
      expect(sel.wallId).toBe(id)
      expect(sel.face).toBeTruthy()
      seen.push(`${sel.side}|${sel.face}`)
    }
    expect(new Set(seen).size).toBe(4)
  })

  it('selects the face across on a second click on the same face', () => {
    const id = longWall(plan()).id
    const doc = plan()
    const p = POINTS.b2
    const first = wallFaceAtPoint(doc, id, p)!
    const across = wallFaceAcross(doc, id, p)!
    onStoredWallDown(down(p.x, p.y), vp, id)
    win.fire('pointerup', { pointerId: 1 })
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: id, side: first.side, face: first.key })
    onStoredWallDown(down(p.x, p.y), vp, id)
    win.fire('pointerup', { pointerId: 1 })
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: id, side: across.side, face: across.key })
    expect(across.side).not.toBe(first.side)
    // A click on ANOTHER face of the wall selects that face, no flip.
    onStoredWallDown(down(POINTS.b1.x, POINTS.b1.y), vp, id)
    win.fire('pointerup', { pointerId: 1 })
    expect((useUi.getState().selection as { face: string }).face.startsWith('room:B1:')).toBe(true)
  })
})
