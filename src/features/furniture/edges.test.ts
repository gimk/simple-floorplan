// Resize of a single selected item from any handle of its selection box (corners and edges).
// The corner math must stay EXACTLY what FurnitureLayer had before edge handles existed: the tests
// compare resizeFurnitureFromHandle against a verbatim copy of that old formula.
// Units: cm, degrees, y points down.
import { describe, expect, it } from 'vitest'
import type { Vec } from '../../model/geometry'
import type { FurnitureItem } from '../../model/types'
import { roundToPrecision } from '../rooms/ops'
import {
  CORNER_HANDLES,
  EDGE_HANDLES,
  MAX_FURNITURE_CM,
  MIN_FURNITURE_CM,
  resizeFurnitureFromHandle,
} from './geometry'
import type { CornerHandle, EdgeHandle, ResizeHandle } from './geometry'

const RAD = Math.PI / 180

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Desk', shape: 'rect', xCm: 200, yCm: 150, widthCm: 120, depthCm: 60,
  rotationDeg: 0, color: '#4b5563', ...p,
})

/** The corner resize of FurnitureLayer BEFORE this change, copied verbatim. */
function oldCornerResize(
  it: FurnitureItem,
  c: CornerHandle,
  p: Vec,
  opts: { shift: boolean; precisionCm: number },
): { widthCm: number; depthCm: number; xCm: number; yCm: number } {
  const a = it.rotationDeg * RAD
  const cos = Math.cos(a), sin = Math.sin(a)
  const w0 = it.widthCm, d0 = it.depthCm
  const o = { x: -c.sx * w0 / 2, y: -c.sy * d0 / 2 }
  const dx = p.x - it.xCm, dy = p.y - it.yCm
  const lx = dx * cos + dy * sin
  const ly = -dx * sin + dy * cos
  let w = (lx - o.x) * c.sx
  let d = (ly - o.y) * c.sy
  if (opts.shift) {
    const s = Math.max(w / w0, d / d0)
    const lo = Math.max(MIN_FURNITURE_CM / w0, MIN_FURNITURE_CM / d0)
    const hi = Math.min(MAX_FURNITURE_CM / w0, MAX_FURNITURE_CM / d0)
    const k = Math.min(hi, Math.max(lo, s))
    w = w0 * k
    d = d0 * k
  }
  const clamp = (v: number) => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))
  w = clamp(roundToPrecision(w, opts.precisionCm))
  d = clamp(roundToPrecision(d, opts.precisionCm))
  const cl = { x: o.x + c.sx * w / 2, y: o.y + c.sy * d / 2 }
  return {
    widthCm: w,
    depthCm: d,
    xCm: it.xCm + cl.x * cos - cl.y * sin,
    yCm: it.yCm + cl.x * sin + cl.y * cos,
  }
}

/** A point of the item's local frame, in artboard cm. */
const toWorldPoint = (it: Pick<FurnitureItem, 'xCm' | 'yCm' | 'rotationDeg'>, lx: number, ly: number): Vec => {
  const a = it.rotationDeg * RAD
  return { x: it.xCm + lx * Math.cos(a) - ly * Math.sin(a), y: it.yCm + lx * Math.sin(a) + ly * Math.cos(a) }
}

/** Midpoint of the left edge (local x = -width/2, local y = 0) in artboard cm. */
const leftEdgeMid = (it: Pick<FurnitureItem, 'xCm' | 'yCm' | 'widthCm' | 'rotationDeg'>): Vec =>
  toWorldPoint(it, -it.widthCm / 2, 0)

/** Centre of the resized item, in the LOCAL frame of the item before the resize. */
const centreInStartFrame = (start: FurnitureItem, next: { xCm: number; yCm: number }): Vec => {
  const a = start.rotationDeg * RAD
  const dx = next.xCm - start.xCm, dy = next.yCm - start.yCm
  return { x: dx * Math.cos(a) + dy * Math.sin(a), y: -dx * Math.sin(a) + dy * Math.cos(a) }
}

