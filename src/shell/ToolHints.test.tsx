import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../model/store'
import { convertToV2 } from '../model/v2/convert'
import type { Room } from '../model/types'
import {
  MEASURE_TIPS,
  SELECT_V2_TIPS,
  TOOL_TIPS,
  ToolTipsButton,
  getToolTips,
  handleTipsKeyDown,
} from './ToolHints'

const room: Room = {
  id: 'A', code: 'A', name: 'A', holes: [], walls: {}, walkOrder: 1,
  vertices: [{ id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 300, y: 0 }, { id: 'v2', x: 300, y: 300 }, { id: 'v3', x: 0, y: 300 }],
}

const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

beforeEach(() => {
  applyState(useUi, { mode: 'edit', tool: 'select' })
  applyState(useDoc, { doc: { ...emptyDoc(), rooms: [room] } })
})

describe('ToolTipsButton and TOOL_TIPS', () => {
  it('hides the button for tools with no tips (pin, tape, place-element)', () => {
    for (const tool of ['pin', 'tape', 'place-element'] as const) {
      applyState(useUi, { tool })
      expect(TOOL_TIPS[tool]).toEqual([])
      expect(renderToString(<ToolTipsButton />)).toBe('')
    }
  })

  it('starts closed and shows the wall items when opened', () => {
    applyState(useUi, { tool: 'wall' })
    const closed = renderToString(<ToolTipsButton onOpenShortcuts={() => {}} />)
    expect(closed).toContain('aria-label="Tips for this tool"')
    expect(closed).toContain('title="Tips for this tool"')
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).not.toContain('role="dialog"')
    expect(closed).not.toContain('Exact length')

    const open = renderToString(<ToolTipsButton onOpenShortcuts={() => {}} defaultOpen />)
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('role="dialog"')
    expect(open).toContain('>Wall</div>')
    for (const tip of TOOL_TIPS.wall) {
      expect(open).toContain(`>${tip.keys}</kbd>`)
      expect(open).toContain(`>${tip.action}</dd>`)
    }
    expect(open).toContain('All shortcuts')
  })

  it('shows v1 select tips for v1 documents and v2 select tips for v2 documents', () => {
    const v1Html = renderToString(<ToolTipsButton defaultOpen />)
    expect(v1Html).toContain('Move this room only (shared walls stay)')
    expect(v1Html).not.toContain('Box add to selection')

    applyState(useDoc, { doc: convertToV2({ ...emptyDoc(), rooms: [room] }).doc })
    const v2Html = renderToString(<ToolTipsButton defaultOpen />)
    expect(v2Html).toContain('Add or remove room / wall')
    expect(v2Html).toContain('Box add to selection')
    expect(v2Html).not.toContain('Move this room only (shared walls stay)')
    expect(getToolTips('select', { v2: true })).toEqual(SELECT_V2_TIPS)
  })

  it('shows the measuring mode tip when measuring', () => {
    applyState(useUi, { mode: 'measure' })
    const html = renderToString(<ToolTipsButton pill defaultOpen />)
    expect(html).toContain('>Measuring Mode</div>')
    expect(html).toContain('>Hover a wall</kbd>')
    expect(html).toContain('>Find its field</dd>')
    expect(getToolTips('select', { measuring: true })).toEqual(MEASURE_TIPS)
  })

  it('closes on Escape and ignores other keys', () => {
    const onClose = vi.fn()
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()

    expect(handleTipsKeyDown({ key: 'Enter', preventDefault, stopPropagation }, onClose)).toBe(false)
    expect(onClose).not.toHaveBeenCalled()

    expect(handleTipsKeyDown({ key: 'Escape', preventDefault, stopPropagation }, onClose)).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
