import { describe, expect, it } from 'vitest'
import * as t from './canvasTokens'

describe('canvasTokens', () => {
  it('keeps the exact hex values that exports and styles depend on', () => {
    expect(t.CANVAS_SELECT).toBe('#fb923c')
    expect(t.CANVAS_SELECT_STRONG).toBe('#f97316')
    expect(t.CANVAS_SELECT_DEEP).toBe('#ea580c')
    expect(t.CANVAS_BG).toBe('#12161b')
    expect(t.CANVAS_HALO).toBe(t.CANVAS_BG)
  })
  it('exports only colour strings', () => {
    for (const v of Object.values(t)) expect(v).toMatch(/^(#[0-9a-f]{3,6}|rgba\()/i)
  })
})
