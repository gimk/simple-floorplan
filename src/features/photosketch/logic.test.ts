import { describe, expect, it } from 'vitest'
import type { PhotoMark, Pin, PlanDoc, Room } from '../../model/types'
import {
  markIsMeasured,
  markLabelText,
  markMiddle,
  markPixelLength,
  markRows,
  markSummary,
  markValueCm,
  marksCount,
  marksOf,
  normPoint,
  photoIndexOf,
  pxPoint,
  surveyOfMark,
  surveyOptionsForPin,
  withMark,
  withPatchedMark,
  withPhotoMarks,
  withoutMark,
} from './logic'

const room = (over: Partial<Room> = {}): Room => ({
  id: 'r1',
  code: 'SE',
  name: 'Living Room',
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 400, y: 0 },
    { id: 'v2', x: 400, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
  holes: [],
  walls: {},
  walkOrder: 1,
  diagonal: [0, 2],
  ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'p',
  title: 'T',
  rooms: [room()],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
  ...over,
})

const mark = (over: Partial<PhotoMark> = {}): PhotoMark => ({
  id: 'm1',
  a: { x: 0.1, y: 0.2 },
  b: { x: 0.6, y: 0.2 },
  ...over,
})

const pin = (over: Partial<Pin> = {}): Pin => ({
  id: 'p1',
  roomId: 'r1',
  at: { x: 10, y: 10 },
  photoKeys: ['k1', 'k2'],
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('photo marks: normalised points', () => {
  it('normalises pixels inside the drawn photo', () => {
    expect(normPoint(50, 25, { w: 200, h: 100 })).toEqual({ x: 0.25, y: 0.25 })
  })

  it('clamps taps that fall outside the photo', () => {
    expect(normPoint(-20, 400, { w: 200, h: 100 })).toEqual({ x: 0, y: 1 })
  })

  it('never divides by a zero-sized box', () => {
    expect(normPoint(10, 10, { w: 0, h: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('goes back to pixels', () => {
    expect(pxPoint({ x: 0.5, y: 0.25 }, { w: 200, h: 100 })).toEqual({ x: 100, y: 25 })
  })
})

describe('photo marks: list helpers', () => {
  it('reads the marks of one photo only', () => {
    const p = pin({ sketches: { k1: [mark()] } })
    expect(marksOf(p, 'k1')).toHaveLength(1)
    expect(marksOf(p, 'k2')).toEqual([])
    expect(marksOf(undefined, 'k1')).toEqual([])
    expect(marksOf(p, null)).toEqual([])
  })

  it('counts the marks of all photos', () => {
    expect(marksCount(pin({ sketches: { k1: [mark(), mark({ id: 'm2' })], k2: [mark({ id: 'm3' })] } }))).toBe(3)
    expect(marksCount(pin())).toBe(0)
    expect(marksCount(undefined)).toBe(0)
  })

  it('finds the photo index', () => {
    expect(photoIndexOf(pin(), 'k2')).toBe(1)
    expect(photoIndexOf(pin(), 'nope')).toBe(-1)
  })

  it('appends, patches and removes without mutating', () => {
    const marks = [mark()]
    const added = withMark(marks, mark({ id: 'm2' }))
    expect(added.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(marks).toHaveLength(1)
    const patched = withPatchedMark(added, 'm2', { valueCm: 250 })
    expect(patched[1].valueCm).toBe(250)
    expect(added[1].valueCm).toBeUndefined()
    expect(withoutMark(added, 'm1').map((m) => m.id)).toEqual(['m2'])
  })

  it('keeps other photos, and drops the photo key when it has no mark left', () => {
    const p = pin({ sketches: { k1: [mark()], k2: [mark({ id: 'm2' })] } })
    expect(withPhotoMarks(p, 'k2', [])).toEqual({ k1: [mark()] })
    expect(withPhotoMarks(p, 'k1', [mark({ id: 'm9' })])).toEqual({ k1: [mark({ id: 'm9' })], k2: [mark({ id: 'm2' })] })
    expect(withPhotoMarks(pin({ sketches: { k1: [mark()] } }), 'k1', [])).toBeUndefined()
  })

  it('gives the middle and the length in pixels', () => {
    expect(markMiddle(mark(), { w: 200, h: 100 })).toEqual({ x: 70, y: 20 })
    expect(markPixelLength(mark(), { w: 200, h: 100 })).toBeCloseTo(100)
    expect(markPixelLength(mark({ b: { x: 0.1, y: 0.2 } }), { w: 200, h: 100 })).toBe(0)
  })
})

describe('photo marks: values', () => {
  it('uses the typed value when the mark is not linked', () => {
    expect(markValueCm(mark({ valueCm: 250.5 }), doc())).toBe(250.5)
    expect(markValueCm(mark(), doc())).toBeNull()
    expect(markValueCm(mark({ valueCm: 0 }), doc())).toBeNull()
  })

  it('prefers the measured value of the linked survey ID', () => {
    const d = doc({ measurements: { 'SE-2': { label: 'SE-2', actualCm: 298, updatedAt: '' } } })
    // SE-2 is the second wall of the polygon: (400,0) -> (400,300) = 300 cm planned.
    expect(markValueCm(mark({ label: 'SE-2' }), d)).toBe(298)
    expect(markValueCm(mark({ label: 'SE-2' }), doc())).toBe(300)
  })

  it('falls back to the planned value and then to the typed one', () => {
    expect(markValueCm(mark({ label: 'SE-1' }), doc())).toBe(400)
    expect(markValueCm(mark({ label: 'SE-9' }), doc())).toBeNull()
    expect(markValueCm(mark({ label: 'SE-9', valueCm: 120 }), doc())).toBe(120)
  })

  it('knows a linked survey ID and reports the measured flag', () => {
    const d = doc({ measurements: { 'SE-1': { label: 'SE-1', actualCm: 402, updatedAt: '' } } })
    expect(surveyOfMark(mark({ label: 'SE-1' }), d)?.label).toBe('SE-1')
    expect(surveyOfMark(mark(), d)).toBeUndefined()
    expect(markIsMeasured(mark({ label: 'SE-1' }), d)).toBe(true)
    expect(markIsMeasured(mark({ label: 'SE-1' }), doc())).toBe(false)
    expect(markIsMeasured(mark(), d)).toBe(false)
  })

  it('writes the label on the photo with comma decimals', () => {
    expect(markLabelText(mark({ valueCm: 412.5 }), doc())).toBe('412,5 cm')
    expect(markLabelText(mark({ label: 'SE-H' }), doc())).toBe('SE-H') // no ceiling height known
    expect(markLabelText(mark({ label: 'NOPE' }), doc())).toBe('NOPE')
  })

  it('summarises a mark for lists', () => {
    expect(markSummary(mark({ label: 'SE-1' }), doc())).toBe('SE-1 · 400 cm')
    expect(markSummary(mark({ valueCm: 90 }), doc())).toBe('90 cm')
    expect(markSummary(mark({ label: 'NOPE' }), doc())).toBe('NOPE')
    expect(markSummary(mark(), doc())).toBe('')
  })

  it('offers the survey IDs of the pin room only', () => {
    const d = doc({
      rooms: [room(), room({ id: 'r2', code: 'CU', name: 'Kitchen' })],
      measurements: { 'SE-1': { label: 'SE-1', actualCm: 402, updatedAt: '' } },
    })
    const options = surveyOptionsForPin(pin(), d)
    expect(options.map((o) => o.value)).toEqual(['SE-1', 'SE-2', 'SE-3', 'SE-4', 'SE-D', 'SE-H'])
    expect(options[0].label).toBe('SE-1 · 402 cm') // measured wins
    expect(options[1].label).toBe('SE-2 · 300 cm')
    expect(surveyOptionsForPin(pin({ roomId: undefined }), d)).toEqual([])
  })
})

describe('photo marks: CSV rows', () => {
  it('lists one row per mark, in pin then photo order', () => {
    const d = doc({
      pins: [
        pin({ sketches: { k2: [mark({ valueCm: 120.25, note: 'pipe' }), mark({ id: 'm2', label: 'SE-1' })] } }),
        pin({ id: 'p2', roomId: undefined, photoKeys: ['k9'], sketches: { k9: [mark({ id: 'm3' })] } }),
      ],
    })
    expect(markRows(d)).toEqual([
      { pin: 1, roomCode: 'SE', photoIndex: 2, valueCm: 120.3, label: '', note: 'pipe' },
      { pin: 1, roomCode: 'SE', photoIndex: 2, valueCm: 400, label: 'SE-1', note: '' },
      { pin: 2, roomCode: '', photoIndex: 1, valueCm: null, label: '', note: '' },
    ])
  })

  it('is empty when no pin has a mark', () => {
    expect(markRows(doc({ pins: [pin()] }))).toEqual([])
    expect(markRows(doc())).toEqual([])
  })
})
