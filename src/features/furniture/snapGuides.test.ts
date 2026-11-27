// Tests for Shift axis-lock, smart-guide snapping (single & group, items & walls), and item/wall distance guides.
import { describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import type { Artboard, FurnitureItem, Room } from '../../model/types'
import { applyAxisLock, furnitureAxisBounds } from './geometry'
import { computeDragDistanceGuides, snapBoxMove } from './snapGuides'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1',
  name: 'Sofa',
  shape: 'rect',
  xCm: 100,
  yCm: 100,
  widthCm: 100,
  depthCm: 50,
  rotationDeg: 0,
  color: '#4b5563',
  ...p,
})

const board = (rooms: Room[] = [], furniture: FurnitureItem[] = [], precisionCm: Artboard['precisionCm'] = 1): Artboard => ({
  ...createArtboard('Plan A'),
  id: 'ab1',
  precisionCm,
  rooms,
  furniture,
})

const rectRoom = (x1: number, y1: number, x2: number, y2: number): Room => ({
  id: 'r1',
  name: 'Room',
  vertices: [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ],
})

describe('applyAxisLock', () => {
  it('returns current position unchanged when lock is false', () => {
    expect(applyAxisLock({ x: 100, y: 100 }, { x: 140, y: 115 }, false)).toEqual({
      pos: { x: 140, y: 115 },
      lockedAxis: null,
    })
  })

  it('locks to the axis with larger movement since drag start and re-evaluates dynamically', () => {
    const start = { x: 100, y: 100 }
    expect(applyAxisLock(start, { x: 150, y: 120 }, true)).toEqual({
      pos: { x: 150, y: 100 },
      lockedAxis: 'y',
    })
    expect(applyAxisLock(start, { x: 110, y: 160 }, true)).toEqual({
      pos: { x: 100, y: 160 },
      lockedAxis: 'x',
    })
    // Releasing Shift returns free position
    expect(applyAxisLock(start, { x: 110, y: 160 }, false)).toEqual({
      pos: { x: 110, y: 160 },
      lockedAxis: null,
    })
  })
})

describe('snapBoxMove', () => {
  it('snaps left/center/right and top/middle/bottom to other items and emits guide lines', () => {
    // Target item: x 300..400 (center 350), y 200..250 (center 225)
    const target = item({ id: 'other', xCm: 350, yCm: 225, widthCm: 100, depthCm: 50 })
    const dragged = item({ id: 'drag', xCm: 100, yCm: 100, widthCm: 80, depthCm: 40 })
    // Move dragged so its right edge (xCm + 40) is 297 (3 cm from target.minX = 300)
    // and its top edge (yCm - 20) is 197 (3 cm from target.minY = 200).
    const box = furnitureAxisBounds({ ...dragged, xCm: 257, yCm: 217 })
    const res = snapBoxMove(box, board([], [target, dragged]), new Set(['drag']), 6)

    expect(res.snappedX).toBe(true)
    expect(res.snappedY).toBe(true)
    expect(res.dx).toBeCloseTo(3, 5)
    expect(res.dy).toBeCloseTo(3, 5)
    expect(res.snapLines).toEqual([
      { axis: 'x', coord: 300, from: 200, to: 250 },
      { axis: 'y', coord: 200, from: 220, to: 400 },
    ])
  })

  it('snaps a group box while excluding all group members', () => {
    const g1 = item({ id: 'g1', xCm: 100, yCm: 100, widthCm: 40, depthCm: 40 })
    const g2 = item({ id: 'g2', xCm: 160, yCm: 100, widthCm: 40, depthCm: 40 })
    const other = item({ id: 'other', xCm: 300, yCm: 300, widthCm: 100, depthCm: 40 })
    // Group box at target: x 198..298 (center 248), y 298..338 (center 318).
    // Center X 248 is within 6 cm of other.minX (250) -> dx = +2;
    // Top Y 298 is within 6 cm of other.centerY (300) -> dy = +2.
    const groupBox = { minX: 198, minY: 298, maxX: 298, maxY: 338 }
    const res = snapBoxMove(groupBox, board([], [g1, g2, other]), new Set(['g1', 'g2']), 6)

    expect(res.snappedX).toBe(true)
    expect(res.snappedY).toBe(true)
    expect(res.dx).toBeCloseTo(2, 5)
    expect(res.dy).toBeCloseTo(2, 5)
  })

  it('snaps to room walls and emits a wall snap line', () => {
    const room = rectRoom(0, 0, 500, 400)
    const box = { minX: 4, minY: 100, maxX: 84, maxY: 160 }
    const res = snapBoxMove(box, board([room]), new Set(), 6)

    expect(res.snappedX).toBe(true)
    expect(res.dx).toBeCloseTo(-4, 5)
    expect(res.snapLines).toContainEqual({ axis: 'x', coord: 0, from: 0, to: 400 })
  })

  it('disables snapping and guides when Alt (disableSnap) is true', () => {
    const other = item({ id: 'other', xCm: 350, yCm: 225, widthCm: 100, depthCm: 50 })
    const box = { minX: 217, minY: 204, maxX: 297, maxY: 244 }
    const res = snapBoxMove(box, board([], [other]), new Set(), 6, { disableSnap: true })

    expect(res).toEqual({ dx: 0, dy: 0, snappedX: false, snappedY: false, snapLines: [] })
  })

  it('does not snap or move the locked axis when lockAxis is set', () => {
    const other = item({ id: 'other', xCm: 350, yCm: 225, widthCm: 100, depthCm: 50 })
    const box = { minX: 217, minY: 204, maxX: 297, maxY: 244 }
    const res = snapBoxMove(box, board([], [other]), new Set(), 6, { lockAxis: 'y' })

    expect(res.snappedX).toBe(true)
    expect(res.dx).toBeCloseTo(3, 5)
    expect(res.snappedY).toBe(false)
    expect(res.dy).toBe(0)
    expect(res.snapLines.every((l) => l.axis === 'x')).toBe(true)
  })
})

