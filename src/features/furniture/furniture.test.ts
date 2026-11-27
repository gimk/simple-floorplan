import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem, Room } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import {
  addFurniture, deleteFurniture, duplicateFurniture, reorderFurniture, setRoomFill, setRoomFloorPattern, setRoomWallColor,
  setRoomsFill, setRoomsFloorPattern, setRoomsFloorPatternAngle, updateFurniture, updateFurnitureSilent,
} from './actions'
import {
  computeDistanceGuides, DEFAULT_MAX_GUIDE_DIST_CM, MAX_FURNITURE_CM, MIN_FURNITURE_CM, directionArrowGeometry,
  CORNER_SIGNS, cornerRadiiPatch, furnitureAxisBounds, furnitureCornerRadiiCm, furnitureCornerRadiusCm,
  furnitureWorldCorners, normalizeAngle, radiusFromPointer, roundedRectPath, snapFurnitureMove, snapRotation,
} from './geometry'
import { FLOOR_SWATCHES, FURNITURE_CATEGORY_BY_ID, FURNITURE_COLORS, FURNITURE_PRESETS } from './presets'

// ---------- helpers ----------

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Sofa', shape: 'rect', xCm: 0, yCm: 0, widthCm: 100, depthCm: 60, rotationDeg: 0, color: '#4b5563', ...p,
})

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})

const board = (rooms: Room[] = [], furniture: FurnitureItem[] = [], precisionCm: 0.1 | 0.5 | 1 = 1): Artboard => ({
  ...createArtboard('Plan A'),
  precisionCm,
  rooms,
  furniture,
})

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null })
})

// ---------- presets ----------

