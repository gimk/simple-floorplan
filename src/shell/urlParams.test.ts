import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDoc } from '../model/store'
import { applyInitialUiParams, parseUrlParams, unregisterServiceWorkersIfRequested } from './urlParams'
import { useUi } from './uiStore'

describe('parseUrlParams', () => {
  it('returns defaults for empty params', () => {
    expect(parseUrlParams('')).toEqual({ nosw: false })
  })
  it('parses valid values and trims', () => {
    expect(parseUrlParams('?project=%20abc%20&mode=design&tool=rect&artboard=a1&nosw=1')).toEqual({
      project: 'abc', mode: 'design', tool: 'rect', artboard: 'a1', nosw: true,
    })
  })
  it('ignores invalid values', () => {
    expect(parseUrlParams('?project=%20&mode=3d&tool=place-opening&artboard=&nosw=0')).toEqual({ nosw: false })
  })
  it('accepts nosw=true', () => {
    expect(parseUrlParams('nosw=true').nosw).toBe(true)
  })
})

describe('applyInitialUiParams', () => {
  beforeEach(() => {
    useDoc.getState().resetDoc()
    useUi.getState().set({ mode: 'plan', tool: 'select', activeArtboardId: null })
  })
  it('sets mode, tool and an existing artboard', () => {
    const id = useDoc.getState().doc.artboards[0].id
    applyInitialUiParams({ mode: 'design', tool: 'tape', artboard: id, nosw: false })
    const ui = useUi.getState()
    expect([ui.mode, ui.tool, ui.activeArtboardId]).toEqual(['design', 'tape', id])
  })
  it('ignores an unknown artboard', () => {
    applyInitialUiParams({ artboard: 'nope', nosw: false })
    expect(useUi.getState().activeArtboardId).toBeNull()
  })
})

describe('unregisterServiceWorkersIfRequested', () => {
  it('unregisters every registration only when requested', async () => {
    const unregister = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]) } })
    await unregisterServiceWorkersIfRequested(false)
    expect(unregister).not.toHaveBeenCalled()
    await unregisterServiceWorkersIfRequested(true)
    expect(unregister).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})
