// The palette as HTML (server render): rows, groups, shortcuts, and the greyed out rows.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../model/store'
import { CommandPalette } from './CommandPalette'
import { TOOLS } from './tools'

/** The opening tag of the row of one command (its `disabled` attribute lives there). */
const rowTag = (html: string, id: string): string => {
  const m = html.match(new RegExp(`<button[^>]*data-command="${id}"[^>]*>`))
  if (!m) throw new Error(`no row ${id}`)
  return m[0]
}

/** Is this row greyed out? `disabled` in the class list (disabled:opacity-40) is not the attribute. */
const isDisabled = (html: string, id: string): boolean => / disabled=""/.test(rowTag(html, id))

const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

beforeEach(() => {
  applyState(useUi, { mode: 'edit', tool: 'select', selection: null, multi: [], dimStyle: 'lines' })
  applyState(useDoc, { doc: emptyDoc() })
  useDoc.temporal.getState().clear()
})

describe('CommandPalette', () => {
  it('draws nothing while it is closed', () => {
    expect(renderToString(<CommandPalette open={false} onClose={() => {}} />)).toBe('')
  })

  it('is a modal dialog with a search field and every tool row', () => {
    const html = renderToString(<CommandPalette open onClose={() => {}} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Command palette"')
    expect(html).toContain('aria-label="Search commands"')
    expect(html).toContain('bg-black/50')
    for (const t of TOOLS) expect(html).toContain(`data-command="tool:${t.id}"`)
    // The letter key of the tool is on the right of the row.
    expect(html).toContain('<kbd')
    expect(html).toContain('>V</kbd>')
  })

  it('greys out a row that is not available now', () => {
    const html = renderToString(<CommandPalette open onClose={() => {}} />)
    // Undo has nothing to undo on a fresh document.
    expect(isDisabled(html, 'edit:undo')).toBe(true)
    // The shortcuts dialog is not given by this test, so its row is not runnable.
    expect(isDisabled(html, 'help:shortcuts')).toBe(true)
    // A tool is always available.
    expect(isDisabled(html, 'tool:wall')).toBe(false)
  })

  it('groups the rows and shows the shortcut of the palette itself', () => {
    const html = renderToString(<CommandPalette open onClose={() => {}} onOpenShortcuts={() => {}} />)
    expect(html).toContain('role="group" aria-label="Tools"')
    expect(html).toContain('role="group" aria-label="Layers"')
    expect(html).toContain('role="group" aria-label="Export"')
    expect(html).toContain('>Shift+P</kbd>')
    expect(isDisabled(html, 'help:shortcuts')).toBe(false)
  })
})
