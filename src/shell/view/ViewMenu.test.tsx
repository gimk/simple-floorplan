// Canvas View menu: the eye button next to the zoom pill, and its layer popover.
// There is no DOM environment in this project (no jsdom), so the render is checked with
// renderToString and the click work is checked through the helpers the controls call.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUi } from '../../model/store'
import { AUTO_HINT, toggleLayer } from './layers'
import { ViewMenu, moreBelow } from './ViewMenu'

/**
 * Put the UI store in the wanted state. renderToString reads the INITIAL state of a zustand
 * store and a browser reads the current one, so both get the values.
 */
const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

/** The opening tag of the input with this name. */
const inputTag = (html: string, name: string) => {
  const at = html.indexOf(`name="${name}"`)
  return at < 0 ? '' : html.slice(at, html.indexOf('>', at))
}

beforeEach(() => {
  applyState(useUi, { layers: { ...useUi.getState().layers } })
})

describe('ViewMenu button', () => {
  it('is a closed eye button by default', () => {
    const html = renderToString(<ViewMenu />)
    expect(html).toContain('aria-label="View settings"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('name="layer-background"')
  })

  it('uses the Eye icon of lucide', () => {
    // lucide draws a circle + a path for the eye.
    expect(renderToString(<ViewMenu />)).toMatch(/<svg[^>]*>.*<circle|<svg[^>]*>.*<path/)
  })
})

describe('ViewMenu popover', () => {
  const open = () => renderToString(<ViewMenu defaultOpen />)

  it('opens with every plain layer as a checkbox', () => {
    const html = open()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-expanded="true"')
    for (const k of ['background', 'dimensions', 'bearingHighlight', 'openings', 'notes', 'clashes']) {
      expect(inputTag(html, `layer-${k}`)).not.toBe('')
    }
    // The labels of the sidebar layer section are reused.
    expect(html).toContain('Bearing walls highlight')
    expect(html).toContain('Clearance clashes')
  })

  it('shows the two three-state layers as Auto | On | Off, with the auto hint', () => {
    const html = open()
    expect(html).toContain('aria-label="Room codes visibility"')
    expect(html).toContain('aria-label="Wall labels visibility"')
    expect(html).toContain(AUTO_HINT)
    // Two layer groups (Auto / On / Off) and four measurement groups (units, decimals, wall lengths, area decimals).
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(6)
    expect(html.match(/>Auto</g)).toHaveLength(2)
    expect(html.match(/>On</g)).toHaveLength(2)
    expect(html.match(/>Off</g)).toHaveLength(2)
    // The default state is Auto for both.
    expect(open()).toContain('>Auto</button>')
  })

  it('fits a phone width: a full-width bottom sheet with no narrow right-floating box', () => {
    const html = open()
    // Below 768 px the popover is a bottom sheet pinned to both sides of the screen.
    expect(html).toContain('max-md:fixed')
    expect(html).toContain('max-md:inset-x-2')
    expect(html).toContain('max-md:bottom-2')
    expect(html).toContain('max-md:w-auto')
    // `left-auto` (or a fixed `w-64`) would shrink the sheet to ~240 px at the right edge (V-4).
    expect(html).not.toContain('left-auto')
    expect(html).not.toContain('w-64')
  })

  it('opens a two-column popover on a wide screen, with a scroll box per column', () => {
    const html = open()
    // 520 px wide, two columns, capped height, and each column scrolls on its own.
    expect(html).toContain('md:w-[520px]')
    expect(html).toContain('md:max-h-[min(80vh,640px)]')
    expect(html).toContain('data-view-column="layers"')
    expect(html).toContain('data-view-column="measurements"')
    expect(html.match(/md:overflow-y-auto/g)).toHaveLength(2)
    // The two headings of the columns, then the measurement settings under the right one.
    expect(html).toContain('>Layers</h2>')
    expect(html).toContain('>Measurements</h2>')
    // The phone sheet is one column that scrolls as a whole.
    expect(html).toContain('max-h-[75vh]')
  })

  it('shows the fade hint only for a scroll box that holds more content below', () => {
    // No scroll (a box that fits): no hint.
    expect(moreBelow({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toBe(false)
    // The bottom is reached: no hint.
    expect(moreBelow({ scrollTop: 200, scrollHeight: 400, clientHeight: 200 })).toBe(false)
    // More content below: the hint is shown.
    expect(moreBelow({ scrollTop: 0, scrollHeight: 1076, clientHeight: 628 })).toBe(true)
    expect(moreBelow({ scrollTop: 448, scrollHeight: 1076, clientHeight: 628 })).toBe(false)
    expect(moreBelow({ scrollTop: 0, scrollHeight: 1076, clientHeight: 628 - 1 })).toBe(true)
    // Rounding differences of less than 2 px do not flash the hint on a box that fits.
    expect(moreBelow({ scrollTop: 0, scrollHeight: 401, clientHeight: 400 })).toBe(false)
  })

  it('toggles a layer with the same helper as the checkbox does', () => {
    const before = open()
    expect(inputTag(before, 'layer-notes')).toContain('checked')
    // The checkbox onChange calls this, then stores the result.
    applyState(useUi, { layers: toggleLayer(useUi.getState().layers, 'notes') })
    expect(useUi.getState().layers.notes).toBe(false)
    const after = open()
    expect(inputTag(after, 'layer-notes')).not.toContain('checked')
    // The other layers are untouched.
    expect(inputTag(after, 'layer-background')).toContain('checked')
    expect(inputTag(after, 'layer-clashes')).toContain('checked')
  })
})