describe('presets and swatches', () => {
  it('floor swatches: 10 entries, Default has no colour, ids and colours are valid', () => {
    expect(FLOOR_SWATCHES).toHaveLength(10)
    expect(FLOOR_SWATCHES[0]).toMatchObject({ label: 'Default', color: undefined })
    expect(new Set(FLOOR_SWATCHES.map((x) => x.id)).size).toBe(10)
    expect(new Set(FLOOR_SWATCHES.map((x) => x.label)).size).toBe(10)
    for (const sw of FLOOR_SWATCHES.slice(1)) expect(sw.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('furniture colours: 8 muted entries with unique ids and hex colours', () => {
    expect(FURNITURE_COLORS).toHaveLength(8)
    expect(new Set(FURNITURE_COLORS.map((c) => c.id)).size).toBe(8)
    expect(new Set(FURNITURE_COLORS.map((c) => c.color)).size).toBe(8)
    for (const c of FURNITURE_COLORS) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(FURNITURE_COLORS.map((c) => c.label)).toContain('Terracotta')
  })

  it('42 furniture presets: unique ids, valid shapes and usable sizes', () => {
    expect(FURNITURE_PRESETS).toHaveLength(42)
    expect(new Set(FURNITURE_PRESETS.map((p) => p.id)).size).toBe(42)
    const colors = new Set(FURNITURE_COLORS.map((c) => c.color))
    for (const p of FURNITURE_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(['rect', 'circle']).toContain(p.shape)
      expect(p.widthCm).toBeGreaterThanOrEqual(MIN_FURNITURE_CM)
      expect(p.widthCm).toBeLessThanOrEqual(MAX_FURNITURE_CM)
      expect(p.depthCm).toBeGreaterThanOrEqual(MIN_FURNITURE_CM)
      expect(p.depthCm).toBeLessThanOrEqual(MAX_FURNITURE_CM)
      expect(p.heightCm).toBeGreaterThan(0)
      expect(colors.has(p.color)).toBe(true)
    }
    const byId = new Map(FURNITURE_PRESETS.map((p) => [p.id, p]))
    expect(byId.get('bed')).toMatchObject({ widthCm: 160, depthCm: 200, shape: 'rect' })
    expect(byId.get('single-bed')).toMatchObject({ widthCm: 90, depthCm: 200 })
    expect(byId.get('sofa')).toMatchObject({ widthCm: 220, depthCm: 95 })
    expect(byId.get('armchair')).toMatchObject({ widthCm: 85, depthCm: 85 })
    expect(byId.get('dining-table')).toMatchObject({ widthCm: 180, depthCm: 90 })
    expect(byId.get('round-table')).toMatchObject({ widthCm: 110, depthCm: 110, shape: 'circle' })
    expect(byId.get('coffee-table')).toMatchObject({ widthCm: 120, depthCm: 60 })
    expect(byId.get('desk')).toMatchObject({ widthCm: 140, depthCm: 70 })
    expect(byId.get('wardrobe')).toMatchObject({ widthCm: 150, depthCm: 60 })
    expect(byId.get('bookshelf')).toMatchObject({ widthCm: 100, depthCm: 35 })
    expect(byId.get('kitchen-counter')).toMatchObject({ widthCm: 240, depthCm: 60 })
    expect(byId.get('rug')).toMatchObject({ widthCm: 200, depthCm: 300 })
  })

  it('layers the three rug presets at the bottom of the stack and leaves the others on top', () => {
    const byId = new Map(FURNITURE_PRESETS.map((p) => [p.id, p]))
    const rugIds = ['rug', 'rug-160', 'round-rug']
    for (const id of rugIds) expect(byId.get(id)?.layer).toBe('bottom')
    for (const p of FURNITURE_PRESETS.filter((x) => !rugIds.includes(x.id))) expect(p.layer).toBeUndefined()
  })

  it('marks only the directional presets with showDirection', () => {
    const directional = FURNITURE_PRESETS.filter((p) => p.showDirection === true).map((p) => p.id)
    expect(directional).toEqual([
      'bed', 'single-bed', 'bed-140', 'bed-180', 'bedside-table',
      'sofa', 'armchair', 'sofa-2', 'corner-sofa', 'dining-chair',
      'desk',
      'wardrobe', 'bookshelf', 'chest-of-drawers', 'sideboard', 'tv-unit', 'shoe-cabinet',
      'kitchen-counter', 'base-cabinet-60', 'sink-unit', 'cooker', 'dishwasher', 'fridge', 'american-fridge',
      'toilet', 'washbasin', 'double-washbasin', 'washing-machine', 'dryer',
    ])
    const plain = [
      'baby-cot', 'office-chair', 'dining-table', 'round-table', 'coffee-table', 'dining-table-4', 'side-table',
      'kitchen-island', 'bathtub', 'shower-tray', 'rug', 'rug-160', 'round-rug',
    ]
    for (const id of plain) {
      expect(FURNITURE_PRESETS.find((p) => p.id === id)?.showDirection).toBeFalsy()
    }
  })

  it('gives every built-in preset a category other than Other, in the chip order', () => {
    for (const p of FURNITURE_PRESETS) {
      expect(FURNITURE_CATEGORY_BY_ID[p.id]).toBeTruthy()
      expect(FURNITURE_CATEGORY_BY_ID[p.id]).not.toBe('Other')
    }
    expect(new Set(FURNITURE_PRESETS.map((p) => FURNITURE_CATEGORY_BY_ID[p.id]))).toEqual(
      new Set(['Beds', 'Seating', 'Tables', 'Storage', 'Kitchen', 'Bathroom', 'Rugs']),
    )
    expect([...new Set(FURNITURE_PRESETS.map((p) => FURNITURE_CATEGORY_BY_ID[p.id]))]).toEqual(
      ['Beds', 'Seating', 'Tables', 'Storage', 'Kitchen', 'Bathroom', 'Rugs'],
    )
  })
})

// ---------- corner radius and direction arrow ----------

describe('furnitureCornerRadiusCm / directionArrowGeometry', () => {
  it('defaults the corner radius to 4 cm and clamps it to half the shorter side', () => {
    expect(furnitureCornerRadiusCm(100, 60)).toBe(4)
    expect(furnitureCornerRadiusCm(100, 60, 12)).toBe(12)
    expect(furnitureCornerRadiusCm(100, 60, 900)).toBe(30)
    expect(furnitureCornerRadiusCm(20, 10, 6)).toBe(5)
    expect(furnitureCornerRadiusCm(100, 60, 0)).toBe(0)
    expect(furnitureCornerRadiusCm(100, 60, -8)).toBe(0)
  })

  it('gives the effective radii of the 4 corners, clamped, with one radius for all as the fallback', () => {
    const base = { widthCm: 100, depthCm: 60 }
    // No radius in the document: the default 4 cm on all 4 corners.
    expect(furnitureCornerRadiiCm(base)).toEqual([4, 4, 4, 4])
    expect(furnitureCornerRadiiCm({ ...base, cornerRadiusCm: 12 })).toEqual([12, 12, 12, 12])
    // The per-corner field wins over the single radius, top-left, top-right, bottom-right, bottom-left.
    expect(furnitureCornerRadiiCm({ ...base, cornerRadiusCm: 12, cornerRadiiCm: [1, 2, 3, 4] })).toEqual([1, 2, 3, 4])
    // Every radius is clamped to >= 0 and to half of the shorter side (30 cm here).
    expect(furnitureCornerRadiiCm({ widthCm: 20, depthCm: 10, cornerRadiiCm: [-5, 900, 6, 2] })).toEqual([0, 5, 5, 2])
    // A malformed per-corner field falls back to the single radius.
    expect(furnitureCornerRadiiCm({ ...base, cornerRadiusCm: 7, cornerRadiiCm: [3] as unknown as [number, number, number, number] })).toEqual([7, 7, 7, 7])
  })

  it('turns a radius-handle drag into a radius: mean of the two inward distances, rounded, clamped', () => {
    // 100 x 50 at the origin, no rotation. Top-left corner is (-50, -25), inward is (+1, +1).
    const flat = { xCm: 0, yCm: 0, widthCm: 100, depthCm: 50, rotationDeg: 0 }
    expect(radiusFromPointer(flat, 0, { x: -50, y: -25 })).toBe(0) // on the corner
    expect(radiusFromPointer(flat, 0, { x: -20, y: -5 })).toBe(25) // 30 and 20 in: mean 25
    expect(radiusFromPointer(flat, 0, { x: -40, y: -15 })).toBe(10) // 10 and 10 in
    expect(radiusFromPointer(flat, 0, { x: 0, y: 0 })).toBe(25) // clamped to half the depth
    expect(radiusFromPointer(flat, 0, { x: -80, y: -60 })).toBe(0) // outside the corner
    // Top-right corner is (50, -25), inward is (-1, +1): 20 and 20 in gives 20.
    expect(radiusFromPointer(flat, 1, { x: 30, y: -5 })).toBe(20)
    // Bottom-left corner is (-50, 25), inward is (+1, -1).
    expect(radiusFromPointer(flat, 3, { x: -30, y: 5 })).toBe(20)
    // Whole cm only: 13 and 12 in means 12.5, which rounds to 13; 12 and 11 in means 11.5 -> 12.
    expect(radiusFromPointer(flat, 0, { x: -37, y: -13 })).toBe(13)
    expect(radiusFromPointer(flat, 0, { x: -38, y: -14 })).toBe(12)
  })

  it('reads the pointer in the rotated frame of the item', () => {
    // The same item turned 90 deg clockwise: local (lx, ly) lands at (-ly, lx) around (0, 0).
    const turned = { xCm: 0, yCm: 0, widthCm: 100, depthCm: 50, rotationDeg: 90 }
    // Local point (-30, -5) of the top-left corner: 20 and 20 in, so a 20 cm radius.
    expect(radiusFromPointer(turned, 0, { x: 5, y: -30 })).toBe(20)
    // The item centre is still the centre after the turn.
    expect(radiusFromPointer(turned, 0, { x: 0, y: 0 })).toBe(25)
    // And a translated item: the pointer is measured from xCm, yCm, not from the origin.
    const moved = { xCm: 200, yCm: 100, widthCm: 100, depthCm: 50, rotationDeg: 0 }
    expect(radiusFromPointer(moved, 0, { x: 180, y: 85 })).toBe(20)
    // CORNER_SIGNS is the order of cornerRadiiCm: top-left, top-right, bottom-right, bottom-left.
    expect(CORNER_SIGNS).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]])
  })

  it('collapses 4 equal radii into the single cornerRadiusCm field', () => {
    expect(cornerRadiiPatch('rect', [8, 8, 8, 8])).toEqual({ cornerRadiusCm: 8 })
    expect(cornerRadiiPatch('rect', [0, 0, 0, 0])).toEqual({ cornerRadiusCm: 0 })
    expect(cornerRadiiPatch('rect', [8, 4, 4, 4])).toEqual({ cornerRadiiCm: [8, 4, 4, 4] })
    // A circle has no corners.
    expect(cornerRadiiPatch('circle', [8, 8, 8, 8])).toBeNull()
  })

  it('builds the SVG path of a rounded rectangle, corner by corner', () => {
    // Default 4 cm radius on a 60 x 40 box, centred on 0: one arc per corner, clockwise.
    expect(roundedRectPath(60, 40, [4, 4, 4, 4])).toBe(
      'M -30 -16 A 4 4 0 0 1 -26 -20 L 26 -20 A 4 4 0 0 1 30 -16 ' +
        'L 30 16 A 4 4 0 0 1 26 20 L -26 20 A 4 4 0 0 1 -30 16 Z',
    )
    // 0 on every corner: a plain rectangle, with no arc at all.
    expect(roundedRectPath(60, 40, [0, 0, 0, 0])).toBe('M -30 -20 L 30 -20 L 30 20 L -30 20 Z')
    // One big corner only: the other three stay sharp.
    expect(roundedRectPath(60, 40, [10, 0, 0, 0])).toBe('M -30 -10 A 10 10 0 0 1 -20 -20 L 30 -20 L 30 20 L -30 20 Z')
    // Half the shorter side on all 4 corners: a stadium, with no zero-length side.
    expect(roundedRectPath(60, 40, [20, 20, 20, 20])).toBe(
      'M -30 0 A 20 20 0 0 1 -10 -20 L 10 -20 A 20 20 0 0 1 30 0 ' +
        'A 20 20 0 0 1 10 20 L -10 20 A 20 20 0 0 1 -30 0 Z',
    )
    // Radii above half the shorter side are clamped, and float noise never reaches the path.
    expect(roundedRectPath(60, 40, [500, 500, 500, 500])).toBe(roundedRectPath(60, 40, [20, 20, 20, 20]))
    expect(roundedRectPath(3, 3, [0, 0, 0, 0])).toBe('M -1.5 -1.5 L 1.5 -1.5 L 1.5 1.5 L -1.5 1.5 Z')
  })

  it('points the direction arrow to local -Y, inside the top edge', () => {
    const arrow = directionArrowGeometry(160, 200, (px) => px / 2)!
    expect(arrow.tip.x).toBe(0)
    expect(arrow.tip.y).toBeGreaterThan(-100)
    expect(arrow.tip.y).toBeLessThan(-97)
    // Wings go back (down) by the same amount as their half width: 45 degrees.
    expect(arrow.left.x).toBeCloseTo(-arrow.right.x)
    expect(arrow.left.y).toBeCloseTo(arrow.right.y)
    expect(arrow.left.y - arrow.tip.y).toBeCloseTo(Math.abs(arrow.left.x))
  })

  it('keeps the arrow inside a small item and drops it when there is no room', () => {
    const small = directionArrowGeometry(4, 4, (px) => px / 2)!
    expect(Math.abs(small.left.x)).toBeLessThanOrEqual(2)
    expect(small.left.y).toBeLessThanOrEqual(2)
    expect(directionArrowGeometry(0, 40, (px) => px)).toBeNull()
  })
})

