import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_UNITS } from '../../model/units'
import { LayersList } from './LayersPanel'
import { layersDoc } from './fixture'
import { buildLayerTree, type LayerNode } from './tree'

describe('LayersList', () => {
  const nodes = buildLayerTree(layersDoc()).nodes
  const render = (collapsed = new Set<string>(), selected = new Set<string>(), list = nodes) =>
    renderToString(<LayersList nodes={list} units={DEFAULT_UNITS} selected={selected} collapsed={collapsed} onToggle={() => {}} onSelect={() => {}} />)

  it('renders the rooms, walls and the group without a room', () => {
    const html = render()
    for (const text of ['R1 Cuisine', 'R2 Salon', 'R1-1', 'Walls without a room', 'W3', 'Door', 'S1 Placard']) expect(html).toContain(text)
    // The row keeps only the length: no state word, no wall type word.
    expect(html).toContain('390 cm')
    expect(html).not.toContain('>measured<')
    expect(html).not.toContain('>estimated<')
    expect(html).toContain('aria-label="Locked"')
    expect(html).toContain('Overlaps another wall')
  })

  it('keeps every label whole: no truncate class on the label span', () => {
    const html = render()
    // "R1 Cuisine" sits in a span that must not shrink and must not truncate.
    const label = /<span class="([^"]*)">R1 Cuisine<\/span>/
    const m = label.exec(html)
    expect(m).not.toBeNull()
    expect(m![1]).toContain('shrink-0')
    expect(m![1]).toContain('whitespace-nowrap')
    expect(m![1]).not.toContain('truncate')
  })

  it('shows the measured icon for a measured wall and nothing for an estimated one', () => {
    const wall = (measured: boolean): LayerNode => ({
      key: `wall:r1:r1${measured ? '0' : '1'}`, type: 'wall', label: measured ? 'R1-1' : 'R1-2',
      lengthCm: 390, measured, wallType: 'partition', sel: { kind: 'wall', roomId: 'r1', wallStart: 'r10' }, children: [],
    })
    expect(render(new Set(), new Set(), [wall(true)])).toContain('aria-label="Measured"')
    expect(render(new Set(), new Set(), [wall(false)])).not.toContain('aria-label="Measured"')
  })

  it('puts the full information of a wall row in its title', () => {
    const html = render()
    // label · length · state · type, then "locked" on the locked wall and the warning on W3.
    expect(html).toContain('title="R1-1 · 390 cm · estimated · bearing · locked"')
    expect(html).toContain('title="W3 · 100 cm · estimated · partition · Overlaps another wall"')
  })

  it('hides the children of a collapsed room and marks the selected row', () => {
    expect(render(new Set(['room:r1']))).not.toContain('R1-1')
    expect(render(new Set(), new Set(['room:r2']))).toContain('aria-selected="true"')
  })
})
