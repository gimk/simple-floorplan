// Tests of the pure helpers of the exported measurements: the paper zoom, the text of a value, one
// dimension line, the room tag, and the extent of the outside rows.
import { describe, expect, it } from 'vitest'
import type { Room } from '../../model/types'
import { DIM_STYLE, worldPx } from '../rooms/dims/dimLine'
import { outsideDims } from '../rooms/outside/outsideDims'
import { ensureV2 } from '../../model/v2/ensure'
import { emptyDoc } from '../../model/store'
import { faceText, paperZoom, roomTagLayout, segmentText, outsideExtentPoints, dimSvg } from './svgDims'
import { dimLine } from '../rooms/dims/dimLine'

const room = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'SE', name: 'Living', walkOrder: 1, holes: [], walls: {}, ceilingCm: 250,
  vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 422, y: 0 }, { id: 'c', x: 422, y: 312 }, { id: 'd', x: 0, y: 312 }],
  ...over,
})

const TAG = { code: true, name: true, area: true, perimeter: true, ceiling: true, progress: true, areaDecimals: 2 } as const

describe('paperZoom', () => {
  it('makes the dimension text of the plan (px 11) the size of the export text (fs * 0.75)', () => {
    for (const fs of [8, 12.5, 30]) {
      const zoom = paperZoom(fs)
      expect(worldPx(DIM_STYLE.font, zoom)).toBeCloseTo(fs * 0.75, 6)
    }
  })

  it('gives a readable size to the other sizes of the style', () => {
    const zoom = paperZoom(10) // 1 cm = 1,47 px on the paper
    expect(worldPx(DIM_STYLE.tickLength, zoom)).toBeCloseTo(5.45, 2)
    expect(worldPx(DIM_STYLE.minLine, zoom)).toBeCloseTo(8.18, 2)
  })
})

describe('faceText', () => {
  const base = { solvedCm: 412, step: 0.5, units: { unit: 'cm' as const, decimals: 1 as const } }

  it('writes the calculated length in the units of the plan, with no ✓', () => {
    expect(faceText(base)).toEqual({ value: '412', label: undefined, measured: false })
    expect(faceText({ ...base, units: { unit: 'm', decimals: 2 } }).value).toBe('4,12')
    expect(faceText({ ...base, units: { unit: 'mm', decimals: 0 } }).value).toBe('4120')
  })

  it('writes a measured length in green with ✓ (and the solved value when they differ)', () => {
    expect(faceText({ ...base, measuredCm: 412 })).toEqual({ value: '✓ 412', label: undefined, measured: true })
    expect(faceText({ ...base, measuredCm: 414 }).value).toBe('✓ 414 · 412')
    expect(faceText({ ...base, measuredCm: 414, units: { unit: 'm', decimals: 2 } }).value).toBe('✓ 4,14 · 4,12')
  })

  it('keeps the survey label in front of the value', () => {
    expect(faceText({ ...base, label: 'SE-2' }).label).toBe('SE-2')
  })
})

describe('segmentText', () => {
  it('writes the measured value of a facade when the survey has one', () => {
    const seg = { a: { x: 0, y: 0 }, b: { x: 432, y: 0 }, lengthCm: 432, label: 'W1-E', measuredCm: 430 }
    expect(segmentText(seg, 0.5, { unit: 'cm', decimals: 1 })).toEqual({ value: '✓ 430 · 432', measured: true })
    expect(segmentText({ ...seg, measuredCm: null }, 0.5, { unit: 'm', decimals: 2 })).toEqual({ value: '4,32', measured: false })
  })
})

describe('dimSvg', () => {
  it('writes the line, the two ticks and the text with a white halo', () => {
    const zoom = paperZoom(10)
    const line = dimLine({ start: { x: 0, y: 0 }, end: { x: 412, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 6, zoom, text: 'SE-1 412' })!
    const svg = dimSvg({ line, text: { value: '412', label: 'SE-1', measured: false }, dimKey: 'SE-1', kind: 'wall', fs: 10, zoom })
    expect(svg).toContain('data-dim-line="wall"')
    expect(svg).toContain('data-dim-ticks="wall"')
    expect(svg).toContain('stroke="#475569"')
    expect(svg).toContain('stroke="#ffffff"')
    expect(svg).toContain('<tspan font-size="6.2" fill="#94a3b8" font-weight="400">SE-1</tspan> 412')
    expect(svg).toContain('data-dim="SE-1"')
    // The text fits between the ticks: no "outside" marker.
    expect(svg).not.toContain('data-dim-outside')
  })

  it('marks a text that went past the end of the line', () => {
    const zoom = paperZoom(10)
    const text = 'SE-1 ✓ 412 · 410,7'
    const line = dimLine({ start: { x: 0, y: 0 }, end: { x: 30, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 6, zoom, text })!
    expect(line.outside).toBe(true)
    const svg = dimSvg({ line, text: { value: '✓ 412 · 410,7', label: 'SE-1', measured: true }, dimKey: 'SE-1', kind: 'wall', fs: 10, zoom })
    expect(svg).toContain('data-dim-outside')
    expect(svg).toContain('fill="#15803d" font-weight="600"')
  })
})

describe('roomTagLayout', () => {
  const ctx = { zoom: paperZoom(10), fs: 10, measurements: {}, defaultCeilingCm: undefined }

  it('writes the title and the rows the user chose', () => {
    const { svg } = roomTagLayout(room(), TAG, ctx)
    expect(svg).toContain('data-room-code-text="SE"')
    expect(svg).toContain('Living')
    expect(svg).toContain('12,44 m²') // 412 x 302 cm inside
    expect(svg).toContain('P 14,28 m')
    expect(svg).toContain('H 2,50 m')
    // No survey value in this document: the progress row is there, at 0 of 4 walls.
    expect(svg).toContain('0/4 walls')
  })

  it('uses the height of the apartment when the room has none', () => {
    const { svg } = roomTagLayout(room({ ceilingCm: undefined }), TAG, { ...ctx, defaultCeilingCm: 260 })
    expect(svg).toContain('H 2,60 m')
  })

  it('shows the code alone in a very small room', () => {
    const tiny = room({ vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 20, y: 20 }, { id: 'd', x: 0, y: 20 }] })
    const { svg } = roomTagLayout(tiny, TAG, ctx)
    expect(svg).toContain('data-room-code-only="r1"')
    expect(svg).not.toContain('data-room-tag-row')
  })
})

describe('outsideExtentPoints', () => {
  it('reaches past the outside rows, so the viewBox has to grow', () => {
    const doc = ensureV2({ ...emptyDoc(), rooms: [room()] })
    const runs = outsideDims(doc)
    expect(runs.length).toBe(4)
    const zoom = paperZoom(10)
    const pts = outsideExtentPoints(runs, zoom)
    expect(pts.length).toBeGreaterThan(0)
    // The top run goes UP (y points down): its rows are above the plan.
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(-30)
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(422)
  })
})