// ---------- angles ----------

describe('normalizeAngle / snapRotation', () => {
  it('normalizes to [0, 360)', () => {
    expect(normalizeAngle(0)).toBe(0)
    expect(normalizeAngle(90)).toBe(90)
    expect(normalizeAngle(360)).toBe(0)
    expect(normalizeAngle(370)).toBeCloseTo(10)
    expect(normalizeAngle(-90)).toBe(270)
    expect(normalizeAngle(-450)).toBe(270)
    expect(normalizeAngle(720)).toBe(0)
    expect(Object.is(normalizeAngle(-360), 0)).toBe(true)
  })

  it('snaps to the nearest step and stays in [0, 360)', () => {
    expect(snapRotation(0, 15)).toBe(0)
    expect(snapRotation(44, 15)).toBe(45)
    expect(snapRotation(44, 90)).toBe(0)
    expect(snapRotation(46, 90)).toBe(90)
    expect(snapRotation(43, 90)).toBe(0)
    expect(snapRotation(359, 15)).toBe(0)
    expect(snapRotation(-8, 15)).toBe(345)
    expect(snapRotation(359.9, 1)).toBe(0)
  })

  it('a non-positive step only normalizes', () => {
    expect(snapRotation(370, 0)).toBeCloseTo(10)
    expect(snapRotation(-30, -15)).toBe(330)
  })
})

// ---------- corners and bounds ----------

describe('furnitureWorldCorners', () => {
  it('0 degrees: axis-aligned box around the centre, front edge is the top (-Y)', () => {
    const c = furnitureWorldCorners({ xCm: 100, yCm: 50, widthCm: 40, depthCm: 20, rotationDeg: 0 })
    expect(c[0]).toEqual({ x: 80, y: 40 }) // TL, the front-left corner
    expect(c[1]).toEqual({ x: 120, y: 40 })
    expect(c[2]).toEqual({ x: 120, y: 60 })
    expect(c[3]).toEqual({ x: 80, y: 60 })
  })

  it('90 degrees turns clockwise on screen (y down)', () => {
    const c = furnitureWorldCorners({ xCm: 100, yCm: 50, widthCm: 40, depthCm: 20, rotationDeg: 90 })
    expect(c[0].x).toBeCloseTo(110); expect(c[0].y).toBeCloseTo(30)
    expect(c[1].x).toBeCloseTo(110); expect(c[1].y).toBeCloseTo(70)
    expect(c[2].x).toBeCloseTo(90); expect(c[2].y).toBeCloseTo(70)
    expect(c[3].x).toBeCloseTo(90); expect(c[3].y).toBeCloseTo(30)
  })

  it('45 degrees keeps the centre, the size and the 90 degree corners', () => {
    const it45 = { xCm: 0, yCm: 0, widthCm: 100, depthCm: 60, rotationDeg: 45 }
    const c = furnitureWorldCorners(it45)
    const k = Math.SQRT1_2
    expect(c[0].x).toBeCloseTo((-50 + 30) * k); expect(c[0].y).toBeCloseTo((-50 - 30) * k)
    expect(c[1].x).toBeCloseTo((50 + 30) * k); expect(c[1].y).toBeCloseTo((50 - 30) * k)
    expect(c[2].x).toBeCloseTo((50 - 30) * k); expect(c[2].y).toBeCloseTo((50 + 30) * k)
    expect(c[3].x).toBeCloseTo((-50 - 30) * k); expect(c[3].y).toBeCloseTo((-50 + 30) * k)
    // The centre is the mean of the corners, and the sides keep their lengths.
    const mean = c.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 })
    expect(mean.x).toBeCloseTo(0); expect(mean.y).toBeCloseTo(0)
    expect(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y)).toBeCloseTo(100)
    expect(Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y)).toBeCloseTo(60)
  })

  it('rotation does not move the centre or change the width/depth', () => {
    for (const deg of [0, 17, 90, 180, 270, 359]) {
      const c = furnitureWorldCorners({ ...item({ xCm: 12, yCm: -7, widthCm: 90, depthCm: 40 }), rotationDeg: deg })
      expect((c[0].x + c[2].x) / 2).toBeCloseTo(12)
      expect((c[0].y + c[2].y) / 2).toBeCloseTo(-7)
      expect(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y)).toBeCloseTo(90)
    }
  })
})

