// SSR test of the Design mode "Measurements" cheatsheet.
//
// No DOM library (jsdom, happy-dom, @testing-library) is installed in this repo, so the markup comes
// from react-dom/server (the same limit as DesignRoomsInspect.test.tsx). The card is collapsible and
// closed on the first visit, and PanelSection only hides the body with a CSS class (`hidden`), so the
// body is still in the markup: the test checks the title, the group chips and the rows of the group
// shown first (the storage is empty on the server, so the first group is the default).
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MeasurementCheatsheet } from './MeasurementCheatsheet'
import { MEASUREMENT_GROUPS } from './measurements'

describe('MEASUREMENT_GROUPS', () => {
  it('holds the seven reference groups, each with rows', () => {
    expect(MEASUREMENT_GROUPS).toHaveLength(7)
    expect(MEASUREMENT_GROUPS.map((g) => g.title)).toEqual([
      'Circulation',
      'Bedroom',
      'Living',
      'Dining',
      'Kitchen',
      'Bathroom',
      'Heights',
    ])
    for (const group of MEASUREMENT_GROUPS) {
      expect(group.items.length).toBeGreaterThan(0)
      for (const item of group.items) {
        expect(item.label.trim()).not.toBe('')
        expect(item.value.trim()).not.toBe('')
      }
    }
  })

  it('gives every group a unique short title for its chip', () => {
    const shorts = MEASUREMENT_GROUPS.map((g) => g.short)
    for (const short of shorts) expect(short.trim()).not.toBe('')
    expect(new Set(shorts).size).toBe(MEASUREMENT_GROUPS.length)
  })

  it('keeps the en dash and the diameter sign of the source sizes', () => {
    const all = MEASUREMENT_GROUPS.flatMap((g) => g.items)
    expect(all.some((i) => i.value.includes('–'))).toBe(true)
    expect(all.some((i) => i.value.includes('Ø 150 cm'))).toBe(true)
  })
})

describe('MeasurementCheatsheet', () => {
  it('renders the Measurements card with the chips and the first group', () => {
    const html = renderToStaticMarkup(<MeasurementCheatsheet />)
    expect(html).toContain('Measurements')
    // One chip per group, labelled with the short title.
    for (const group of MEASUREMENT_GROUPS) expect(html).toContain(group.short)
    // Only one group is shown: the rows of the first group are in the markup.
    const first = MEASUREMENT_GROUPS[0]
    expect(html).toContain('Walkway')
    expect(html).toContain('90 cm')
    for (const item of first.items) expect(html).toContain(item.value)
    // The other groups stay out of the body until their chip is chosen.
    const last = MEASUREMENT_GROUPS[MEASUREMENT_GROUPS.length - 1]
    expect(html).not.toContain(last.items[0].label)
  })

  it('starts collapsed and is a collapsible section', () => {
    const html = renderToStaticMarkup(<MeasurementCheatsheet />)
    // PanelSection renders the toggle only when `collapsible`, and the closed body keeps `hidden`.
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls=')
  })
})
