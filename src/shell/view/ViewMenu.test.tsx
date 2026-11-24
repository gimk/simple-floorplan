// Canvas View menu: the eye button next to the zoom pill, and its layer popover.
// There is no DOM environment in this project (no jsdom), so the render is checked with
// renderToString and the click work is checked through the helpers the controls call.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUi } from '../../model/store'
import { AUTO_HINT, toggleLayer } from './layers'
import { ViewMenu } from './ViewMenu'

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

  it('fits a phone width: capped wide, and a bottom sheet on small screens', () => {
    const html = open()
    expect(html).toContain('max-w-[calc(100vw-2rem)]')
    // Below 768 px the popover sits above the pills at full width, so it never runs off screen.
    expect(html).toContain('max-md:fixed')
    expect(html).toContain('max-md:inset-x-2')
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