describe('furnitureAxisBounds', () => {
  it('rect: axis-aligned bounds at 0 and 90 degrees', () => {
    const b0 = furnitureAxisBounds({ shape: 'rect', xCm: 100, yCm: 50, widthCm: 40, depthCm: 20, rotationDeg: 0 })
    expect(b0).toEqual({ minX: 80, minY: 40, maxX: 120, maxY: 60 })
    const b90 = furnitureAxisBounds({ shape: 'rect', xCm: 100, yCm: 50, widthCm: 40, depthCm: 20, rotationDeg: 90 })
    expect(b90.minX).toBeCloseTo(90); expect(b90.maxX).toBeCloseTo(110)
    expect(b90.minY).toBeCloseTo(30); expect(b90.maxY).toBeCloseTo(70)
  })

  it('rect at 45 degrees grows by the diagonal', () => {
    const b = furnitureAxisBounds({ shape: 'rect', xCm: 0, yCm: 0, widthCm: 100, depthCm: 60, rotationDeg: 45 })
    const half = Math.SQRT1_2 * (50 + 30)
    expect(b.minX).toBeCloseTo(-half); expect(b.maxX).toBeCloseTo(half)
    expect(b.minY).toBeCloseTo(-half); expect(b.maxY).toBeCloseTo(half)
  })

  it('circle: a round item is a circle, an oval follows the rotation', () => {
    const round = furnitureAxisBounds({ shape: 'circle', xCm: 10, yCm: 20, widthCm: 60, depthCm: 60, rotationDeg: 33 })
    expect(round.minX).toBeCloseTo(-20); expect(round.maxX).toBeCloseTo(40)
    expect(round.minY).toBeCloseTo(-10); expect(round.maxY).toBeCloseTo(50)

    const oval0 = furnitureAxisBounds({ shape: 'circle', xCm: 0, yCm: 0, widthCm: 40, depthCm: 20, rotationDeg: 0 })
    expect(oval0.minX).toBeCloseTo(-20); expect(oval0.maxY).toBeCloseTo(10)

    const oval90 = furnitureAxisBounds({ shape: 'circle', xCm: 0, yCm: 0, widthCm: 40, depthCm: 20, rotationDeg: 90 })
    expect(oval90.minX).toBeCloseTo(-10); expect(oval90.maxX).toBeCloseTo(10)
    expect(oval90.minY).toBeCloseTo(-20); expect(oval90.maxY).toBeCloseTo(20)
  })
})

// ---------- magnetic move ----------

describe('snapFurnitureMove', () => {
  const room = rect('r', 0, 0, 400, 300)

  it('snaps the left edge onto a room wall', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150 })
    const r = snapFurnitureMove(it1, 44, 150, board([room]), 10)
    // X: the left edge (-6) is pulled 6 cm right onto the wall. Y: nothing at 120, 150 or 180.
    expect(r).toEqual({ xCm: 50, yCm: 150, snappedX: true, snappedY: false })
    expect(furnitureAxisBounds({ ...it1, xCm: r.xCm, yCm: r.yCm }).minX).toBeCloseTo(0)
  })

  it('snaps to the bounds and centre of another item', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150 })
    const other = item({ id: 'f2', xCm: 300, yCm: 150, widthCm: 80, depthCm: 60 })
    const r = snapFurnitureMove(it1, 205, 150, board([room], [other]), 10)
    // right edge 255 pulled to the neighbour left edge 260 (+ cm)
    expect(r.xCm).toBe(210)
    expect(r.snappedX).toBe(true)
    // centre Y already level with the neighbour centre
    expect(r.yCm).toBe(150)
    expect(r.snappedY).toBe(true)
  })

  it('respects disableSnap', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150 })
    const r = snapFurnitureMove(it1, 44, 149.3, board([room]), 10, { disableSnap: true })
    expect(r).toEqual({ xCm: 44, yCm: 149.3, snappedX: false, snappedY: false })
  })

  it('rounds to the artboard precision when nothing is near', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150 })
    const free = board([], [])
    const r1 = snapFurnitureMove(it1, 203.4, 151.7, free, 10)
    expect(r1).toEqual({ xCm: 203, yCm: 152, snappedX: false, snappedY: false })
    const r05 = snapFurnitureMove(it1, 203.4, 151.7, board([], [], 0.5), 10)
    expect(r05).toEqual({ xCm: 203.5, yCm: 151.5, snappedX: false, snappedY: false })
    const r01 = snapFurnitureMove(it1, 203.44, 151.76, board([], [], 0.1), 10)
    expect(r01.xCm).toBeCloseTo(203.4)
    expect(r01.yCm).toBeCloseTo(151.8)
  })

  it('does not snap beyond the threshold', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150 })
    const r = snapFurnitureMove(it1, 44, 150, board([room]), 3)
    // left edge -6 is 6 cm off the wall: no snap, plain rounding (Y still snaps to the neighbour wall row)
    expect(r.snappedX).toBe(false)
    expect(r.xCm).toBe(44)
  })

  it('ignores the item itself when it is already in the artboard', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150 })
    const r = snapFurnitureMove(it1, 203, 153, board([], [it1]), 10)
    expect(r).toEqual({ xCm: 203, yCm: 153, snappedX: false, snappedY: false })
  })
})