describe('corner resize is unchanged', () => {
  const rotations = [0, 30, 45, 90, 123.4, 180, 270, -20]
  const precisions = [0.1, 0.5, 1]
  const pointers: Vec[] = [
    { x: 300, y: 220 },
    { x: 260, y: 190 },
    { x: 150, y: 100 },
    { x: 205, y: 151 },
    { x: 900, y: 700 }, // far away: hits MAX_FURNITURE_CM
    { x: 200, y: 150 }, // exactly on the centre: hits MIN_FURNITURE_CM
  ]

  it('matches the old formula for every corner, rotation, pointer, Shift state and precision', () => {
    for (const rotationDeg of rotations) {
      for (const precisionCm of precisions) {
        for (const shift of [false, true]) {
          for (const corner of CORNER_HANDLES) {
            for (const p of pointers) {
              const it = item({ rotationDeg })
              expect(resizeFurnitureFromHandle(it, corner, p, { shift, precisionCm })).toEqual(
                oldCornerResize(it, corner, p, { shift, precisionCm }),
              )
            }
          }
        }
      }
    }
  })

  it('keeps the opposite corner fixed on a rotated item', () => {
    const it = item({ rotationDeg: 30 })
    const corner: CornerHandle = { sx: 1, sy: 1 }
    // A pointer past the bottom-right corner, in the item's own frame: both sides grow.
    const p = toWorldPoint(it, it.widthCm, it.depthCm)
    const next = resizeFurnitureFromHandle(it, corner, p, { shift: false, precisionCm: 0.1 })
    const fixedBefore = toWorldPoint(it, -it.widthCm / 2, -it.depthCm / 2)
    const fixedAfter = toWorldPoint({ ...it, ...next }, -next.widthCm / 2, -next.depthCm / 2)
    expect(fixedAfter.x).toBeCloseTo(fixedBefore.x, 9)
    expect(fixedAfter.y).toBeCloseTo(fixedBefore.y, 9)
    expect(next.widthCm).toBeGreaterThan(it.widthCm)
    expect(next.depthCm).toBeGreaterThan(it.depthCm)
  })
})

