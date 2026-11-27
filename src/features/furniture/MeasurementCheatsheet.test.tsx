// SSR test of the Design mode "Measurements" cheatsheet.
//
// No DOM library (jsdom, happy-dom, @testing-library) is installed in this repo, so the markup comes
// from react-dom/server (the same limit as DesignRoomsInspect.test.tsx). The card is collapsible and
// closed on the first visit, and PanelSection only hides the body with a CSS class (`hidden`), so the
// rows are still in the markup: the test checks the title, the group subheadings and the values.
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

  it('keeps the en dash and the diameter sign of the source sizes', () => {
    const all = MEASUREMENT_GROUPS.flatMap((g) => g.items)
    expect(all.some((i) => i.value.includes('–'))).toBe(true)
    expect(all.some((i) => i.value.includes('Ø 150 cm'))).toBe(true)
  })
})

describe('MeasurementCheatsheet', () => {
  it('renders the Measurements card with every group and its rows', () => {
    const html = renderToStaticMarkup(<MeasurementCheatsheet />)
    expect(html).toContain('Measurements')
    for (const group of MEASUREMENT_GROUPS) {
      expect(html).toContain(group.title)
      for (const item of group.items) {
        expect(html).toContain(item.value)
      }
    }
    // A few spot checks of the exact text.
    expect(html).toContain('Corridor / walkway')
    expect(html).toContain('Ø 150 cm')
    expect(html).toContain('50–60 cm above counter, 35 cm deep')
  })

  it('starts collapsed and is a collapsible section', () => {
    const html = renderToStaticMarkup(<MeasurementCheatsheet />)
    // PanelSection renders the toggle only when `collapsible`, and the closed body keeps `hidden`.
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls=')
  })
})