// ---------- distance guides ----------

describe('computeDistanceGuides', () => {
  const room = rect('r', 0, 0, 400, 300)

  it('measures the 4 walls around a centred item', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150, widthCm: 100, depthCm: 60 })
    const guides = computeDistanceGuides(it1, board([room]))
    expect(guides).toHaveLength(4)
    const left = guides.find((g) => g.axis === 'x' && g.x2 < g.x1)!
    const right = guides.find((g) => g.axis === 'x' && g.x2 > g.x1)!
    const up = guides.find((g) => g.axis === 'y' && g.y2 < g.y1)!
    const down = guides.find((g) => g.axis === 'y' && g.y2 > g.y1)!
    expect(left).toMatchObject({ x1: 150, x2: 0, y1: 150, y2: 150, distCm: 150 })
    expect(right).toMatchObject({ x1: 250, x2: 400, y1: 150, y2: 150, distCm: 150 })
    expect(up).toMatchObject({ y1: 120, y2: 0, x1: 200, x2: 200, distCm: 120 })
    expect(down).toMatchObject({ y1: 180, y2: 300, x1: 200, x2: 200, distCm: 120 })
  })

  it('uses the nearest wall and rounds to the precision', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150, widthCm: 101, depthCm: 61 })
    const guides = computeDistanceGuides(it1, board([room], [], 1))
    const left = guides.find((g) => g.axis === 'x' && g.x2 < g.x1)!
    // left edge 149.5 -> 149.5 cm to the wall, rounded to 1 cm precision
    expect(left.x1).toBeCloseTo(149.5)
    expect(left.distCm).toBeCloseTo(150)
  })

  it('omits directions farther than maxDistCm and hits at the edge itself', () => {
    const it1 = item({ id: 'f1', xCm: 200, yCm: 150, widthCm: 100, depthCm: 60 })
    expect(computeDistanceGuides(it1, board([room]), 100)).toHaveLength(0)
    const two = computeDistanceGuides(it1, board([room]), 130)
    expect(two.filter((g) => g.axis === 'y')).toHaveLength(2)
    expect(two.filter((g) => g.axis === 'x')).toHaveLength(0)
    expect(DEFAULT_MAX_GUIDE_DIST_CM).toBe(600)

    // An item flush with the left wall has no left guide (the ray starts on the wall).
    const flush = item({ id: 'f2', xCm: 50, yCm: 150, widthCm: 100, depthCm: 60 })
    const g = computeDistanceGuides(flush, board([room]))
    expect(g.some((x) => x.axis === 'x' && x.x2 < x.x1)).toBe(false)
    expect(g.filter((x) => x.axis === 'x')).toHaveLength(1)
  })

  it('has no guides without rooms', () => {
    expect(computeDistanceGuides(item(), board([]))).toEqual([])
  })
})

// ---------- store actions ----------

describe('addFurniture', () => {
  it('adds, clamps the sizes, selects the item and returns the id', () => {
    const artboardId = s().doc.artboards[0].id
    const id = addFurniture(artboardId, { name: 'Sofa', shape: 'rect', xCm: 100, yCm: 80, widthCm: 220, depthCm: 95, rotationDeg: 0, color: '#527362' })
    expect(id.length).toBeGreaterThan(0)
    const f = s().doc.artboards[0].furniture
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ id, name: 'Sofa', xCm: 100, yCm: 80, widthCm: 220, depthCm: 95 })
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId, furnitureId: id })
    expect(ui().activeArtboardId).toBe(artboardId)
  })

  it('clamps width and depth to the furniture limits', () => {
    const artboardId = s().doc.artboards[0].id
    addFurniture(artboardId, { name: 'Tiny', shape: 'rect', xCm: 0, yCm: 0, widthCm: 2, depthCm: 5000, rotationDeg: 0, color: '#4b5563' })
    expect(s().doc.artboards[0].furniture[0].widthCm).toBe(MIN_FURNITURE_CM)
    expect(s().doc.artboards[0].furniture[0].depthCm).toBe(MAX_FURNITURE_CM)
  })

  it('appends at the top by default and inserts at index 0 with position bottom', () => {
    const artboardId = s().doc.artboards[0].id
    const first = addFurniture(artboardId, { name: 'Sofa', shape: 'rect', xCm: 0, yCm: 0, widthCm: 220, depthCm: 95, rotationDeg: 0, color: '#4b5563' })
    const second = addFurniture(artboardId, { name: 'Desk', shape: 'rect', xCm: 0, yCm: 0, widthCm: 140, depthCm: 70, rotationDeg: 0, color: '#4b5563' }, { position: 'top' })
    const rug = addFurniture(artboardId, { name: 'Rug', shape: 'rect', xCm: 0, yCm: 0, widthCm: 200, depthCm: 300, rotationDeg: 0, color: '#4b5563' }, { position: 'bottom' })
    expect(s().doc.artboards[0].furniture.map((f) => f.id)).toEqual([rug, first, second])
    // The new rug is still the selection, so the rest of the card works on it.
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId, furnitureId: rug })
  })

  it('does nothing for an unknown artboard', () => {
    const before = past()
    expect(addFurniture('nope', { name: 'X', shape: 'rect', xCm: 0, yCm: 0, widthCm: 50, depthCm: 50, rotationDeg: 0, color: '#4b5563' })).toBe('')
    expect(s().doc.artboards[0].furniture).toHaveLength(0)
    expect(past()).toBe(before)
  })
})