describe('edge resize', () => {
  const right: EdgeHandle = { sx: 1, sy: 0 }
  const left: EdgeHandle = { sx: -1, sy: 0 }
  const bottom: EdgeHandle = { sx: 0, sy: 1 }
  const top: EdgeHandle = { sx: 0, sy: -1 }

  it('the right edge of a 30-degree item keeps the left edge fixed', () => {
    const it = item({ rotationDeg: 30 })
    const next = resizeFurnitureFromHandle(it, right, { x: 320, y: 220 }, { shift: false, precisionCm: 0.1 })
    expect(next.widthCm).toBeGreaterThan(it.widthCm)
    // The other dimension and the centre line do not move.
    expect(next.depthCm).toBe(it.depthCm)
    const after = { ...it, ...next }
    const before = leftEdgeMid(it)
    const now = leftEdgeMid(after)
    expect(now.x).toBeCloseTo(before.x, 9)
    expect(now.y).toBeCloseTo(before.y, 9)
    // The dragged edge really moved away from the fixed one.
    expect(next.widthCm).toBeGreaterThan(120)
  })

  it('the left edge of a 30-degree item keeps the right edge fixed', () => {
    const it = item({ rotationDeg: 30 })
    const next = resizeFurnitureFromHandle(it, left, { x: 100, y: 90 }, { shift: false, precisionCm: 0.1 })
    const fixedBefore = toWorldPoint(it, it.widthCm / 2, 0)
    const fixedAfter = toWorldPoint({ ...it, ...next }, next.widthCm / 2, 0)
    expect(fixedAfter.x).toBeCloseTo(fixedBefore.x, 9)
    expect(fixedAfter.y).toBeCloseTo(fixedBefore.y, 9)
    expect(next.depthCm).toBe(it.depthCm)
  })

  it('the top and bottom edges only change the depth, around the centre line', () => {
    const it = item({ rotationDeg: 0 })
    const down = resizeFurnitureFromHandle(it, bottom, { x: 200, y: 260 }, { shift: false, precisionCm: 0.1 })
    expect(down.widthCm).toBe(it.widthCm)
    expect(down.xCm).toBe(it.xCm)
    expect(down.depthCm).toBeGreaterThan(it.depthCm)
    // Top edge of the item stays at its old world y.
    expect(down.yCm - down.depthCm / 2).toBeCloseTo(it.yCm - it.depthCm / 2, 9)

    const up = resizeFurnitureFromHandle(it, top, { x: 200, y: 60 }, { shift: false, precisionCm: 0.1 })
    expect(up.depthCm).toBeGreaterThan(it.depthCm)
    expect(up.yCm + up.depthCm / 2).toBeCloseTo(it.yCm + it.depthCm / 2, 9)
    expect(up.xCm).toBe(it.xCm)
  })

  it('Shift keeps the aspect ratio and grows the other axis around the centre line', () => {
    const it = item({ rotationDeg: 30 })
    const start = toWorldPoint(it, 0, 0)
    const next = resizeFurnitureFromHandle(it, right, { x: 330, y: 230 }, { shift: true, precisionCm: 0.1 })
    expect(next.widthCm).toBeGreaterThan(it.widthCm)
    expect(next.depthCm).toBeGreaterThan(it.depthCm)
    // Same factor on both axes (up to the 0.1 cm rounding).
    expect(next.widthCm / it.widthCm).toBeCloseTo(next.depthCm / it.depthCm, 2)
    // The centre line (local y = 0 of the start frame) is unchanged: the new centre sits on it.
    const centre = centreInStartFrame(it, next)
    expect(centre.y).toBeCloseTo(0, 9)
    // The fixed left side stays at local x = -width/2, so the centre moved by half the width change.
    expect(centre.x).toBeCloseTo((next.widthCm - it.widthCm) / 2, 9)
    // ... and the item really is centred somewhere else than before.
    expect(Math.hypot(next.xCm - start.x, next.yCm - start.y)).toBeGreaterThan(0)
  })

  it('Shift on a bottom edge scales the width around the item centre line', () => {
    const it = item({ rotationDeg: 0 })
    const next = resizeFurnitureFromHandle(it, bottom, { x: 200, y: 250 }, { shift: true, precisionCm: 0.1 })
    expect(next.depthCm).toBeGreaterThan(it.depthCm)
    expect(next.widthCm).toBeGreaterThan(it.widthCm)
    expect(next.xCm).toBeCloseTo(it.xCm, 9) // centre line of the width does not move
    expect(next.widthCm / it.widthCm).toBeCloseTo(next.depthCm / it.depthCm, 2)
  })

  it('clamps at MIN_FURNITURE_CM and at MAX_FURNITURE_CM', () => {
    const it = item({ rotationDeg: 0 })
    const tiny = resizeFurnitureFromHandle(it, right, { x: 0, y: 150 }, { shift: false, precisionCm: 0.1 })
    expect(tiny.widthCm).toBe(MIN_FURNITURE_CM)
    const huge = resizeFurnitureFromHandle(it, right, { x: 5000, y: 150 }, { shift: false, precisionCm: 1 })
    expect(huge.widthCm).toBe(MAX_FURNITURE_CM)
    // Shift cannot push the other dimension out of range either.
    const shifted = resizeFurnitureFromHandle(item({ widthCm: 20, depthCm: 900 }), bottom, { x: 200, y: 4000 }, {
      shift: true,
      precisionCm: 0.1,
    })
    expect(shifted.depthCm).toBe(MAX_FURNITURE_CM)
    expect(shifted.widthCm).toBeGreaterThanOrEqual(MIN_FURNITURE_CM)
    expect(shifted.widthCm).toBeLessThanOrEqual(MAX_FURNITURE_CM)
    // Shift shrinks both axes by one factor, so the narrow side stops the drag at 0.75 (15 / 20).
    const shrunk = resizeFurnitureFromHandle(item({ widthCm: 900, depthCm: 20 }), right, { x: 0, y: 150 }, {
      shift: true,
      precisionCm: 0.1,
    })
    expect(shrunk.depthCm).toBe(MIN_FURNITURE_CM)
    expect(shrunk.widthCm).toBe(675)
  })

  it('rounds to the precision of the artboard', () => {
    const it = item({ rotationDeg: 0 })
    const p = { x: 273.37, y: 150 }
    // Left side stays at x = 140, so the width is 273.37 - 140 = 133.37 cm before rounding.
    expect(resizeFurnitureFromHandle(it, right, p, { shift: false, precisionCm: 1 }).widthCm).toBe(133)
    expect(resizeFurnitureFromHandle(it, right, p, { shift: false, precisionCm: 0.5 }).widthCm).toBe(133.5)
    expect(resizeFurnitureFromHandle(it, right, p, { shift: false, precisionCm: 0.1 }).widthCm).toBe(133.4)
  })

  it('a handle of {0, 0} returns the item unchanged', () => {
    const it = item({ rotationDeg: 42, widthCm: 123.456 })
    const same: ResizeHandle = { sx: 0, sy: 0 }
    expect(resizeFurnitureFromHandle(it, same, { x: 999, y: -999 }, { shift: true, precisionCm: 0.1 })).toEqual({
      widthCm: 123.456,
      depthCm: it.depthCm,
      xCm: it.xCm,
      yCm: it.yCm,
    })
  })

  it('lists 4 corners and 4 edges, all distinct', () => {
    expect(CORNER_HANDLES).toHaveLength(4)
    expect(EDGE_HANDLES).toHaveLength(4)
    const keys = new Set([...CORNER_HANDLES, ...EDGE_HANDLES].map((h) => `${h.sx}:${h.sy}`))
    expect(keys.size).toBe(8)
    expect(keys.has('0:0')).toBe(false)
  })
})
