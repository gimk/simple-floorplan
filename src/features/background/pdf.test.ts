import { describe, expect, it } from 'vitest'
import { PDF_TARGET_LONGEST_PX, renderScale } from './pdf'

describe('renderScale', () => {
  it('scales a landscape page so its width hits the target', () => {
    expect(renderScale(842, 595)).toBeCloseTo(PDF_TARGET_LONGEST_PX / 842)
  })

  it('scales a portrait page so its height hits the target', () => {
    expect(renderScale(595, 842)).toBeCloseTo(PDF_TARGET_LONGEST_PX / 842)
  })

  it('returns 1 for a degenerate page', () => {
    expect(renderScale(0, 0)).toBe(1)
  })
})
