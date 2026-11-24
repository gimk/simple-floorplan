// Visibility rules of the plan layers, in particular the three-state ones (room codes, wall
// numbers): 'auto' is on in the Solve tab and in Measuring Mode, off elsewhere.
import { describe, expect, it } from 'vitest'
import type { Layers } from '../../model/store'
import {
  BOOLEAN_LAYER_KEYS, MODE_LAYER_KEYS, layerModeOf, layerVisible, modeLayerVisible, setLayerMode, toggleLayer,
} from './layers'

const layers = (over: Partial<Layers> = {}): Layers => ({
  background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true, clashes: true,
  roomCodes: 'auto', wallLabels: 'auto', outsideDims: true,
  ...over,
})

describe('layerVisible', () => {
  it("'on' is visible everywhere", () => {
    expect(layerVisible('on', { tab: 'inspect', mode: 'edit' })).toBe(true)
    expect(layerVisible('on', { tab: 'plan', mode: 'edit' })).toBe(true)
    expect(layerVisible('on', { tab: 'solve', mode: 'measure' })).toBe(true)
  })

  it("'off' is visible nowhere", () => {
    expect(layerVisible('off', { tab: 'solve', mode: 'edit' })).toBe(false)
    expect(layerVisible('off', { tab: 'inspect', mode: 'measure' })).toBe(false)
  })

  it("'auto' is visible in the Solve tab and in Measuring Mode", () => {
    expect(layerVisible('auto', { tab: 'solve', mode: 'edit' })).toBe(true)
    expect(layerVisible('auto', { tab: 'solve', mode: 'measure' })).toBe(true)
    expect(layerVisible('auto', { tab: 'inspect', mode: 'measure' })).toBe(true)
  })

  it("'auto' is hidden on the other tabs in edit mode", () => {
    expect(layerVisible('auto', { tab: 'inspect', mode: 'edit' })).toBe(false)
    expect(layerVisible('auto', { tab: 'plan', mode: 'edit' })).toBe(false)
  })
})

describe('layerModeOf', () => {
  it('reads a missing value (old saved state) as auto', () => {
    expect(layerModeOf(undefined)).toBe('auto')
    expect(layerModeOf(null)).toBe('auto')
  })

  it('keeps on and off', () => {
    expect(layerModeOf('on')).toBe('on')
    expect(layerModeOf('off')).toBe('off')
  })
})

describe('modeLayerVisible', () => {
  it('uses the auto fallback when the layers have no three-state key', () => {
    const old = layers()
    delete (old as Partial<Layers>).roomCodes
    expect(modeLayerVisible(old, 'roomCodes', { tab: 'solve', mode: 'edit' })).toBe(true)
    expect(modeLayerVisible(old, 'roomCodes', { tab: 'inspect', mode: 'edit' })).toBe(false)
  })

  it('follows the state of the layer', () => {
    expect(modeLayerVisible(layers({ wallLabels: 'on' }), 'wallLabels', { tab: 'inspect', mode: 'edit' })).toBe(true)
    expect(modeLayerVisible(layers({ wallLabels: 'off' }), 'wallLabels', { tab: 'solve', mode: 'edit' })).toBe(false)
  })
})

describe('layer key lists', () => {
  it('has seven plain layers and the two three-state ones', () => {
    expect([...BOOLEAN_LAYER_KEYS]).toEqual(['background', 'dimensions', 'bearingHighlight', 'openings', 'notes', 'clashes', 'outsideDims'])
    expect([...MODE_LAYER_KEYS]).toEqual(['roomCodes', 'wallLabels'])
  })
})

describe('layer updates', () => {
  it('toggles one plain layer and keeps the others', () => {
    const next = toggleLayer(layers(), 'notes')
    expect(next.notes).toBe(false)
    expect(next.background).toBe(true)
    expect(next.roomCodes).toBe('auto')
    // A new object: the store sees a change.
    expect(next).not.toBe(layers())
  })

  it('sets one three-state layer and keeps the others', () => {
    const next = setLayerMode(layers(), 'roomCodes', 'off')
    expect(next.roomCodes).toBe('off')
    expect(next.wallLabels).toBe('auto')
    expect(toggleLayer(next, 'notes').roomCodes).toBe('off')
  })
})