describe('updateFurniture / updateFurnitureSilent', () => {
  it('patches the item and is one undo step', () => {
    const artboardId = s().doc.artboards[0].id
    const id = addFurniture(artboardId, { name: 'Desk', shape: 'rect', xCm: 0, yCm: 0, widthCm: 140, depthCm: 70, rotationDeg: 0, color: '#4b5563' })
    const before = past()
    updateFurniture(artboardId, id, { xCm: 50, rotationDeg: 90, name: 'Desk 2' })
    expect(past()).toBe(before + 1)
    expect(s().doc.artboards[0].furniture[0]).toMatchObject({ xCm: 50, rotationDeg: 90, name: 'Desk 2' })
  })

  it('the silent variant records no undo step and ignores an unknown item', () => {
    const artboardId = s().doc.artboards[0].id
    const id = addFurniture(artboardId, { name: 'Desk', shape: 'rect', xCm: 0, yCm: 0, widthCm: 140, depthCm: 70, rotationDeg: 0, color: '#4b5563' })
    const before = past()
    updateFurnitureSilent(artboardId, id, { yCm: 33 })
    expect(past()).toBe(before)
    expect(s().doc.artboards[0].furniture[0].yCm).toBe(33)
    updateFurnitureSilent(artboardId, 'nope', { yCm: 99 })
    updateFurniture(artboardId, 'nope', { yCm: 99 })
    expect(past()).toBe(before)
    expect(s().doc.artboards[0].furniture[0].yCm).toBe(33)
  })
})

describe('duplicateFurniture', () => {
  it('clones with a new id, offset, and selects the copy', () => {
    const artboardId = s().doc.artboards[0].id
    const id = addFurniture(artboardId, { name: 'Chair', shape: 'rect', xCm: 100, yCm: 100, widthCm: 85, depthCm: 85, rotationDeg: 0, color: '#4b5563' })
    const copyId = duplicateFurniture(artboardId, id)!
    expect(copyId).not.toBe(id)
    const f = s().doc.artboards[0].furniture
    expect(f).toHaveLength(2)
    expect(f[1]).toMatchObject({ id: copyId, xCm: 120, yCm: 120, name: 'Chair' })
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId, furnitureId: copyId })
  })

  it('puts the copy directly above its source, not on top of every layer', () => {
    const artboardId = s().doc.artboards[0].id
    const ids = ['A', 'B', 'C'].map((name) =>
      addFurniture(artboardId, { name, shape: 'rect', xCm: 0, yCm: 0, widthCm: 85, depthCm: 85, rotationDeg: 0, color: '#4b5563' }),
    )
    const copyId = duplicateFurniture(artboardId, ids[0])!
    expect(s().doc.artboards[0].furniture.map((f) => f.id)).toEqual([ids[0], copyId, ids[1], ids[2]])
  })

  it('honours a custom offset and returns null for an unknown item', () => {
    const artboardId = s().doc.artboards[0].id
    const id = addFurniture(artboardId, { name: 'Chair', shape: 'rect', xCm: 0, yCm: 0, widthCm: 85, depthCm: 85, rotationDeg: 0, color: '#4b5563' })
    duplicateFurniture(artboardId, id, -30)
    expect(s().doc.artboards[0].furniture[1]).toMatchObject({ xCm: -30, yCm: -30 })
    expect(duplicateFurniture(artboardId, 'nope')).toBeNull()
    expect(duplicateFurniture('nope', id)).toBeNull()
  })
})

describe('Alt-drag duplicate', () => {
  it('a drag that duplicates and moves the copy is one undo step', () => {
    const artboardId = s().doc.artboards[0].id
    const id = addFurniture(artboardId, { name: 'Sofa', shape: 'rect', xCm: 100, yCm: 100, widthCm: 220, depthCm: 95, rotationDeg: 0, color: '#4b5563' })
    const before = past()
    // Same sequence as FurnitureLayer: beginDrag, push the copy silently, move it silently, endDrag.
    s().beginDrag()
    s().updateSilent((d) => {
      const src = d.artboards[0].furniture.find((f) => f.id === id)!
      d.artboards[0].furniture.push({ ...src, id: 'copy' })
    })
    for (let i = 1; i <= 5; i++) updateFurnitureSilent(artboardId, 'copy', { xCm: 100 + i * 10, yCm: 100 + i * 10 })
    expect(past()).toBe(before)
    s().endDrag()
    expect(past()).toBe(before + 1)
    expect(s().doc.artboards[0].furniture).toHaveLength(2)
    expect(s().doc.artboards[0].furniture[1]).toMatchObject({ id: 'copy', xCm: 150, yCm: 150 })
    s().undo()
    expect(s().doc.artboards[0].furniture).toHaveLength(1)
    expect(s().doc.artboards[0].furniture[0]).toMatchObject({ id, xCm: 100, yCm: 100 })
  })
})

describe('deleteFurniture', () => {
  it('removes the item and clears its selection', () => {
    const artboardId = s().doc.artboards[0].id
    const id = addFurniture(artboardId, { name: 'Bed', shape: 'rect', xCm: 0, yCm: 0, widthCm: 160, depthCm: 200, rotationDeg: 0, color: '#4b5563' })
    expect(ui().selection.kind).toBe('furniture')
    deleteFurniture(artboardId, id)
    expect(s().doc.artboards[0].furniture).toHaveLength(0)
    expect(ui().selection).toEqual({ kind: 'none' })
  })

  it('keeps an unrelated selection and ignores an unknown item', () => {
    const artboardId = s().doc.artboards[0].id
    const id = addFurniture(artboardId, { name: 'Bed', shape: 'rect', xCm: 0, yCm: 0, widthCm: 160, depthCm: 200, rotationDeg: 0, color: '#4b5563' })
    ui().set({ selection: { kind: 'artboard', artboardId } })
    deleteFurniture(artboardId, id)
    expect(ui().selection).toEqual({ kind: 'artboard', artboardId })
    const before = past()
    deleteFurniture(artboardId, id)
    expect(past()).toBe(before)
  })
})

