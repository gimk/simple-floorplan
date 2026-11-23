import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEASURE_SOURCE,
  MEASURE_SOURCES,
  MEASURE_SOURCE_LABELS,
  SOURCE_SIGMA_CM,
  sourceSigmaCm,
  sourceTag,
} from './measureSource'

describe('measureSource', () => {
  it('gives a sigma per source', () => {
    expect(SOURCE_SIGMA_CM).toEqual({ laser: 0.3, tape: 1, plan: 3, other: 2 })
  })

  it('treats a missing source as tape', () => {
    expect(DEFAULT_MEASURE_SOURCE).toBe('tape')
    expect(sourceSigmaCm()).toBe(1)
    expect(sourceSigmaCm(undefined)).toBe(1)
    expect(sourceSigmaCm('tape')).toBe(1)
  })

  it('returns the sigma of the given source', () => {
    expect(sourceSigmaCm('laser')).toBe(0.3)
    expect(sourceSigmaCm('plan')).toBe(3)
    expect(sourceSigmaCm('other')).toBe(2)
  })

  it('orders a laser value before a tape value, and a tape value before a plan value', () => {
    expect(sourceSigmaCm('laser')).toBeLessThan(sourceSigmaCm('tape'))
    expect(sourceSigmaCm('tape')).toBeLessThan(sourceSigmaCm('other'))
    expect(sourceSigmaCm('other')).toBeLessThan(sourceSigmaCm('plan'))
  })

  it('labels every source and lists them in picker order', () => {
    expect(MEASURE_SOURCE_LABELS).toEqual({ tape: 'Tape', laser: 'Laser', plan: 'Plan', other: 'Other' })
    expect([...MEASURE_SOURCES]).toEqual(['tape', 'laser', 'plan', 'other'])
  })

  it('shows a tag for laser and plan only', () => {
    expect(sourceTag('laser')).toBe('L')
    expect(sourceTag('plan')).toBe('P')
    expect(sourceTag('tape')).toBeNull()
    expect(sourceTag('other')).toBeNull()
    expect(sourceTag(undefined)).toBeNull()
  })
})
