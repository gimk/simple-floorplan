import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FloorPattern, Room } from '../../model/types'
import { setRoomFloorPattern, setRoomFloorPatternAngle } from '../furniture/actions'
import {
  DESIGN_FLOOR_BASE, DESIGN_FLOOR_TINT_OPACITY, PATTERN_DEFS, PLAN_FLOOR_OPACITY, isPatterned, patternSvg, patternTransformOf,
} from './floorPatterns'

const IDS = ['wood', 'parquet', 'tile', 'stone', 'carpet'] as const

/** Every opening tag has a closing one, and tags are balanced. */
function balanced(svg: string): boolean {
  const stack: string[] = []
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, name, , selfClose] = m
    if (selfClose) continue
    if (close) {
      if (stack.pop() !== name) return false
    } else stack.push(name)
  }
  return stack.length === 0
}

describe('constants', () => {
  it('has the Design and Plan floor constants', () => {
    expect(DESIGN_FLOOR_BASE).toBe('#161b21')
    expect(DESIGN_FLOOR_TINT_OPACITY).toBe(0.42)
    expect(PLAN_FLOOR_OPACITY).toBe(0.28)
  })
})

describe('PATTERN_DEFS', () => {
  it('defines the 5 patterns with positive sizes', () => {
    expect(Object.keys(PATTERN_DEFS).sort()).toEqual([...IDS].sort())
    for (const id of IDS) {
      expect(PATTERN_DEFS[id].w).toBeGreaterThan(0)
      expect(PATTERN_DEFS[id].h).toBeGreaterThan(0)
    }
  })

  it.each(IDS)('%s produces valid, finite SVG markup', (id) => {
    const inner = PATTERN_DEFS[id].inner(1)
    expect(inner.length).toBeGreaterThan(50)
    expect(inner).not.toMatch(/NaN|undefined|Infinity/)
    expect(balanced(inner)).toBe(true)
    const svg = patternSvg('p1', id, '#336699', 1)
    expect(svg.startsWith('<pattern id="p1"')).toBe(true)
    expect(svg.endsWith('</pattern>')).toBe(true)
    expect(svg).toContain('patternUnits="userSpaceOnUse"')
    expect(balanced(svg)).toBe(true)
  })

  it('parquet herringbone covers its 4 x 4 cell tile exactly once (seamless)', () => {
    const inner = PATTERN_DEFS.parquet.inner(1)
    const grid = Array.from({ length: 4 }, () => Array<number>(4).fill(0))
    for (const m of inner.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none"/g)) {
      const [x, y, w, h] = m.slice(1).map((v) => Number(v) / 12)
      for (let cy = 0; cy < 4; cy++) {
        for (let cx = 0; cx < 4; cx++) {
          if (cx >= x && cx + 1 <= x + w && cy >= y && cy + 1 <= y + h) grid[cy][cx]++
        }
      }
    }
    expect(grid.flat().every((n) => n === 1)).toBe(true)
  })
})

describe('patternTransformOf', () => {
  it('returns undefined for no angle', () => {
    expect(patternTransformOf()).toBeUndefined()
    expect(patternTransformOf(0)).toBeUndefined()
    expect(patternTransformOf(NaN)).toBeUndefined()
  })
  it('returns rotate(...) for a non-zero angle', () => {
    expect(patternTransformOf(45)).toBe('rotate(45)')
    expect(patternTransformOf(22.5)).toBe('rotate(22.5)')
  })
})

describe('patternSvg', () => {
  it('works with 4 args: no transform, translucent Plan base', () => {
    const svg = patternSvg('a', 'tile', '#112233', 1)
    expect(svg).not.toContain('patternTransform')
    expect(svg).toContain('fill="#112233" fill-opacity="0.28"')
    expect(svg).not.toContain(DESIGN_FLOOR_BASE)
  })
  it('adds patternTransform for an angle', () => {
    expect(patternSvg('a', 'wood', '#112233', 1, 90)).toContain('patternTransform="rotate(90)"')
    expect(patternSvg('a', 'wood', '#112233', 1, 0)).not.toContain('patternTransform')
  })
  it('uses an opaque base in Design mode', () => {
    const svg = patternSvg('a', 'stone', '#112233', 1, 0, { opaqueBase: true })
    expect(svg).toContain(`fill="${DESIGN_FLOOR_BASE}" />`)
    expect(svg).toContain(`fill-opacity="${DESIGN_FLOOR_TINT_OPACITY}"`)
    expect(svg).not.toContain('fill-opacity="0.28" />')
  })
  it('isPatterned', () => {
    expect(isPatterned('solid')).toBe(false)
    expect(isPatterned(undefined)).toBe(false)
    expect(isPatterned('wood' as FloorPattern)).toBe(true)
  })
})

describe('setRoomFloorPatternAngle', () => {
  const room: Room = {
    id: 'r1', name: 'R',
    vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  }
  let ab: Artboard
  beforeEach(() => {
    useDoc.getState().resetDoc()
    ab = { ...createArtboard('A'), rooms: [room] }
    useDoc.getState().update((d) => { d.artboards.push(ab) })
    setRoomFloorPattern(ab.id, 'r1', 'wood')
  })
  const angle = () => useDoc.getState().doc.artboards.find((a) => a.id === ab.id)!.rooms[0].floorPatternAngleDeg

  it('stores a plain angle', () => {
    setRoomFloorPatternAngle(ab.id, 'r1', 45)
    expect(angle()).toBe(45)
  })
  it('normalises into [0, 360)', () => {
    setRoomFloorPatternAngle(ab.id, 'r1', 450)
    expect(angle()).toBe(90)
    setRoomFloorPatternAngle(ab.id, 'r1', -90)
    expect(angle()).toBe(270)
    setRoomFloorPatternAngle(ab.id, 'r1', 22.54)
    expect(angle()).toBe(22.5)
  })
  it('deletes the key for 0, 360 and undefined', () => {
    for (const v of [0, 360, undefined]) {
      setRoomFloorPatternAngle(ab.id, 'r1', 30)
      setRoomFloorPatternAngle(ab.id, 'r1', v)
      const r = useDoc.getState().doc.artboards.find((a) => a.id === ab.id)!.rooms[0]
      expect('floorPatternAngleDeg' in r).toBe(false)
    }
  })
  it('ignores unknown rooms', () => {
    setRoomFloorPatternAngle(ab.id, 'nope', 45)
    expect(angle()).toBeUndefined()
  })
})