describe('reorderFurniture', () => {
  /** Three items a, b, c in one artboard (a = bottom, c = top). */
  const stack = () => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => {
      d.artboards[0].furniture.push(
        item({ id: 'a', yCm: 10 }), item({ id: 'b', yCm: 20 }), item({ id: 'c', yCm: 30 }),
      )
    })
    return artboardId
  }
  const order = () => s().doc.artboards[0].furniture.map((f) => f.id)

  it('back sends the item to index 0 and front to the last index', () => {
    const artboardId = stack()
    expect(reorderFurniture(artboardId, 'c', 'back')).toBe(true)
    expect(order()).toEqual(['c', 'a', 'b'])
    expect(reorderFurniture(artboardId, 'c', 'front')).toBe(true)
    expect(order()).toEqual(['a', 'b', 'c'])
  })

  it('backward and forward move one step', () => {
    const artboardId = stack()
    expect(reorderFurniture(artboardId, 'b', 'backward')).toBe(true)
    expect(order()).toEqual(['b', 'a', 'c'])
    expect(reorderFurniture(artboardId, 'b', 'forward')).toBe(true)
    expect(order()).toEqual(['a', 'b', 'c'])
  })

  it('is a no-op without an undo step at the ends and for unknown ids', () => {
    const artboardId = stack()
    const before = past()
    expect(reorderFurniture(artboardId, 'a', 'back')).toBe(false)
    expect(reorderFurniture(artboardId, 'a', 'backward')).toBe(false)
    expect(reorderFurniture(artboardId, 'c', 'front')).toBe(false)
    expect(reorderFurniture(artboardId, 'c', 'forward')).toBe(false)
    expect(reorderFurniture(artboardId, 'nope', 'forward')).toBe(false)
    expect(reorderFurniture('nope', 'a', 'front')).toBe(false)
    expect(order()).toEqual(['a', 'b', 'c'])
    expect(past()).toBe(before)
  })

  it('records one undo step and restores the old order on undo / redo', () => {
    const artboardId = stack()
    const before = past()
    expect(reorderFurniture(artboardId, 'a', 'front')).toBe(true)
    expect(past()).toBe(before + 1)
    expect(order()).toEqual(['b', 'c', 'a'])
    s().undo()
    expect(order()).toEqual(['a', 'b', 'c'])
    s().redo()
    expect(order()).toEqual(['b', 'c', 'a'])
    // The items themselves keep their fields.
    expect(s().doc.artboards[0].furniture.map((f) => f.yCm)).toEqual([20, 30, 10])
  })
})

describe('setRoomFill', () => {
  it('sets and clears the floor fill of one room', () => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => { d.artboards[0].rooms.push(rect('r1', 0, 0, 400, 300), rect('r2', 0, 0, 100, 100)) })
    setRoomFill(artboardId, 'r1', '#8a6b4a')
    expect(s().doc.artboards[0].rooms[0].fill).toBe('#8a6b4a')
    expect(s().doc.artboards[0].rooms[1].fill).toBeUndefined()
    setRoomFill(artboardId, 'r1', undefined)
    expect(s().doc.artboards[0].rooms[0].fill).toBeUndefined()
    const before = past()
    setRoomFill(artboardId, 'nope', '#fff')
    setRoomFill('nope', 'r1', '#fff')
    expect(past()).toBe(before)
  })

  it('accepts every non-empty floor swatch colour', () => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => { d.artboards[0].rooms.push(rect('r1', 0, 0, 400, 300)) })
    for (const sw of FLOOR_SWATCHES) {
      setRoomFill(artboardId, 'r1', sw.color)
      expect(s().doc.artboards[0].rooms[0].fill).toBe(sw.color)
    }
  })
})

describe('setRoomFloorPattern', () => {
  it('sets a pattern, stores nothing for solid/undefined, and undoes', () => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => { d.artboards[0].rooms.push(rect('r1', 0, 0, 400, 300)) })
    setRoomFloorPattern(artboardId, 'r1', 'wood')
    expect(s().doc.artboards[0].rooms[0].floorPattern).toBe('wood')
    setRoomFloorPattern(artboardId, 'r1', 'solid')
    expect('floorPattern' in s().doc.artboards[0].rooms[0]).toBe(false)
    setRoomFloorPattern(artboardId, 'r1', 'tile')
    setRoomFloorPattern(artboardId, 'r1', undefined)
    expect('floorPattern' in s().doc.artboards[0].rooms[0]).toBe(false)
    useDoc.temporal.getState().undo()
    expect(s().doc.artboards[0].rooms[0].floorPattern).toBe('tile')
    useDoc.temporal.getState().redo()
    expect(s().doc.artboards[0].rooms[0].floorPattern).toBeUndefined()
    const before = past()
    setRoomFloorPattern(artboardId, 'nope', 'wood')
    expect(past()).toBe(before)
  })
})

describe('setRoomsFill', () => {
  /** Two rooms, r1 and r2, on the first artboard. */
  const twoRooms = (): string => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => { d.artboards[0].rooms.push(rect('r1', 0, 0, 400, 300), rect('r2', 0, 0, 100, 100)) })
    return artboardId
  }
  const fills = () => s().doc.artboards[0].rooms.map((r) => r.fill)

  it('paints two rooms in one undo step, and one undo restores both', () => {
    const artboardId = twoRooms()
    const before = past()
    setRoomsFill(artboardId, ['r1', 'r2'], '#8a6b4a')
    expect(fills()).toEqual(['#8a6b4a', '#8a6b4a'])
    expect(past()).toBe(before + 1)
    s().undo()
    expect(fills()).toEqual([undefined, undefined])
    s().redo()
    expect(fills()).toEqual(['#8a6b4a', '#8a6b4a'])
  })

  it('clears the fill of every room with undefined', () => {
    const artboardId = twoRooms()
    setRoomsFill(artboardId, ['r1', 'r2'], '#8a6b4a')
    setRoomsFill(artboardId, ['r1', 'r2'], undefined)
    expect(fills()).toEqual([undefined, undefined])
    expect('fill' in s().doc.artboards[0].rooms[0]).toBe(false)
  })

  it('skips unknown ids and only touches the rooms it knows', () => {
    const artboardId = twoRooms()
    setRoomsFill(artboardId, ['nope', 'r2'], '#fff')
    expect(fills()).toEqual([undefined, '#fff'])
    const before = past()
    setRoomsFill(artboardId, ['nope'], '#fff')
    setRoomsFill('nope', ['r1', 'r2'], '#fff')
    expect(past()).toBe(before)
    expect(fills()).toEqual([undefined, '#fff'])
  })
})

