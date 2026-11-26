import { describe, expect, it } from 'vitest'
import { convertV1ToV2, isV1Export } from './convertV1'
import { parseProjectDoc } from '../model/schema'
import { area, signedArea } from '../model/geometry'

const v = (id: string, x: number, y: number) => ({ id, x, y })
// 400x300 room at (1000, 500) and a 200x200 room beside it. First room is stored counter-clockwise on screen.
const v1Doc = (extra: object = {}) => ({
  schemaVersion: 2,
  title: 'Test flat',
  rooms: [
    { id: 'r1', name: 'Living', vertices: [v('a', 1000, 500), v('b', 1000, 800), v('c', 1400, 800), v('d', 1400, 500)] },
    { id: 'r2', name: 'Bath', vertices: [v('e', 1400, 500), v('f', 1600, 500), v('g', 1600, 700), v('h', 1400, 700)] },
  ],
  elements: [
    { id: 'e1', roomId: 'r2', wallStart: 'e', kind: 'door', widthCm: 80, alongCm: 10, swing: 'out' },
    { id: 'e2', roomId: 'r1', wallStart: 'b', kind: 'window', widthCm: 100, alongCm: 50, variant: 'sliding' },
  ],
  background: { src: '', naturalWidth: 100, naturalHeight: 50, xCm: 900, yCm: 400, cmPerPx: 2, rotationDeg: 5, opacity: 0.3, visible: true, locked: false },
  ...extra,
})
const bundle = () => ({
  snapshots: [
    { version: 2, data: v1Doc({ title: 'Newest' }) },
    { version: 1, data: v1Doc({ title: 'Old' }) },
  ],
})

describe('isV1Export', () => {
  it('accepts a v1 bundle and a v1 doc', () => {
    expect(isV1Export(bundle())).toBe(true)
    expect(isV1Export(v1Doc())).toBe(true)
  })
  it('rejects v2 docs and garbage', () => {
    expect(isV1Export({ schemaVersion: 3, id: 'x', title: '', refImages: [], artboards: [] })).toBe(false)
    expect(isV1Export(null)).toBe(false)
    expect(isV1Export('text')).toBe(false)
    expect(isV1Export({ snapshots: [] })).toBe(false)
  })
})

describe('convertV1ToV2', () => {
  it('uses the latest snapshot and passes the schema', () => {
    const doc = convertV1ToV2(bundle())
    expect(doc.schemaVersion).toBe(3)
    expect(doc.title).toBe('Newest')
    expect(parseProjectDoc(doc).ok).toBe(true)
  })
  it('converts rooms: names, origin shift, clockwise, area kept', () => {
    const [ab] = convertV1ToV2(v1Doc()).artboards
    expect(ab.rooms.map((r) => r.name)).toEqual(['Living', 'Bath'])
    const xs = ab.rooms.flatMap((r) => r.vertices.map((p) => p.x)), ys = ab.rooms.flatMap((r) => r.vertices.map((p) => p.y))
    expect(Math.min(...xs)).toBe(0)
    expect(Math.min(...ys)).toBe(0)
    expect(area(ab.rooms[0].vertices)).toBe(120000)
    expect(area(ab.rooms[1].vertices)).toBe(40000)
    for (const r of ab.rooms) expect(signedArea(r.vertices)).toBeGreaterThan(0)
  })
  it('converts doors and windows to artboard-local openings', () => {
    const [ab] = convertV1ToV2(v1Doc()).artboards
    const door = ab.openings.find((o) => o.id === 'e1')!
    expect(door).toMatchObject({ kind: 'door', widthCm: 80, angleDeg: 0, swing: 'out', xCm: 450, yCm: 0 })
    const win = ab.openings.find((o) => o.id === 'e2')!
    // wall b->c runs along +x at y=800 -> local y=300; centre = 1000 + 50 + 50 shifted by 1000
    expect(win).toMatchObject({ kind: 'window', variant: 'sliding', widthCm: 100, angleDeg: 0, xCm: 100, yCm: 300 })
  })
  it('places the reference image in shifted coordinates', () => {
    const doc = convertV1ToV2(v1Doc(), { refImageDataUrl: 'data:image/webp;base64,AAAA', refImageName: 'scan.webp' })
    expect(doc.refImages).toHaveLength(1)
    expect(doc.refImages[0]).toMatchObject({ name: 'scan.webp', xCm: -100, yCm: -100, cmPerPx: 2, rotationDeg: 5, opacity: 0.3 })
  })
  it('omits the reference image without a data URL', () => {
    expect(convertV1ToV2(v1Doc()).refImages).toEqual([])
  })
  it('throws on non-v1 input', () => {
    expect(() => convertV1ToV2({ foo: 1 })).toThrow()
  })
})
