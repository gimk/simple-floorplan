import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import { computeDesignMarqueeSelection, DRAG_PX, startDesignMarquee } from './CanvasSelectLayer'
import { useMarquee } from './marqueeStore'

const item = (id: string, xCm: number, yCm: number, widthCm = 80, depthCm = 60): FurnitureItem => ({
  id,
  name: id,
  shape: 'rect',
  xCm,
  yCm,
  widthCm,
  depthCm,
  rotationDeg: 0,
  color: '#94a3b8',
})

const board = (id: string, xCm: number, yCm: number, furniture: FurnitureItem[]): Artboard => ({
  id,
  name: id,
  xCm,
  yCm,
  ceilingHeightCm: 250,
  precisionCm: 1,
  rooms: [],
  openings: [],
  furniture,
})

describe('computeDesignMarqueeSelection', () => {
  const ab = board('ab1', 1000, 500, [
    item('f1', 100, 100),
    item('f2', 220, 100),
    item('f3', 500, 500),
  ])

  it('shifts world box by artboard origin and returns intersecting furniture ids', () => {
    const res = computeDesignMarqueeSelection(
      { minX: 1050, minY: 550, maxX: 1250, maxY: 650 },
      ab,
      { kind: 'none' },
      false,
    )
    expect(res).toEqual({ artboardId: 'ab1', ids: ['f1', 'f2'] })
  })

  it('merges with existing furniture selection on the same artboard when Shift is held', () => {
    const res = computeDesignMarqueeSelection(
      { minX: 1180, minY: 550, maxX: 1260, maxY: 650 },
      ab,
      { kind: 'furniture', artboardId: 'ab1', furnitureId: 'f1' },
      true,
    )
    expect(res).toEqual({ artboardId: 'ab1', ids: ['f1', 'f2'] })
  })

  it('ignores existing selection from a different artboard when Shift is held', () => {
    const res = computeDesignMarqueeSelection(
      { minX: 1180, minY: 550, maxX: 1260, maxY: 650 },
      ab,
      { kind: 'furniture', artboardId: 'other', furnitureId: 'x1' },
      true,
    )
    expect(res).toEqual({ artboardId: 'ab1', ids: ['f2'] })
  })

  it('returns null when artboard is missing or no items intersect', () => {
    expect(computeDesignMarqueeSelection({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, undefined, { kind: 'none' }, false)).toBeNull()
    expect(computeDesignMarqueeSelection({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, ab, { kind: 'none' }, false)).toBeNull()
  })
})

describe('startDesignMarquee', () => {
  let winTarget: EventTarget
  let savedDoc: ReturnType<typeof useDoc.getState>['doc']
  let savedUi: { mode: 'plan' | 'design'; tool: ReturnType<typeof useUi.getState>['tool']; activeArtboardId: string | null; selection: ReturnType<typeof useUi.getState>['selection'] }

  beforeEach(() => {
    winTarget = new EventTarget()
    vi.stubGlobal('window', winTarget)
    savedDoc = useDoc.getState().doc
    const ui = useUi.getState()
    savedUi = { mode: ui.mode, tool: ui.tool, activeArtboardId: ui.activeArtboardId, selection: ui.selection }

    const ab = board('ab1', 100, 100, [item('f1', 50, 50), item('f2', 160, 50)])
    useDoc.setState({
      doc: { ...savedDoc, artboards: [ab] },
    })
    useUi.getState().set({
      mode: 'design',
      tool: 'select',
      activeArtboardId: 'ab1',
      selection: { kind: 'none' },
    })
    useMarquee.getState().set(null)
  })

  afterEach(() => {
    useMarquee.getState().set(null)
    useDoc.setState({ doc: savedDoc })
    useUi.getState().set(savedUi)
    vi.unstubAllGlobals()
  })

  const ptr = (type: string, x: number, y: number, opts: { pointerId?: number; shiftKey?: boolean } = {}) =>
    Object.assign(new Event(type), {
      pointerId: opts.pointerId ?? 1,
      clientX: x,
      clientY: y,
      shiftKey: opts.shiftKey ?? false,
    })

  it('treats a press + release below DRAG_PX as a click (no marquee, onDone(false))', () => {
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const onDone = vi.fn()

    startDesignMarquee(
      {
        pointerId: 1,
        clientX: 120,
        clientY: 120,
        currentTarget: { setPointerCapture, releasePointerCapture } as unknown as Element,
      },
      { toWorld: (x, y) => ({ x, y }), artboardId: 'ab1', onDone },
    )

    expect(setPointerCapture).toHaveBeenCalledWith(1)
    winTarget.dispatchEvent(ptr('pointermove', 120 + DRAG_PX - 1, 120))
    expect(useMarquee.getState().box).toBeNull()

    winTarget.dispatchEvent(ptr('pointerup', 120 + DRAG_PX - 1, 120))
    expect(releasePointerCapture).toHaveBeenCalledWith(1)
    expect(onDone).toHaveBeenCalledWith(false)
    expect(useUi.getState().selection).toEqual({ kind: 'none' })
  })

  it('draws live marquee and selects intersecting furniture on drag release', () => {
    const onDone = vi.fn()

    startDesignMarquee(
      {
        pointerId: 1,
        clientX: 110,
        clientY: 110,
        currentTarget: {} as Element,
      },
      { toWorld: (x, y) => ({ x, y }), artboardId: 'ab1', onDone },
    )

    winTarget.dispatchEvent(ptr('pointermove', 280, 180))
    expect(useMarquee.getState().box).toEqual({ minX: 110, minY: 110, maxX: 280, maxY: 180 })

    winTarget.dispatchEvent(ptr('pointerup', 280, 180))
    expect(useMarquee.getState().box).toBeNull()
    expect(onDone).toHaveBeenCalledWith(true)
    expect(useUi.getState().selection).toEqual({
      kind: 'furnitureMulti',
      artboardId: 'ab1',
      furnitureIds: ['f1', 'f2'],
    })
  })

  it('clears marquee and skips selection/onDone on pointercancel', () => {
    const onDone = vi.fn()

    startDesignMarquee(
      {
        pointerId: 1,
        clientX: 110,
        clientY: 110,
        currentTarget: {} as Element,
      },
      { toWorld: (x, y) => ({ x, y }), artboardId: 'ab1', onDone },
    )

    winTarget.dispatchEvent(ptr('pointermove', 280, 180))
    expect(useMarquee.getState().box).not.toBeNull()

    winTarget.dispatchEvent(ptr('pointercancel', 280, 180))
    expect(useMarquee.getState().box).toBeNull()
    expect(onDone).not.toHaveBeenCalled()
    expect(useUi.getState().selection).toEqual({ kind: 'none' })
  })
})
