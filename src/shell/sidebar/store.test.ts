import { describe, expect, it } from 'vitest'
import { parseSections, parseTab } from './store'
import { parseOpen } from '../layersPanel'

describe('parseTab', () => {
  it('reads the three known tabs', () => {
    expect(parseTab('inspect')).toBe('inspect')
    expect(parseTab('solve')).toBe('solve')
    expect(parseTab('plan')).toBe('plan')
  })

  it('falls back to inspect for a missing or unknown value', () => {
    expect(parseTab(null)).toBe('inspect')
    expect(parseTab('')).toBe('inspect')
    expect(parseTab('other')).toBe('inspect')
  })

  it('has no Layers tab: an old stored "layers" value gives the default', () => {
    expect(parseTab('layers')).toBe('inspect')
  })
})

describe('parseSections', () => {
  it('returns an empty memory when nothing is stored', () => {
    expect(parseSections(null)).toEqual({})
    expect(parseSections('')).toEqual({})
  })

  it('reads the stored open state of each section', () => {
    expect(parseSections('{"background":true,"layers":false}')).toEqual({ background: true, layers: false })
  })

  it('drops anything that is not a boolean', () => {
    expect(parseSections('{"a":true,"b":"yes","c":1,"d":null}')).toEqual({ a: true })
  })

  it('survives broken JSON and non-objects', () => {
    expect(parseSections('not json')).toEqual({})
    expect(parseSections('[true,false]')).toEqual({})
    expect(parseSections('42')).toEqual({})
    expect(parseSections('null')).toEqual({})
  })
})

describe('layers panel memory', () => {
  it('reads only true / false', () => {
    expect(parseOpen('true')).toBe(true)
    expect(parseOpen('false')).toBe(false)
    expect(parseOpen(null)).toBeNull()
    expect(parseOpen('x')).toBeNull()
  })
})