describe('setRoomsFloorPattern', () => {
  const twoRooms = (): string => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => { d.artboards[0].rooms.push(rect('r1', 0, 0, 400, 300), rect('r2', 0, 0, 100, 100)) })
    return artboardId
  }
  const patterns = () => s().doc.artboards[0].rooms.map((r) => r.floorPattern)

  it('sets a pattern on two rooms in one undo step, and solid/undefined store nothing', () => {
    const artboardId = twoRooms()
    const before = past()
    setRoomsFloorPattern(artboardId, ['r1', 'r2'], 'wood')
    expect(patterns()).toEqual(['wood', 'wood'])
    expect(past()).toBe(before + 1)
    s().undo()
    expect(patterns()).toEqual([undefined, undefined])
    setRoomsFloorPattern(artboardId, ['r1', 'r2'], 'wood')
    setRoomsFloorPattern(artboardId, ['r1', 'r2'], 'solid')
    expect('floorPattern' in s().doc.artboards[0].rooms[0]).toBe(false)
    expect('floorPattern' in s().doc.artboards[0].rooms[1]).toBe(false)
    setRoomsFloorPattern(artboardId, ['r1', 'r2'], 'tile')
    setRoomsFloorPattern(artboardId, ['r1', 'r2'], undefined)
    expect('floorPattern' in s().doc.artboards[0].rooms[1]).toBe(false)
  })

  it('skips unknown ids and an unknown artboard', () => {
    const artboardId = twoRooms()
    setRoomsFloorPattern(artboardId, ['r1', 'nope'], 'tile')
    expect(patterns()).toEqual(['tile', undefined])
    const before = past()
    setRoomsFloorPattern(artboardId, ['nope'], 'tile')
    setRoomsFloorPattern('nope', ['r1', 'r2'], 'tile')
    expect(past()).toBe(before)
  })
})

describe('setRoomsFloorPatternAngle', () => {
  const twoRooms = (): string => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => { d.artboards[0].rooms.push(rect('r1', 0, 0, 400, 300), rect('r2', 0, 0, 100, 100)) })
    setRoomsFloorPattern(artboardId, ['r1', 'r2'], 'wood')
    return artboardId
  }
  const angles = () => s().doc.artboards[0].rooms.map((r) => r.floorPatternAngleDeg)

  it('normalises the angle for two rooms in one undo step', () => {
    const artboardId = twoRooms()
    const before = past()
    setRoomsFloorPatternAngle(artboardId, ['r1', 'r2'], 370)
    expect(angles()).toEqual([10, 10])
    expect(past()).toBe(before + 1)
    s().undo()
    expect(angles()).toEqual([undefined, undefined])
  })

  it('deletes the key for 0', () => {
    const artboardId = twoRooms()
    setRoomsFloorPatternAngle(artboardId, ['r1', 'r2'], 45)
    expect(angles()).toEqual([45, 45])
    setRoomsFloorPatternAngle(artboardId, ['r1', 'r2'], 0)
    for (const r of s().doc.artboards[0].rooms) expect('floorPatternAngleDeg' in r).toBe(false)
  })

  it('skips unknown ids and an unknown artboard', () => {
    const artboardId = twoRooms()
    setRoomsFloorPatternAngle(artboardId, ['r2', 'nope'], 90)
    expect(angles()).toEqual([undefined, 90])
    const before = past()
    setRoomsFloorPatternAngle(artboardId, ['nope'], 90)
    setRoomsFloorPatternAngle('nope', ['r1', 'r2'], 90)
    expect(past()).toBe(before)
  })
})

describe('setRoomWallColor', () => {
  it('sets, clears, removes the empty map, and undoes', () => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => { d.artboards[0].rooms.push(rect('r1', 0, 0, 400, 300)) })
    setRoomWallColor(artboardId, 'r1', 0, '#b85d43')
    setRoomWallColor(artboardId, 'r1', 2, '#5a7a65')
    expect(s().doc.artboards[0].rooms[0].wallColors).toEqual({ '0': '#b85d43', '2': '#5a7a65' })
    setRoomWallColor(artboardId, 'r1', 0, undefined)
    expect(s().doc.artboards[0].rooms[0].wallColors).toEqual({ '2': '#5a7a65' })
    setRoomWallColor(artboardId, 'r1', 2, undefined)
    expect('wallColors' in s().doc.artboards[0].rooms[0]).toBe(false)
    useDoc.temporal.getState().undo()
    expect(s().doc.artboards[0].rooms[0].wallColors).toEqual({ '2': '#5a7a65' })
    useDoc.temporal.getState().redo()
    expect(s().doc.artboards[0].rooms[0].wallColors).toBeUndefined()
  })
})

describe('undo / redo through the document store', () => {
  it('add, update, duplicate, delete and fill each undo and redo', () => {
    const artboardId = s().doc.artboards[0].id
    s().update((d) => { d.artboards[0].rooms.push(rect('r1', 0, 0, 400, 300)) })
    const id = addFurniture(artboardId, { name: 'Sofa', shape: 'rect', xCm: 100, yCm: 100, widthCm: 220, depthCm: 95, rotationDeg: 0, color: '#4b5563' })
    updateFurniture(artboardId, id, { xCm: 120 })
    duplicateFurniture(artboardId, id)
    setRoomFill(artboardId, 'r1', '#8a6b4a')
    expect(s().doc.artboards[0].furniture).toHaveLength(2)

    s().undo()
    expect(s().doc.artboards[0].rooms[0].fill).toBeUndefined()
    expect(s().doc.artboards[0].furniture).toHaveLength(2)
    s().undo()
    expect(s().doc.artboards[0].furniture).toHaveLength(1)
    s().undo()
    expect(s().doc.artboards[0].furniture[0].xCm).toBe(100)
    s().undo()
    expect(s().doc.artboards[0].furniture).toHaveLength(0)

    s().redo(); s().redo(); s().redo(); s().redo()
    expect(s().doc.artboards[0].furniture).toHaveLength(2)
    expect(s().doc.artboards[0].rooms[0].fill).toBe('#8a6b4a')

    deleteFurniture(artboardId, id)
    s().undo()
    expect(s().doc.artboards[0].furniture).toHaveLength(2)
  })
})
