import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_UNITS } from '../../model/units'
import { LayersList } from './LayersPanel'
import { layersDoc } from './fixture'
import { buildLayerTree } from './tree'

describe('LayersList', () => {
  const nodes = buildLayerTree(layersDoc()).nodes
  const render = (collapsed = new Set<string>(), selected = new Set<string>()) =>
    renderToString(<LayersList nodes={nodes} units={DEFAULT_UNITS} selected={selected} collapsed={collapsed} onToggle={() => {}} onSelect={() => {}} />)

  it('renders the rooms, walls and the group without a room', () => {
    const html = render()
    for (const text of ['R1 Cuisine', 'R2 Salon', 'R1-1', 'Walls without a room', 'W3', 'Door', 'S1 Placard']) expect(html).toContain(text)
    expect(html).toContain('390 cm')
    expect(html).toContain('estimated')
    expect(html).toContain('aria-label="Locked"')
    expect(html).toContain('Overlaps another wall')
  })

  it('hides the children of a collapsed room and marks the selected row', () => {
    expect(render(new Set(['room:r1']))).not.toContain('R1-1')
    expect(render(new Set(), new Set(['room:r2']))).toContain('aria-selected="true"')
  })
})
