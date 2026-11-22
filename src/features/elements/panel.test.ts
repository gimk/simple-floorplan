import { describe, expect, it } from 'vitest'
import {
  ELEMENT_FIELD_NAMES, depthDefault, elementPanelTitle, hasDepth, overflowWarning, showsHeight,
} from './panel'

describe('elementPanelTitle', () => {
  it('names the kind, the wall and its length', () => {
    expect(elementPanelTitle('door', 'SE-2', 580)).toBe('Door · wall SE-2 (580 cm)')
  })

  it('writes the length with a French comma', () => {
    expect(elementPanelTitle('window', 'CU-1', 412.5)).toBe('Window · wall CU-1 (412,5 cm)')
  })

  it('drops the length when the wall is unknown', () => {
    expect(elementPanelTitle('radiator', '?')).toBe('Radiator · wall ?')
  })
})

describe('showsHeight', () => {
  it('hides the height field for "other" only', () => {
    expect(showsHeight('other')).toBe(false)
    for (const kind of ['door', 'window', 'opening', 'cupboard', 'radiator'] as const) {
      expect(showsHeight(kind)).toBe(true)
    }
  })
})

describe('hasDepth and depthDefault', () => {
  it('gives a depth to cupboards and radiators only', () => {
    expect(hasDepth('cupboard')).toBe(true)
    expect(hasDepth('radiator')).toBe(true)
    expect(hasDepth('door')).toBe(false)
    expect(hasDepth('window')).toBe(false)
    expect(hasDepth('opening')).toBe(false)
    expect(hasDepth('other')).toBe(false)
  })

  it('defaults to 10 cm for a radiator and 60 cm otherwise', () => {
    expect(depthDefault('radiator')).toBe(10)
    expect(depthDefault('cupboard')).toBe(60)
  })
})

describe('overflowWarning', () => {
  it('repeats the wall length with a comma', () => {
    expect(overflowWarning(580)).toBe('Offset + width is longer than the wall (580 cm).')
    expect(overflowWarning(580.5)).toBe('Offset + width is longer than the wall (580,5 cm).')
  })
})

describe('ELEMENT_FIELD_NAMES', () => {
  it('keeps the names of the pre-migration inputs', () => {
    expect(ELEMENT_FIELD_NAMES).toEqual({
      kind: 'elementKind',
      variant: 'elementVariant',
      width: 'width-cm-',
      height: 'height-cm-',
      sill: 'sill-cm-',
      depth: 'depth-cm-',
      offsetStart: 'from-start-corner-cm-',
      offsetEnd: 'from-end-corner-cm-',
      hinge: 'elementHinge',
      swing: 'elementSwing',
      note: 'elementNote',
    })
  })
})
