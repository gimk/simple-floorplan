import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FloorPattern, Room } from '../../model/types'
import { setRoomFloorPattern, setRoomFloorPatternAngle } from '../furniture/actions'
import {
  DESIGN_FLOOR_BASE, DESIGN_FLOOR_TINT_OPACITY, PATTERN_DEFS, PLAN_FLOOR_OPACITY, isPatterned, patternSvg, patternTransformOf,
} from './floorPatterns'

const IDS = ['wood', 'parquet', 'tile', 'stone', 'carpet', 'grass'] as const

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

type Box = { box: [number, number, number, number]; signature: string }

/** Bounding box (x, y, w, h) plus the remaining attributes of every rect, line and dot in a pattern. */
function boxes(inner: string): Box[] {
  const out: Box[] = []
  for (const m of inner.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"([^>]*)>/g))
    out.push({ box: [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])], signature: m[5] })
  for (const m of inner.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"([^>]*)>/g)) {
    const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
    out.push({ box: [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)], signature: m[5] })
  }
  for (const m of inner.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"([^>]*)>/g)) {
    const r = Number(m[3])
    out.push({ box: [Number(m[1]) - r, Number(m[2]) - r, 2 * r, 2 * r], signature: m[4] })
  }
  return out
}

const boxKey = (b: Box): string =>
  `${b.box.map((v) => (Math.round(v * 100) / 100).toFixed(2)).join(',')}|${b.signature}`

const shifted = (b: Box, dx: number, dy: number): Box => ({
  box: [b.box[0] + dx, b.box[1] + dy, b.box[2], b.box[3]],
  signature: b.signature,
})

describe('constants', () => {
  it('has the Design and Plan floor constants', () => {
    expect(DESIGN_FLOOR_BASE).toBe('#161b21')
    expect(DESIGN_FLOOR_TINT_OPACITY).toBe(0.42)
    expect(PLAN_FLOOR_OPACITY).toBe(0.28)
  })
})

describe('PATTERN_DEFS', () => {
  it('defines the 6 patterns with positive sizes', () => {
    expect(Object.keys(PATTERN_DEFS).sort()).toEqual([...IDS].sort())
    for (const id of IDS) {
      expect(PATTERN_DEFS[id].w).toBeGreaterThan(0)
      expect(PATTERN_DEFS[id].h).toBeGreaterThan(0)
    }
  })

  it('uses real product sizes in cm', () => {
    expect(PATTERN_DEFS.wood).toMatchObject({ w: 280, h: 42 })
    expect(PATTERN_DEFS.parquet).toMatchObject({ w: 80, h: 80 })
    expect(PATTERN_DEFS.tile).toMatchObject({ w: 60, h: 60 })
    expect(PATTERN_DEFS.stone).toMatchObject({ w: 90, h: 60 })
    expect(PATTERN_DEFS.carpet).toMatchObject({ w: 12, h: 12 })
    expect(PATTERN_DEFS.grass).toMatchObject({ w: 40, h: 40 })
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

  it('parquet herringbone covers its 80 x 80 tile exactly once (seamless)', () => {
    const { w: tw, h: th } = PATTERN_DEFS.parquet
    const blocks = [...PATTERN_DEFS.parquet.inner(1).matchAll(
      /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none"/g,
    )].map((m) => {
      const [x, y, w, h] = m.slice(1).map(Number)
      return { x, y, w, h }
    })
    expect(blocks.length).toBeGreaterThan(0)
    // Sum of the block areas clipped to the tile = the whole tile, so no gap and no seam.
    const area = blocks.reduce((sum, b) => {
      const cw = Math.max(0, Math.min(b.x + b.w, tw) - Math.max(b.x, 0))
      const ch = Math.max(0, Math.min(b.y + b.h, th) - Math.max(b.y, 0))
      return sum + cw * ch
    }, 0)
    expect(area).toBeCloseTo(tw * th, 6)
    // No two blocks overlap.
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i]
        const b = blocks[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        expect(ox > 0 && oy > 0 ? ox * oy : 0).toBe(0)
      }
    }
  })

  it('grass is deterministic', () => {
    const a = PATTERN_DEFS.grass.inner(1)
    const b = PATTERN_DEFS.grass.inner(1)
    expect(b).toBe(a)
    expect(a.length).toBeGreaterThan(2000)
  })

  it('grass wraps seamlessly: every element that crosses a tile edge has a twin shifted by +-w / +-h', () => {
    const { w, h } = PATTERN_DEFS.grass
    const items = boxes(PATTERN_DEFS.grass.inner(1))
    // 5 tint patches + 150 blades, plus their wrapped copies.
    expect(items.length).toBeGreaterThanOrEqual(155)
    const have = new Set(items.map(boxKey))
    const missing: string[] = []
    for (const b of items) {
      const [x, y, bw, bh] = b.box
      if (x < 0 && !have.has(boxKey(shifted(b, w, 0)))) missing.push(`left edge: ${boxKey(b)}`)
      if (x + bw > w && !have.has(boxKey(shifted(b, -w, 0)))) missing.push(`right edge: ${boxKey(b)}`)
      if (y < 0 && !have.has(boxKey(shifted(b, 0, h)))) missing.push(`top edge: ${boxKey(b)}`)
      if (y + bh > h && !have.has(boxKey(shifted(b, 0, -h)))) missing.push(`bottom edge: ${boxKey(b)}`)
    }
    expect(missing).toEqual([])
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