describe('computeDragDistanceGuides', () => {
  it('shows distance in cm to the nearest aligned item on each side, and falls back to walls', () => {
    const room = rectRoom(0, 0, 500, 400)
    // Dragged box: x 200..300, y 150..250
    const draggedBox = { minX: 200, minY: 150, maxX: 300, maxY: 250 }
    // Left item (aligned on Y: 160..240): x 80..150 -> dist 50 cm (closer than left wall at 200 cm)
    const leftNear = item({ id: 'l1', xCm: 115, yCm: 200, widthCm: 70, depthCm: 80 })
    // Further left item: x 20..60 -> ignored because l1 is nearer
    const leftFar = item({ id: 'l2', xCm: 40, yCm: 200, widthCm: 40, depthCm: 80 })
    // Top item NOT aligned on X (x 400..450): ignored -> top falls back to room wall at y=0 (dist 150 cm)
    const topUnaligned = item({ id: 't1', xCm: 425, yCm: 50, widthCm: 50, depthCm: 40 })
    // Bottom item aligned on X (x 220..280): y 300..360 -> dist 50 cm
    const bottomNear = item({ id: 'b1', xCm: 250, yCm: 330, widthCm: 60, depthCm: 60 })

    const guides = computeDragDistanceGuides(
      draggedBox,
      board([room], [leftNear, leftFar, topUnaligned, bottomNear]),
      new Set(),
    )

    expect(guides).toHaveLength(4)
    // Left -> leftNear (50 cm)
    expect(guides).toContainEqual({ axis: 'x', x1: 200, y1: 200, x2: 150, y2: 200, distCm: 50 })
    // Right -> room wall at x=500 (200 cm)
    expect(guides).toContainEqual({ axis: 'x', x1: 300, y1: 200, x2: 500, y2: 200, distCm: 200 })
    // Top -> room wall at y=0 (150 cm)
    expect(guides).toContainEqual({ axis: 'y', x1: 250, y1: 150, x2: 250, y2: 0, distCm: 150 })
    // Bottom -> bottomNear (50 cm)
    expect(guides).toContainEqual({ axis: 'y', x1: 250, y1: 250, x2: 250, y2: 300, distCm: 50 })
  })
})
