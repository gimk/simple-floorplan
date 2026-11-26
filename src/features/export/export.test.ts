// Unit tests of the artboard export renderer: pure functions, so they run in the node environment.
import { describe, expect, it } from 'vitest'
import type { Artboard, FurnitureItem, Opening, Room } from '../../model/types'
import { renderArtboardSvg, slugFilename } from './artboardSvg'

const rect = (id: string, name: string, x0: number, y0: number, x1: number, y1: number, fill?: string): Room => ({
  id,
  name,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  ...(fill ? { fill } : {}),
})

const door = (p: Partial<Opening> = {}): Opening => ({
  id: 'd1', kind: 'door', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 85, hinge: 'left', swing: 'in', ...p,
})
const windowOp = (p: Partial<Opening> = {}): Opening => ({
  id: 'w1', kind: 'window', xCm: 550, yCm: 0, angleDeg: 0, widthCm: 120, ...p,
})
const gap = (p: Partial<Opening> = {}): Opening => ({
  id: 'g1', kind: 'opening', xCm: 700, yCm: 150, angleDeg: 90, widthCm: 100, ...p,
})

const chair = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Chair', shape: 'rect', xCm: 60, yCm: 60, widthCm: 60, depthCm: 40,
  rotationDeg: 0, color: '#c2410c', ...p,
})
const table = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f2', name: 'Round table', shape: 'circle', xCm: 250, yCm: 200, widthCm: 80, depthCm: 80,
  rotationDeg: 15, color: '#0ea5e9', ...p,
})

const artboard = (p: Partial<Artboard> = {}): Artboard => ({
  id: 'ab1', name: 'Ground floor', xCm: 1000, yCm: 2000, ceilingHeightCm: 250, precisionCm: 1,
  rooms: [], openings: [], furniture: [], ...p,
})

/** Two rooms (400x300 and 300x300), three openings, one rect and one circle furniture item. */
const populated = () => artboard({
  rooms: [rect('r1', 'Living', 0, 0, 400, 300, '#22d3ee'), rect('r2', 'Kitchen', 400, 0, 700, 300)],
  openings: [door(), windowOp(), gap()],
  furniture: [chair(), table()],
})

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe('slugFilename', () => {
  it('lowercases and joins words with one dash', () => {
    expect(slugFilename('My Plan', 'svg')).toBe('my-plan.svg')
    expect(slugFilename('RDC   niveau 1', 'png')).toBe('rdc-niveau-1.png')
  })
  it('drops accents and punctuation', () => {
    expect(slugFilename('Étage 1 : Séjour & Cuisine !', 'svg')).toBe('etage-1-sejour-cuisine.svg')
    expect(slugFilename('Chambre (n°2) — "sud"', 'png')).toBe('chambre-n-2-sud.png')
  })
  it('trims leading and trailing separators', () => {
    expect(slugFilename('  ---Plan---  ', 'svg')).toBe('plan.svg')
  })
  it('falls back to floorplan when nothing usable is left', () => {
    expect(slugFilename('', 'svg')).toBe('floorplan.svg')
    expect(slugFilename('', 'png')).toBe('floorplan.png')
    expect(slugFilename('   ', 'png')).toBe('floorplan.png')
    expect(slugFilename('!!! ??? ...', 'svg')).toBe('floorplan.svg')
  })
  it('keeps the extension asked for and never returns a path', () => {
    expect(slugFilename('a/b\\c', 'png')).toBe('a-b-c.png')
    expect(slugFilename('plan', 'png').endsWith('.png')).toBe(true)
    expect(slugFilename('plan', 'svg').endsWith('.svg')).toBe(true)
  })
})

