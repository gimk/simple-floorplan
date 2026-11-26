import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtboard } from '../../model/schema'
import { ArtboardContent, ArtboardsLayer } from './ArtboardsLayer'
import { ArtboardInspect } from './ArtboardInspect'

// Render smoke test (react-dom/server, no DOM needed). zustand v5 renders the INITIAL state
// on the server, so these assertions describe the default document: one empty artboard
// named "Plan A". The interactive behaviour (select, drag, duplicate) is not covered here.
describe('smoke', () => {
  it('renders the layer: one frame, one header, a duplicate button', () => {
    const html = renderToStaticMarkup(<ArtboardsLayer />)
    expect(html).toContain('data-testid="artboards-layer"')
    expect((html.match(/data-artboard-frame=/g) ?? []).length).toBe(1)
    expect(html).toContain('aria-label="Artboard Plan A"')
    expect(html).toContain('aria-label="Duplicate artboard Plan A"')
    // minimum frame, padded around the artboard origin
    expect(html).toContain('x="-40" y="-40" width="600" height="450"')
  })

  it('makes only the frame border clickable and shows no handle until selected', () => {
    const html = renderToStaticMarkup(<ArtboardsLayer />)
    // Transparent 10 px stroke around the frame: the border selects the artboard.
    expect(html).toContain('data-testid="artboard-border-')
    expect(html).toContain(
      'fill="none" stroke="transparent" stroke-width="10" pointer-events="stroke" style="cursor:pointer"',
    )
    // The frame itself keeps `pointer-events="none"`, so a click inside the frame still reaches
    // the rooms and the empty background.
    expect(html).toContain('rx="4" stroke-width="1" pointer-events="none"')
    // Edge and corner hit zones (Plan mode, select tool).
    for (const zone of ['right', 'left', 'bottom', 'top', 'tl', 'tr', 'corner', 'bl']) {
      expect(html).toContain(`data-testid="artboard-resize-${zone}-`)
    }
    // No visible corner handle: nothing is selected in the initial document.
    expect(html).not.toContain('artboard-handle-')
  })

  it('renders the inspect card and follows the active artboard', () => {
    const panel = renderToStaticMarkup(<ArtboardInspect />)
    // PanelSection renders the title as an <h2> heading (no aria-label on the section any more).
    expect(panel).toContain('>Artboard<')
    expect(panel).toContain('Total area')
    expect(panel).toContain('0,00 m²')
    expect(panel).toContain('No room yet')
    expect(panel).toContain('Duplicate')
    expect(panel).toContain('Add')
    // one artboard only: Delete is disabled and the hint under it explains why
    expect(panel).toMatch(/<button[^>]*disabled=""(?:(?!<\/button>).)*Delete artboard/)
    expect(panel).toContain('The document keeps at least one artboard.')
  })

  it('renders children in the artboard offset', () => {
    const html = renderToStaticMarkup(
      <ArtboardContent artboard={{ ...createArtboard('Plan A', 120, -80) }}>
        <rect x={0} y={0} width={10} height={10} />
      </ArtboardContent>,
    )
    expect(html).toContain('transform="translate(120 -80)"')
    expect(html).toContain('<rect')
  })
})
