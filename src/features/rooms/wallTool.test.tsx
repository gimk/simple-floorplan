// Wall tool overlay: it renders on the plan with no chain, and the typed box and the alignment
// badge only appear while a chain is drawn (measurements plan, section 7). The pure logic of the
// tool is tested in wallToolLogic.test.ts.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useUi } from '../../model/store'
import { WallTool } from './wallTool'

describe('Wall tool overlay', () => {
  it('renders its capture rect with no chain, no typed box and no alignment badge', () => {
    useUi.setState({ tool: 'wall' })
    const html = renderToString(<svg><WallTool /></svg>)
    expect(html).toContain('<rect')
    expect(html).not.toContain('data-wall-tool-box')
    expect(html).not.toContain('data-wall-tool-input')
    expect(html).not.toContain('data-wall-align-badge')
    expect(html).not.toContain('data-wall-preview-label')
  })
})
