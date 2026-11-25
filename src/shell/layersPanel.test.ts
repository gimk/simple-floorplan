import { describe, expect, it } from 'vitest'
import { LAYERS_DEFAULT_W, LAYERS_MAX_W, LAYERS_MIN_W, clampWidth, parseOpen, parseWidth } from './layersPanel'

describe('clampWidth', () => {
  it('keeps a width inside the limits', () => {
    expect(clampWidth(300)).toBe(300)
    expect(clampWidth(LAYERS_MIN_W)).toBe(200)
    expect(clampWidth(LAYERS_MAX_W)).toBe(480)
  })

  it('stops a too narrow or too wide width at the limits', () => {
    expect(clampWidth(0)).toBe(LAYERS_MIN_W)
    expect(clampWidth(-500)).toBe(LAYERS_MIN_W)
    expect(clampWidth(19)).toBe(LAYERS_MIN_W)
    expect(clampWidth(481)).toBe(LAYERS_MAX_W)
    expect(clampWidth(10000)).toBe(LAYERS_MAX_W)
  })

  it('rounds a half pixel and falls back to the default for a broken value', () => {
    expect(clampWidth(260.4)).toBe(260)
    expect(clampWidth(260.6)).toBe(261)
    expect(clampWidth(Number.NaN)).toBe(LAYERS_DEFAULT_W)
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(LAYERS_DEFAULT_W)
  })
})

describe('parseWidth', () => {
  it('reads a stored width, clamped', () => {
    expect(parseWidth('320')).toBe(320)
    expect(parseWidth('120')).toBe(LAYERS_MIN_W)
    expect(parseWidth('9999')).toBe(LAYERS_MAX_W)
  })

  it('gives null when there is nothing usable', () => {
    expect(parseWidth(null)).toBeNull()
    expect(parseWidth('')).toBeNull()
    expect(parseWidth('wide')).toBeNull()
  })
})

describe('parseOpen', () => {
  it('reads the stored open state', () => {
    expect(parseOpen('true')).toBe(true)
    expect(parseOpen('false')).toBe(false)
    expect(parseOpen(null)).toBeNull()
    expect(parseOpen('yes')).toBeNull()
  })
})
