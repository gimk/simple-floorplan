import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import { addArtboardWithFrame, artboardRectFromDrag, nextArtboardName } from './draw'
import { artboardFrame, MIN_ARTBOARD_HEIGHT_CM, MIN_ARTBOARD_WIDTH_CM } from './frame'

const none = { shift: false, alt: false, cmd: false }

describe('artboardRectFromDrag', () => {
  it('snaps a drag to 10 cm and keeps the top-left corner', () => {
    expect(artboardRectFromDrag({ x: 101, y: 99 }, { x: 1004, y: 803 }, none)).toEqual({ x: 100, y: 100, w: 900, h: 700 })
  })
  it('handles a drag up and to the left', () => {
    expect(artboardRectFromDrag({ x: 1000, y: 800 }, { x: 100, y: 100 }, none)).toEqual({ x: 100, y: 100, w: 900, h: 700 })
  })
  it('turns a click into the default size centred on the point', () => {
    const r = artboardRectFromDrag({ x: 1000, y: 1000 }, { x: 1003, y: 1002 }, none)
    expect(r).toEqual({ x: 1000 - MIN_ARTBOARD_WIDTH_CM / 2, y: 1000 - MIN_ARTBOARD_HEIGHT_CM / 2, w: MIN_ARTBOARD_WIDTH_CM, h: MIN_ARTBOARD_HEIGHT_CM })
  })
  it('enforces the minimum frame size', () => {
    const r = artboardRectFromDrag({ x: 0, y: 0 }, { x: 200, y: 100 }, none)
    expect(r.w).toBe(MIN_ARTBOARD_WIDTH_CM)
    expect(r.h).toBe(MIN_ARTBOARD_HEIGHT_CM)
  })
  it('Shift makes a square, Alt draws from the centre, Cmd skips the snap', () => {
    expect(artboardRectFromDrag({ x: 0, y: 0 }, { x: 1000, y: 700 }, { ...none, shift: true })).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
    expect(artboardRectFromDrag({ x: 1000, y: 1000 }, { x: 1800, y: 1600 }, { ...none, alt: true })).toEqual({ x: 200, y: 400, w: 1600, h: 1200 })
    expect(artboardRectFromDrag({ x: 0, y: 0 }, { x: 1003, y: 807 }, { ...none, cmd: true })).toMatchObject({ w: 1003, h: 807 })
  })
})

describe('addArtboardWithFrame', () => {
  beforeEach(() => { useDoc.setState({ doc: createDefaultProject() }) })

  it('creates an artboard whose frame is the drawn rectangle, named Plan B, with default settings', () => {
    const id = addArtboardWithFrame({ x: 2000, y: 500, w: 900, h: 700 })
    const ab = useDoc.getState().doc.artboards.find((a) => a.id === id)!
    expect(ab.name).toBe('Plan B')
    expect(ab.wallThicknessCm).toBe(10)
    expect(ab.widthCm).toBe(900)
    expect(ab.heightCm).toBe(700)
    expect(artboardFrame(ab)).toMatchObject({ x: 2000, y: 500, width: 900, height: 700 })
  })

  it('is one undo step', () => {
    addArtboardWithFrame({ x: 0, y: 0, w: 600, h: 450 })
    expect(useDoc.getState().doc.artboards).toHaveLength(2)
    useDoc.getState().undo()
    expect(useDoc.getState().doc.artboards).toHaveLength(1)
  })

  it('names follow the Plan A, B, C sequence', () => {
    expect(nextArtboardName(useDoc.getState().doc.artboards)).toBe('Plan B')
  })
})