describe('renderArtboardSvg', () => {
  it('renders a standalone SVG 1.1 document with a dark page', () => {
    const { svg, widthPx, heightPx } = renderArtboardSvg(populated())
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('version="1.1"')
    expect(svg).toContain(`width="${widthPx}"`)
    expect(svg).toContain(`height="${heightPx}"`)
    expect(svg).toContain('viewBox="')
    expect(svg).toContain('fill="#12161b"')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(widthPx).toBeGreaterThan(0)
    expect(heightPx).toBeGreaterThan(0)
  })

  it('writes the artboard name, the project title and the total area in the header', () => {
    const { svg } = renderArtboardSvg(populated(), { projectTitle: 'Villa Sud' })
    expect(svg).toContain('>Ground floor</text>')
    expect(svg).toContain('>Villa Sud</text>')
    expect(svg).toContain('<title>Villa Sud — Ground floor</title>')
    // 400x300 + 300x300 cm = 21 m².
    expect(svg).toContain('>21 m²</text>')
  })

  it('renders rooms with their own fill at 0.28 and a default fill otherwise', () => {
    const { svg } = renderArtboardSvg(populated())
    expect(svg).toContain('data-room="r1"')
    expect(svg).toContain('fill="#22d3ee" fill-opacity="0.28"')
    expect(svg).toContain('fill="rgba(255,255,255,0.04)"')
    // Page scale stays 2 px/cm here, so a 1.5px outline is 0.75 cm wide in the viewBox.
    expect(count(svg, '<polygon data-room=')).toBe(2)
    expect(count(svg, 'stroke="#e4e4e7" stroke-width="0.75"')).toBeGreaterThanOrEqual(2)
    // Name and area of each room, in m²: 12 and 9.
    expect(svg).toContain('>Living</text>')
    expect(svg).toContain('>12 m²</text>')
    expect(svg).toContain('>Kitchen</text>')
    expect(svg).toContain('>9 m²</text>')
  })

  it('renders wall length labels in cm', () => {
    const { svg } = renderArtboardSvg(populated())
    expect(svg).toContain('>400 cm</text>')
    expect(svg).toContain('>300 cm</text>')
    // 8 walls, but the wall shared by the two rooms is printed once: 7 labels.
    expect(count(svg, ' cm</text>')).toBe(7)
    expect(count(svg, '>300 cm</text>')).toBe(5)
    expect(count(svg, '>400 cm</text>')).toBe(2)
  })

  it('labels a wall shared by two rooms only once', () => {
    const shared = artboard({ rooms: [rect('r1', 'A', 0, 0, 400, 300), rect('r2', 'B', 400, 0, 700, 300)] })
    const svg = renderArtboardSvg(shared).svg
    // The x = 400 wall goes from (400,0) to (400,300): one label, on the first room that has it.
    expect(count(svg, '>300 cm</text>')).toBe(5)
    expect(count(svg, ' cm</text>')).toBe(7)
  })

  it('renders doors, windows and plain gaps on top of the rooms', () => {
    const { svg } = renderArtboardSvg(populated())
    expect(svg).toContain('data-opening="d1" data-kind="door"')
    expect(svg).toContain('data-opening="w1" data-kind="window"')
    expect(svg).toContain('data-opening="g1" data-kind="opening"')
    // Door leaf and swing arc (quarter circle: A r r 0 0 sweep x y).
    expect(svg).toContain('A 85 85 0 0 1 157.5 85')
    // The door leaf leaves the hinge at 90 degrees.
    expect(svg).toContain('<line x1="157.5" y1="0" x2="157.5" y2="85"')
    // A window frame is a double line: a centre line plus one line on each side.
    expect(svg).toContain('<line x1="490" y1="1.25" x2="610" y2="1.25"')
    expect(svg).toContain('<line x1="490" y1="-1.25" x2="610" y2="-1.25"')
    // Openings come after the rooms and the furniture, so they sit on top.
    expect(svg.indexOf('data-opening="d1"')).toBeGreaterThan(svg.indexOf('data-furniture="f1"'))
    expect(svg.indexOf('data-opening="d1"')).toBeGreaterThan(svg.indexOf('data-room="r1"'))
    // Every opening first clears the wall with a background-coloured gap line.
    expect(svg).toContain('<line x1="157.5" y1="0" x2="242.5" y2="0" stroke="#12161b" stroke-width="1.5" />')
    expect(svg).toContain('<line x1="490" y1="0" x2="610" y2="0" stroke="#12161b" stroke-width="1.5" />')
    expect(svg).toContain('<line x1="700" y1="100" x2="700" y2="200" stroke="#12161b" stroke-width="1.5" />')
  })

  it('renders rect furniture with its default corner radius and circle furniture as an ellipse', () => {
    const { svg } = renderArtboardSvg(populated())
    expect(svg).toContain('data-furniture="f1" transform="translate(60 60) rotate(0)"')
    // Default 4 cm radius, as on the canvas.
    expect(svg).toContain('<rect x="-30" y="-20" width="60" height="40" rx="4" ry="4"')
    expect(svg).toContain('fill="#c2410c" fill-opacity="0.78"')
    expect(svg).toContain('>Chair</text>')
    expect(svg).toContain('data-furniture="f2" transform="translate(250 200) rotate(15)"')
    expect(svg).toContain('<ellipse cx="0" cy="0" rx="40" ry="40"')
    expect(svg).toContain('>Round table</text>')
  })

  it('draws the subtle direction arrow only when showDirection is true', () => {
    const off = renderArtboardSvg(artboard({ furniture: [chair()] })).svg
    expect(off).not.toContain('stroke-opacity="0.55"')
    expect(off).not.toContain('<path d="M -2.25')

    const hidden = renderArtboardSvg(artboard({ furniture: [chair({ showDirection: false })] })).svg
    expect(hidden).not.toContain('stroke-opacity="0.55"')

    // Front edge on local -Y: a small chevron, 45 degree wings, white at 0.55 opacity.
    // The 400 x 300 room keeps the scale at 2 px/cm, so the arrow is 9 px wide over 4 cm.
    const { svg } = renderArtboardSvg(
      artboard({ rooms: [rect('r1', 'Living', 0, 0, 400, 300)], furniture: [chair({ showDirection: true })] }),
    )
    expect(svg).toContain(
      '<path d="M -2.25 -15.75 L 0 -18 L 2.25 -15.75" fill="none" stroke="#f4f4f5" ' +
        'stroke-opacity="0.55" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round" />',
    )
    // One arrow only, and it sits above the item label in the drawing order.
    expect(count(svg, 'stroke-opacity="0.55"')).toBe(1)
    expect(svg.indexOf('stroke-opacity="0.55"')).toBeLessThan(svg.indexOf('>Chair</text>'))
  })

  it('applies a custom corner radius on rect furniture, clamped to half the shorter side', () => {
    const custom = renderArtboardSvg(artboard({ furniture: [chair({ cornerRadiusCm: 12 })] })).svg
    expect(custom).toContain('<rect x="-30" y="-20" width="60" height="40" rx="12" ry="12"')
    expect(custom).not.toContain('rx="1.5"')

    const zero = renderArtboardSvg(artboard({ furniture: [chair({ cornerRadiusCm: 0 })] })).svg
    expect(zero).toContain('<rect x="-30" y="-20" width="60" height="40" rx="0" ry="0"')

    // 60 x 40: the radius can never pass 20 cm (half the depth).
    const huge = renderArtboardSvg(artboard({ furniture: [chair({ cornerRadiusCm: 500 })] })).svg
    expect(huge).toContain('<rect x="-30" y="-20" width="60" height="40" rx="20" ry="20"')
  })

  it('escapes special characters in the artboard, project, room and furniture names', () => {
    const { svg } = renderArtboardSvg(
      artboard({
        name: 'A & B <home>',
        rooms: [rect('r1', 'Tom & Jerry\'s <room>', 0, 0, 400, 300)],
        furniture: [chair({ name: '"Sofa" & <chair>' })],
      }),
      { projectTitle: 'R&D "main" <plan>' },
    )
    expect(svg).toContain('>A &amp; B &lt;home&gt;</text>')
    expect(svg).toContain('>R&amp;D &quot;main&quot; &lt;plan&gt;</text>')
    expect(svg).toContain('>Tom &amp; Jerry&apos;s &lt;room&gt;</text>')
    expect(svg).toContain('>&quot;Sofa&quot; &amp; &lt;chair&gt;</text>')
    expect(svg).not.toContain('<home>')
    expect(svg).not.toContain('R&D')
    expect(svg).not.toContain('<room>')
  })

  it('keeps accents as they are (valid UTF-8 text, no escaping)', () => {
    const { svg } = renderArtboardSvg(artboard({ name: 'Séjour été', rooms: [rect('r1', 'Chambre 1', 0, 0, 400, 300)] }))
    expect(svg).toContain('>Séjour été</text>')
    expect(svg).toContain('m²')
  })

  it('omits furniture when includeFurniture is false', () => {
    const { svg } = renderArtboardSvg(populated(), { includeFurniture: false })
    expect(svg).not.toContain('data-furniture')
    expect(svg).not.toContain('>Chair</text>')
    expect(svg).not.toContain('>Round table</text>')
    expect(svg).not.toContain('<ellipse')
    // Rooms and openings are still there.
    expect(svg).toContain('data-room="r1"')
    expect(svg).toContain('data-opening="w1"')
  })

  it('omits wall length labels when includeWallLabels is false', () => {
    const { svg } = renderArtboardSvg(populated(), { includeWallLabels: false })
    expect(svg).not.toContain(' cm</text>')
    expect(svg).not.toContain('>400 cm<')
    // Room names, areas and openings stay.
    expect(svg).toContain('>Living</text>')
    expect(svg).toContain('>12 m²</text>')
    expect(svg).toContain('data-opening="d1"')
  })

  it('renders an empty artboard as a valid page with non-zero size', () => {
    const { svg, widthPx, heightPx } = renderArtboardSvg(artboard({ name: 'Empty' }))
    expect(svg).toContain('>Empty</text>')
    expect(svg).toContain('>0 m²</text>')
    expect(svg).not.toContain('data-room')
    expect(svg).not.toContain('data-opening')
    expect(svg).not.toContain('data-furniture')
    expect(widthPx).toBeGreaterThan(0)
    expect(heightPx).toBeGreaterThan(0)
    expect(svg.startsWith('<?xml')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('ignores furniture in the frame when it is hidden, so the content stays tight', () => {
    const far = artboard({ rooms: [rect('r1', 'Room', 0, 0, 200, 200)], furniture: [chair({ xCm: 4000, yCm: 4000 })] })
    const withFurniture = renderArtboardSvg(far)
    const withoutFurniture = renderArtboardSvg(far, { includeFurniture: false })
    expect(withFurniture.widthPx).toBeGreaterThan(withoutFurniture.widthPx * 2)
    expect(withoutFurniture.svg).not.toContain('data-furniture')
  })

  it('keeps the longest side between 800 and 2400 px', () => {
    const tiny = renderArtboardSvg(artboard({ rooms: [rect('r1', 'Small', 0, 0, 20, 20)] }))
    expect(Math.max(tiny.widthPx, tiny.heightPx)).toBeGreaterThanOrEqual(800)
    expect(Math.max(tiny.widthPx, tiny.heightPx)).toBeLessThanOrEqual(2400)
    const huge = renderArtboardSvg(artboard({ rooms: [rect('r1', 'Huge', 0, 0, 5000, 5000)] }))
    expect(Math.max(huge.widthPx, huge.heightPx)).toBeGreaterThanOrEqual(800)
    expect(Math.max(huge.widthPx, huge.heightPx)).toBeLessThanOrEqual(2400)
    // A normal plan keeps the 2 px/cm scale: 700x300 cm of content, plus padding and header.
    const normal = renderArtboardSvg(populated())
    expect(normal.widthPx).toBe(Math.round(780 * 2))
  })

  it('keeps a door swing that opens outside the room inside the sheet', () => {
    const out = renderArtboardSvg(artboard({
      rooms: [rect('r1', 'Room', 0, 0, 400, 300)],
      openings: [door({ xCm: 200, yCm: 0, swing: 'out', widthCm: 85 })],
    }))
    // The open leaf goes 85 cm above the top wall: the drawing must include it.
    expect(out.heightPx).toBeGreaterThan(2 * (300 + 85 + 40 + 44) - 10)
    expect(out.svg).toContain('data-kind="door"')
  })

  it('does not need a DOM and gives the same output twice', () => {
    const a = renderArtboardSvg(populated())
    const b = renderArtboardSvg(populated())
    expect(a.svg).toBe(b.svg)
    expect(a.widthPx).toBe(b.widthPx)
  })
})
