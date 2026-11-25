// Tests of the label of a built-in storage on the plan (UI test report
// docs/ui-test-report-storage.md, "Look": on a storage of 100 x 60 cm the wall number badge '3'
// overlapped the end of the small "Storage" label). The label goes at the centre of the inside ring
// of the storage, and it is not drawn when the ring is smaller than the label box plus the band of a
// badge on every side.
import { describe, expect, it } from 'vitest'
import type { Vec } from '../../../model/types'
import { DIM_STYLE } from './dimLine'
import { STORAGE_LABEL, storageLabelCentre, storageLabelFits, storageLabelPlace, storageLabelSize } from './storageLabel'

/** The inside ring of a storage of `w` x `d` cm, its top left corner at (x0, y0). */
const ring = (w: number, d: number, x0 = 0, y0 = 0): Vec[] => [
  { x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + d }, { x: x0, y: y0 + d },
]

describe('storageLabelCentre', () => {
  it('gives the centre of the inside ring of the storage, not of its walls', () => {
    // 100 x 60 cm with its inside ring from (105, -10) to (205, -70): the label sits on (155, -40).
    expect(storageLabelCentre(ring(100, 60, 105, -70))).toEqual({ x: 155, y: -40 })
  })
})

describe('storageLabelSize', () => {
  it('measures the label in cm, so the text is the same size on screen at every zoom', () => {
    // 7 characters at 6,2 px and a line of 10 px: 43,4 x 10 cm at 1 px/cm, half of it at 2 px/cm.
    expect(storageLabelSize('Storage', 1)).toEqual({ w: 43.4, h: 10 })
    const double = storageLabelSize('Storage', 2)
    expect(double.w).toBeCloseTo(21.7, 6)
    expect(double.h).toBeCloseTo(5, 6)
  })
})

describe('storageLabelFits: the hide rule', () => {
  /** Room kept free on each side by the band of a badge (half a badge plus the gap), cm. */
  const bandX = (zoom: number) => (DIM_STYLE.badgePad + DIM_STYLE.badgeCharW * STORAGE_LABEL.badgeDigits) / 2 / zoom
    + STORAGE_LABEL.badgeGapPx / zoom
  const bandY = (zoom: number) => DIM_STYLE.badgeH / 2 / zoom + STORAGE_LABEL.badgeGapPx / zoom

  it('keeps the label of a storage that has room for it and for a badge on each side', () => {
    const size = storageLabelSize('Storage', 1)
    const r = ring(100, 60)
    // 100 >= 43,4 + 2 x 10,6 and 60 >= 10 + 2 x 10,5: the label fits, clear of the badges.
    expect(100).toBeGreaterThan(size.w + 2 * bandX(1))
    expect(60).toBeGreaterThan(size.h + 2 * bandY(1))
    expect(storageLabelFits(r, size.w, size.h, 1)).toBe(true)
  })

  it('hides the label on a wide storage that is too shallow for a badge band', () => {
    // 100 x 20 cm: the width has room for 'Storage', the depth has not (20 < 10 + 21).
    const size = storageLabelSize('Storage', 1)
    expect(storageLabelFits(ring(100, 20), size.w, size.h, 1)).toBe(false)
  })

  it('hides the label when the same storage is zoomed out, because the text does not shrink', () => {
    const size = storageLabelSize('Storage', 1)
    // At 1 px/cm the label fits; at 0,4 px/cm the ring is only 40 x 24 px on screen, and the label
    // (43,4 px) plus a badge band (21,2 px) does not.
    expect(storageLabelFits(ring(100, 60), size.w, size.h, 1)).toBe(true)
    const small = storageLabelSize('Storage', 0.4)
    expect(small.w).toBeCloseTo(108.5, 6)
    expect(storageLabelFits(ring(100, 60), small.w, small.h, 0.4)).toBe(false)
  })

  it('applies the same rule to the full tag box of a storage (its width and height in cm)', () => {
    // The tag of a storage at zoom 1 is about 65 x 19 px; the ring decides.
    expect(storageLabelFits(ring(100, 60), 65, 19, 1)).toBe(true)
    expect(storageLabelFits(ring(100, 60), 65, 45, 1)).toBe(false)
  })
})

describe('storageLabelPlace', () => {
  it('puts the label in the middle of the ring and says whether it is drawn', () => {
    const shown = storageLabelPlace(ring(100, 60), 'Storage', 1)
    expect(shown.p).toEqual({ x: 50, y: 30 })
    expect(shown.show).toBe(true)
    const hidden = storageLabelPlace(ring(100, 60), 'Storage', 0.4)
    expect(hidden.p).toEqual({ x: 50, y: 30 })
    expect(hidden.show).toBe(false)
  })
})
