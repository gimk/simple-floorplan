import { beforeEach, describe, expect, it } from 'vitest'
import { parseProjectDoc } from './schema'
import { artboardFrame } from '../features/artboards/frame'
import { ARTBOARD_GAP_CM, cloneDoc, docBounds, useDoc } from './store'
import { parseProjectJson, serializeProject } from '../sync/jsonFile'
import type { RefImage } from './types'

const s = () => useDoc.getState()
const past = () => useDoc.temporal.getState().pastStates.length

const img = (id = 'img1'): RefImage => ({
  id, name: 'plan.png', src: 'data:image/png;base64,AA==', naturalWidth: 100, naturalHeight: 50,
  xCm: 0, yCm: 0, cmPerPx: 2, rotationDeg: 0, opacity: 0.5, visible: true, locked: false,
})

beforeEach(() => { s().resetDoc() })

describe('undo / redo', () => {
  it('update is one undo step; undo and redo restore it', () => {
    s().setTitle('A')
    s().setTitle('B')
    expect(s().doc.title).toBe('B')
    s().undo()
    expect(s().doc.title).toBe('A')
    s().redo()
    expect(s().doc.title).toBe('B')
    s().undo(); s().undo()
    expect(s().doc.title).toBe('Untitled project')
  })

  it('hydrate and resetDoc clear history', () => {
    s().setTitle('A')
    expect(past()).toBe(1)
    s().resetDoc()
    expect(past()).toBe(0)
  })
})

describe('drag batching', () => {
  it('many updateSilent between beginDrag/endDrag is one undo step', () => {
    s().update((d) => { d.artboards[0].rooms.push({ id: 'r', name: 'R', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }) })
    const before = past()
    s().beginDrag()
    for (let i = 1; i <= 10; i++) s().updateSilent((d) => { d.artboards[0].rooms[0].vertices[0].x = i * 10 })
    expect(past()).toBe(before)
    s().endDrag()
    expect(past()).toBe(before + 1)
    expect(s().doc.artboards[0].rooms[0].vertices[0].x).toBe(100)
    s().undo()
    expect(s().doc.artboards[0].rooms[0].vertices[0].x).toBe(0)
    s().redo()
    expect(s().doc.artboards[0].rooms[0].vertices[0].x).toBe(100)
  })

  it('a drag that changes nothing adds no undo step', () => {
    const before = past()
    s().beginDrag()
    s().endDrag()
    expect(past()).toBe(before)
  })

  it('tracking resumes after updateSilent', () => {
    s().updateSilent((d) => { d.title = 'quiet' })
    const before = past()
    s().setTitle('loud')
    expect(past()).toBe(before + 1)
  })
})

describe('artboards', () => {
  it('duplicateArtboard deep clones with new ids, offset to the right', () => {
    s().update((d) => {
      const a = d.artboards[0]
      a.rooms.push({ id: 'r1', name: 'Room', vertices: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 0, y: 300 }] })
      a.openings.push({ id: 'o1', kind: 'door', xCm: 100, yCm: 0, angleDeg: 0, widthCm: 90 })
      a.furniture.push({ id: 'f1', name: 'Bed', shape: 'rect', xCm: 50, yCm: 50, widthCm: 160, depthCm: 200, rotationDeg: 0, color: '#fff' })
    })
    const src = s().doc.artboards[0]
    const newId = s().duplicateArtboard(src.id)!
    const copy = s().doc.artboards.find((a) => a.id === newId)!
    expect(copy.name).toBe('Plan A (copy)')
    // source frame ends at 600 + 40; the copy frame starts 150 later. The bed reaches x = -30,
    // so the frame starts 70 left of the origin: copy origin = 640 + 150 + 70
    expect(copy.xCm).toBe(640 + 150 + 70)
    expect(copy.rooms[0].id).not.toBe('r1')
    expect(copy.openings[0].id).not.toBe('o1')
    expect(copy.furniture[0].id).not.toBe('f1')
    expect(copy.rooms[0].vertices).toEqual(src.rooms[0].vertices)
    // deep clone: editing the copy leaves the source untouched
    s().update((d) => { d.artboards[1].rooms[0].vertices[0].x = 99 })
    expect(s().doc.artboards[0].rooms[0].vertices[0].x).toBe(0)
    expect(parseProjectDoc(s().doc).ok).toBe(true)
    expect(s().duplicateArtboard('nope')).toBeNull()
  })

  it('deleteArtboard keeps at least one', () => {
    const first = s().doc.artboards[0].id
    s().deleteArtboard(first)
    expect(s().doc.artboards).toHaveLength(1)
    const added = s().addArtboard()
    expect(s().doc.artboards).toHaveLength(2)
    s().deleteArtboard(added)
    expect(s().doc.artboards.map((a) => a.id)).toEqual([first])
  })

  it('addArtboard places the new artboard to the right', () => {
    const id = s().addArtboard()
    const a = s().doc.artboards.find((x) => x.id === id)!
    expect(a.xCm).toBeGreaterThan(0)
    expect(a.ceilingHeightCm).toBe(250)
  })

  it('addArtboard and duplicateArtboard never overlap any frame', () => {
    s().update((d) => {
      d.artboards[0].rooms.push({ id: 'r1', name: 'R', vertices: [{ x: -300, y: -100 }, { x: 900, y: -100 }, { x: 900, y: 500 }, { x: -300, y: 500 }] })
    })
    s().addArtboard()
    s().duplicateArtboard(s().doc.artboards[0].id)
    s().addArtboard()
    const frames = s().doc.artboards.map((a) => artboardFrame(a))
    for (let i = 1; i < frames.length; i++) {
      const maxPrev = Math.max(...frames.slice(0, i).map((f) => f.maxX))
      expect(frames[i].x - maxPrev).toBeGreaterThanOrEqual(ARTBOARD_GAP_CM - 1e-9)
    }
  })

  it('docBounds covers every frame and its header', () => {
    s().addArtboard()
    const b = docBounds(s().doc)
    for (const a of s().doc.artboards) {
      const f = artboardFrame(a)
      expect(b.minX).toBeLessThanOrEqual(f.minX)
      expect(b.minY).toBeLessThan(f.minY)
      expect(b.maxX).toBeGreaterThanOrEqual(f.maxX)
      expect(b.maxY).toBeGreaterThanOrEqual(f.maxY)
    }
  })

  it('addArtboard works when the document has no artboard', () => {
    s().update((d) => { d.artboards = [] })
    const id = s().addArtboard()
    const a = s().doc.artboards.find((x) => x.id === id)!
    // No right edge to sit next to: the artboard starts at the origin.
    expect(a.xCm).toBe(0)
    expect(a.yCm).toBe(0)
    expect(Number.isFinite(a.xCm)).toBe(true)
  })
})

describe('undo guard and clone', () => {
  it('cloneDoc shares ref image src strings but not objects', () => {
    s().addRefImage(img())
    const c = cloneDoc(s().doc)
    expect(c).toEqual(s().doc)
    expect(c.refImages[0]).not.toBe(s().doc.refImages[0])
    expect(c.artboards[0]).not.toBe(s().doc.artboards[0])
  })

  it('undo and redo do nothing while a drag is open', () => {
    s().setTitle('A')
    s().beginDrag()
    s().undo()
    expect(s().doc.title).toBe('A')
    s().endDrag()
    s().undo()
    expect(s().doc.title).toBe('Untitled project')
  })

  it('endDrag keeps at most 100 undo steps', () => {
    for (let i = 0; i < 105; i++) s().setTitle(`t${i}`)
    s().beginDrag()
    s().updateSilent((d) => { d.title = 'drag' })
    s().endDrag()
    expect(past()).toBeLessThanOrEqual(100)
  })
})

describe('ref images', () => {
  it('add, update, delete', () => {
    s().addRefImage(img())
    s().updateRefImage('img1', { opacity: 0.2, locked: true })
    expect(s().doc.refImages[0]).toMatchObject({ opacity: 0.2, locked: true })
    s().deleteRefImage('img1')
    expect(s().doc.refImages).toHaveLength(0)
  })
})

describe('JSON round trip', () => {
  it('serialize then parse gives the same doc', () => {
    s().addRefImage(img())
    s().duplicateArtboard(s().doc.artboards[0].id)
    const r = parseProjectJson(serializeProject(s().doc))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc).toEqual(s().doc)
  })

  it('rejects bad JSON and invalid docs', () => {
    expect(parseProjectJson('{nope').ok).toBe(false)
    expect(parseProjectJson('{"schemaVersion":3}').ok).toBe(false)
  })
})
