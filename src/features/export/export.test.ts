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
  id: 'ab1', name: 'Ground floor', xCm: 1000, yCm: 2000, ceilingHeightCm: 250, precisionCm: 1, wallThicknessCm: 0,
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

  it('emits a <pattern> def and a url fill when a room has a floor pattern', () => {
    const r = { ...rect('r1', 'Kitchen', 0, 0, 400, 300, '#8a6b4a'), floorPattern: 'wood' as const }
    const { svg } = renderArtboardSvg(artboard({ rooms: [r] }))
    expect(svg).toContain('<pattern id="floor-r1"')
    expect(svg).toContain('fill="url(#floor-r1)"')
    expect(svg).not.toContain('<pattern id="floor-r2"')
  })

  it('draws a painted wall stroke when a room has wallColors', () => {
    const r = { ...rect('r1', 'Kitchen', 0, 0, 400, 300), wallColors: { '1': '#b85d43' } }
    const { svg } = renderArtboardSvg(artboard({ rooms: [r] }))
    expect(svg).toContain('data-wall-paint="r1:1"')
    expect(svg).toContain('stroke="#b85d43"')
    expect(svg).not.toContain('data-wall-paint="r1:0"')
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
    // Default 4 cm radius, as on the canvas: one path with an arc per corner.
    expect(svg).toContain(
      '<path d="M -30 -16 A 4 4 0 0 1 -26 -20 L 26 -20 A 4 4 0 0 1 30 -16 ' +
        'L 30 16 A 4 4 0 0 1 26 20 L -26 20 A 4 4 0 0 1 -30 16 Z" fill="#c2410c" fill-opacity="0.78"',
    )
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
    expect(custom).toContain(
      '<path d="M -30 -8 A 12 12 0 0 1 -18 -20 L 18 -20 A 12 12 0 0 1 30 -8 ' +
        'L 30 8 A 12 12 0 0 1 18 20 L -18 20 A 12 12 0 0 1 -30 8 Z"',
    )
    expect(custom).not.toContain('A 4 4 0 0 1')

    // Radius 0: a sharp rectangle, so no arc at all.
    const zero = renderArtboardSvg(artboard({ furniture: [chair({ cornerRadiusCm: 0 })] })).svg
    expect(zero).toContain('<path d="M -30 -20 L 30 -20 L 30 20 L -30 20 Z"')
    expect(zero).not.toContain(' A ')

    // 60 x 40: the radius can never pass 20 cm (half the depth).
    const huge = renderArtboardSvg(artboard({ furniture: [chair({ cornerRadiusCm: 500 })] })).svg
    expect(huge).toContain(
      '<path d="M -30 0 A 20 20 0 0 1 -10 -20 L 10 -20 A 20 20 0 0 1 30 0 ' +
        'A 20 20 0 0 1 10 20 L -10 20 A 20 20 0 0 1 -30 0 Z"',
    )
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

/** The markup of one opening group, from its data-opening attribute to the next opening. */
const groupOf = (svg: string, id: string): string => {
  const from = svg.indexOf(`data-opening="${id}"`)
  const to = svg.indexOf('data-opening="', from + 1)
  return svg.slice(from, to < 0 ? undefined : to)
}

describe('renderArtboardSvg opening variants', () => {
  const oneDoor = (p: Partial<Opening> = {}) =>
    renderArtboardSvg(artboard({ rooms: [rect('r1', 'Living', 0, 0, 400, 300)], openings: [door(p)] })).svg
  const oneWindow = (p: Partial<Opening> = {}) =>
    renderArtboardSvg(artboard({ rooms: [rect('r1', 'Living', 0, 0, 400, 300)], openings: [windowOp({ xCm: 200, ...p })] })).svg

  it('writes the style of the opening in the group', () => {
    expect(oneDoor()).toContain('data-opening="d1" data-kind="door" data-variant="standard"')
    expect(oneDoor({ variant: 'french' })).toContain('data-variant="french"')
    expect(oneWindow()).toContain('data-opening="w1" data-kind="window" data-variant="standard"')
    expect(oneWindow({ variant: 'sliding' })).toContain('data-variant="sliding"')
    expect(oneWindow({ variant: 'casement' })).toContain('data-variant="casement"')
    expect(oneWindow({ variant: 'double-casement' })).toContain('data-variant="double-casement"')
  })

  it('draws a standard door with one leaf and one quarter-circle arc', () => {
    const g = groupOf(oneDoor(), 'd1')
    expect(count(g, ' A ')).toBe(1)
    expect(count(g, '<polygon')).toBe(0)
    expect(g).toContain('A 85 85 0 0 1 157.5 85')
  })

  it('draws a french door with two half-width leaves and two arcs meeting in the middle', () => {
    const g = groupOf(oneDoor({ variant: 'french' }), 'd1')
    // Two leaves, each half the 85 cm width, hinged at the two ends of the opening.
    expect(count(g, 'stroke-linecap="round"')).toBe(2)
    expect(g).toContain('<line x1="157.5" y1="0" x2="157.5" y2="42.5"')
    expect(g).toContain('<line x1="242.5" y1="0" x2="242.5" y2="42.5"')
    // Two quarter-circle arcs of radius 42.5 that both start at the centre (200, 0).
    expect(count(g, ' A ')).toBe(2)
    expect(g).toContain('A 42.5 42.5 0 0 1 157.5 42.5')
    expect(g).toContain('A 42.5 42.5 0 0 0 242.5 42.5')
    expect(count(g, 'M 200 0 A ')).toBe(2)
    // A french door has no single full-width leaf and no wall line.
    expect(g).not.toContain('A 85 85')
  })

  it('draws a pocket door with a sliding leaf, a dashed pocket receiver and a slide line', () => {
    const g = groupOf(oneDoor({ variant: 'pocket' }), 'd1')
    // The 1px line of the gap through the wall stays, as on the canvas.
    expect(g).toContain('<line x1="157.5" y1="0" x2="242.5" y2="0" stroke="#e4e4e7" stroke-width="0.5" />')
    // One panel and one dashed receiver box, on the hinge side of the opening.
    expect(count(g, '<polygon')).toBe(2)
    expect(count(g, 'stroke-dasharray')).toBe(1)
    expect(g).toContain('<polygon points="157.5,1.25 204.25,1.25 204.25,2.75 157.5,2.75"')
    expect(g).toContain('<polygon points="157.5,0.95 132,0.95 132,3.05 157.5,3.05" fill="none"')
    // The dashed box belongs to the pocket, not to the leaf.
    expect(g.indexOf('stroke-dasharray')).toBeGreaterThan(g.indexOf('157.5,1.25'))
    // A short slide-direction line inside the pocket, parallel to the wall.
    expect(g).toContain('<line x1="154.44" y1="2" x2="139.14" y2="2"')
    // No swing arc on a sliding door.
    expect(count(g, ' A ')).toBe(0)
  })

  it('draws a bypass door with two parallel panels that overlap in the middle', () => {
    const g = groupOf(oneDoor({ variant: 'bypass' }), 'd1')
    expect(count(g, '<polygon')).toBe(2)
    expect(count(g, 'stroke-dasharray')).toBe(0)
    // 55% of 85 cm = 46.75 cm per panel, one on each side of the wall line.
    expect(g).toContain('<polygon points="157.5,0.75 204.25,0.75 204.25,2.25 157.5,2.25"')
    expect(g).toContain('<polygon points="195.75,-2.25 242.5,-2.25 242.5,-0.75 195.75,-0.75"')
    expect(count(g, ' A ')).toBe(0)
  })

  it('draws a sliding window with two staggered sashes, and a standard window with three lines', () => {
    const sliding = groupOf(oneWindow({ variant: 'sliding' }), 'w1')
    expect(count(sliding, '<polygon')).toBe(2)
    // 62% of 120 cm = 74.4 cm per sash, staggered on either side of the wall line.
    expect(sliding).toContain('<polygon points="140,1 214.4,1 214.4,2.5 140,2.5"')
    expect(sliding).toContain('<polygon points="185.6,-2.5 260,-2.5 260,-1 185.6,-1"')
    expect(sliding).toContain('<line x1="140" y1="0" x2="260" y2="0" stroke="#e4e4e7" stroke-width="0.5" />')

    const standard = groupOf(oneWindow(), 'w1')
    expect(count(standard, '<polygon')).toBe(0)
    expect(count(standard, 'stroke-width="0.75"')).toBe(1)
    expect(standard).toContain('<line x1="140" y1="1.25" x2="260" y2="1.25"')
    expect(standard).toContain('<line x1="140" y1="-1.25" x2="260" y2="-1.25"')
  })

  it('draws a single casement window with the frame, one sash leaf and one swing arc', () => {
    const g = groupOf(oneWindow({ variant: 'casement', hinge: 'left', swing: 'in' }), 'w1')
    // The three frame lines stay, plus one full-width sash leaf of 0.6 cm stroke (1.2 px).
    expect(count(g, 'stroke-width="0.75"')).toBe(1)
    expect(g).toContain('<line x1="140" y1="1.25" x2="260" y2="1.25"')
    expect(g).toContain('<line x1="140" y1="-1.25" x2="260" y2="-1.25"')
    expect(g).toContain('<line x1="140" y1="0" x2="140" y2="120"')
    // One quarter-circle arc of radius 120 from the free end to the open tip.
    expect(count(g, ' A ')).toBe(1)
    expect(g).toContain('M 260 0 A 120 120 0 0 1 140 120')
    expect(count(g, '<polygon')).toBe(0)
  })

  it('draws a double casement window with the frame, two half-width leaves and two arcs', () => {
    const g = groupOf(oneWindow({ variant: 'double-casement', swing: 'in' }), 'w1')
    expect(count(g, 'stroke-width="0.75"')).toBe(1)
    expect(g).toContain('<line x1="140" y1="0" x2="140" y2="60"')
    expect(g).toContain('<line x1="260" y1="0" x2="260" y2="60"')
    // Two arcs of radius 60 that both start at the centre of the opening.
    expect(count(g, ' A ')).toBe(2)
    expect(count(g, 'M 200 0 A ')).toBe(2)
    expect(g).toContain('A 60 60 0 0 1 140 60')
    expect(g).toContain('A 60 60 0 0 0 260 60')
    expect(count(g, '<polygon')).toBe(0)
  })

  it('keeps a casement sash that swings outwards inside the sheet', () => {
    const out = renderArtboardSvg(artboard({
      rooms: [rect('r1', 'Room', 0, 0, 400, 300)],
      openings: [windowOp({ xCm: 200, yCm: 0, swing: 'out', variant: 'casement' })],
    }))
    // The open sash goes 120 cm above the top wall: the drawing must include its tip.
    expect(out.heightPx).toBeGreaterThan(2 * (300 + 120 + 40 + 44) - 10)
    const inSwing = renderArtboardSvg(artboard({
      rooms: [rect('r1', 'Room', 0, 0, 400, 300)],
      openings: [windowOp({ xCm: 200, yCm: 0, swing: 'in', variant: 'casement' })],
    }))
    expect(out.heightPx).toBeGreaterThan(inSwing.heightPx)
  })

  it('keeps a plain opening unchanged: no symbol, only the jamb ticks', () => {
    const svg = renderArtboardSvg(artboard({
      rooms: [rect('r1', 'Living', 0, 0, 400, 300)],
      openings: [gap({ xCm: 200, yCm: 300, angleDeg: 0 })],
    })).svg
    const g = groupOf(svg, 'g1')
    expect(g).toContain('data-variant="standard"')
    expect(count(g, '<polygon')).toBe(0)
    expect(count(g, '<line')).toBe(3) // background gap plus the two jamb ticks
  })

  it('gives different output for every door style and keeps the drawing stable', () => {
    const styles = ['standard', 'french', 'pocket', 'bypass'] as const
    const groups = styles.map((variant) => groupOf(oneDoor({ variant }), 'd1'))
    expect(new Set(groups).size).toBe(styles.length)
    // Same input, same output (no hidden state in the renderer).
    expect(oneDoor({ variant: 'french' })).toBe(oneDoor({ variant: 'french' }))
  })

  it('gives different output for every window style, the casements included', () => {
    const styles = ['standard', 'sliding', 'casement', 'double-casement'] as const
    const groups = styles.map((variant) => groupOf(oneWindow({ variant }), 'w1'))
    expect(new Set(groups).size).toBe(styles.length)
    expect(oneWindow({ variant: 'casement' })).toBe(oneWindow({ variant: 'casement' }))
  })
})

describe('renderArtboardSvg with wall thickness', () => {
  const thick = (t: number | undefined, extra: Partial<Artboard> = {}) => {
    const a = populated()
    if (t === undefined) delete a.wallThicknessCm
    else a.wallThicknessCm = t
    return renderArtboardSvg({ ...a, ...extra }).svg
  }

  it('draws no wall layer when the thickness is 0', () => {
    const svg = thick(0)
    expect(svg).not.toContain('<mask')
    expect(svg).not.toContain('data-walls')
    expect(svg).not.toContain('data-wall-shift')
  })

  it('draws a masked wall layer behind the rooms, with the default 10 cm when unset', () => {
    const svg = thick(undefined)
    expect(svg).toContain('<mask id="wall-mask-ab1"')
    expect(svg).toContain('stroke-width="20"') // 2 x 10 cm
    expect(svg).toContain('stroke-linejoin="miter" stroke-miterlimit="4"')
    expect(svg.indexOf('data-walls')).toBeLessThan(svg.indexOf('data-room='))
  })

  it('masks every room interior in black and cuts one black line per opening', () => {
    const svg = thick(12)
    const mask = svg.slice(svg.indexOf('<mask'), svg.indexOf('</mask>'))
    expect(mask.match(/<polygon [^>]*fill="#000"/g)).toHaveLength(2)
    expect(mask.match(/<line /g)).toHaveLength(3)
    expect(mask).toContain('fill="#fff"')
    expect(svg).toContain('stroke-width="24"')
  })

  it('spans the jambs across the wall and centres a window in it', () => {
    const svg = thick(10)
    const win = svg.slice(svg.indexOf('data-opening="w1"'))
    const group = win.slice(0, win.indexOf('data-opening', 10) > 0 ? win.indexOf('data-opening', 10) : undefined)
    // Window at the top wall (y 0), outward = up (y -1): the symbol shifts 5 cm up.
    expect(group).toContain('translate(0 -5)')
    expect(group).toMatch(/y1="0"[^>]*y2="-10"/) // jamb from the room edge outward by 10 cm
  })

  it('pushes wall labels by the wall thickness', () => {
    // Top wall of Living (400 wide, x 0..400): label at x = 200, 5 cm off the wall at 2 px/cm.
    const labelY = (svg: string) => Number(svg.match(/translate\(200 ([-\d.]+)\) rotate\(0\)/)?.[1])
    expect(Math.abs(labelY(thick(10))) - Math.abs(labelY(thick(0)))).toBeCloseTo(10, 5)
  })

  it('grows the sheet to hold the thick walls', () => {
    expect(renderArtboardSvg({ ...populated(), wallThicknessCm: 20 }).widthPx)
      .toBeGreaterThan(renderArtboardSvg({ ...populated(), wallThicknessCm: 0 }).widthPx)
  })

  it('moves the room border stroke into a masked group, so no line crosses an opening', () => {
    const svg = thick(10)
    // A second mask, one per artboard, declared before the rooms that use it.
    expect(svg).toContain('<mask id="wall-stroke-mask-ab1"')
    expect(svg.indexOf('wall-stroke-mask-ab1')).toBeLessThan(svg.indexOf('data-room='))
    // Each room: a fill polygon with no stroke, plus a stroke-only polygon in the masked group.
    expect(count(svg, 'data-room-strokes=')).toBe(2)
    expect(svg).toContain('data-room-strokes="r1" mask="url(#wall-stroke-mask-ab1)"')
    for (const m of svg.matchAll(/<polygon data-room="[^"]*"[^>]*>/g)) expect(m[0]).toContain('stroke="none"')
    for (const m of svg.matchAll(/<g data-room-strokes="[^"]*"[^>]*>[\s\S]*?<\/g>/g)) {
      expect(m[0]).toContain('fill="none" stroke="#e4e4e7" stroke-width="0.75" stroke-linejoin="round"')
    }
    // Thin walls keep the single outlined polygon and no second mask.
    const thin = thick(0)
    expect(thin).not.toContain('wall-stroke-mask')
    expect(count(thin, 'data-room-strokes=')).toBe(0)
    expect(thin).toContain(
      '<polygon data-room="r1" points="0,0 400,0 400,300 0,300" fill="#22d3ee" fill-opacity="0.28" ' +
        'stroke="#e4e4e7" stroke-width="0.75" stroke-linejoin="round" />',
    )
  })

  it('cuts the stroke mask with one butt-capped band of the exact opening width per opening', () => {
    const svg = thick(10)
    const mask = svg.slice(svg.indexOf('<mask id="wall-stroke-mask-ab1"'), svg.indexOf('</mask>', svg.indexOf('<mask id="wall-stroke-mask-ab1"')))
    expect(mask).toContain('fill="#fff"')
    // 2 px/cm on this plan, so px(3) is 1.5 cm: the pad is max(1.5, 1.5) = 1.5 cm.
    // Window w1 sits on the top wall (y 0), outward = up: from 1.5 cm inside to 11.5 cm outside.
    expect(mask).toContain(
      '<line x1="550" y1="1.5" x2="550" y2="-11.5" stroke="#000" stroke-width="120" stroke-linecap="butt" />',
    )
    // Door d1, 85 cm wide, on the same top wall.
    expect(mask).toContain(
      '<line x1="200" y1="1.5" x2="200" y2="-11.5" stroke="#000" stroke-width="85" stroke-linecap="butt" />',
    )
    expect(mask.match(/stroke-linecap="butt"/g)).toHaveLength(3)
  })

  it('puts the painted wall lines inside the stroke mask too', () => {
    const svg = thick(10, { rooms: [{ ...rect('r1', 'Living', 0, 0, 400, 300), wallColors: { '0': '#b85d43' } }] })
    const g = svg.slice(svg.indexOf('data-room-strokes="r1"'))
    expect(g.slice(0, g.indexOf('</g>'))).toContain('data-wall-paint="r1:0"')
    // Thin walls keep the paint line outside any mask.
    const thin = thick(0, { rooms: [{ ...rect('r1', 'Living', 0, 0, 400, 300), wallColors: { '0': '#b85d43' } }] })
    expect(thin).toContain('data-wall-paint="r1:0"')
    expect(thin).not.toContain('wall-stroke-mask')
  })

  it('drops the dark gap line over a thick wall and keeps it over a thin one', () => {
    // The two masks already remove the wall and both room borders, so the dark eraser bar is only
    // needed when the walls are thin.
    expect(groupOf(thick(0), 'w1')).toContain('stroke="#12161b" stroke-width="1.5"')
    expect(groupOf(thick(10), 'w1')).not.toContain('stroke="#12161b"')
    expect(groupOf(thick(10), 'd1')).not.toContain('stroke="#12161b"')
    expect(groupOf(thick(0), 'd1')).toContain('stroke="#12161b" stroke-width="1.5"')
  })
})

describe('renderArtboardSvg with flush rooms', () => {
  /** Two rooms sharing the same wall line at x = 400, with one door on that shared wall. */
  const flush = (t: number) => renderArtboardSvg(artboard({
    wallThicknessCm: t,
    rooms: [rect('r1', 'Living', 0, 0, 400, 300), rect('r2', 'Kitchen', 400, 0, 700, 300)],
    openings: [door({ xCm: 400, yCm: 150, angleDeg: 90 })],
  })).svg

  it('draws the door on the shared wall line instead of across the thick wall', () => {
    const g = groupOf(flush(10), 'd1')
    // No wall shift: the thick wall is masked away by the second room, so the leaf hinges on the line.
    expect(g).not.toContain('data-wall-shift')
    // Short centred jamb ticks only, and no dark eraser bar over the page.
    expect(count(g, '<line')).toBe(3) // the two ticks and the wall line of the door symbol
    expect(g).not.toContain('stroke="#12161b"')
    // Each tick is a few cm wide and centred on the shared wall line at x = 400 (a 10 cm jamb would
    // run from x = 400 to x = 410).
    const ticks = [...g.matchAll(/<line x1="([-\d.]+)" y1="[-\d.]+" x2="([-\d.]+)" y2="[-\d.]+"/g)]
      .map((m) => [Number(m[1]), Number(m[2])] as const)
      .filter(([x1, x2]) => Math.abs(x2 - x1) < 5)
    expect(ticks).toHaveLength(2)
    for (const [x1, x2] of ticks) expect((x1 + x2) / 2).toBeCloseTo(400, 5)
    expect(g).not.toContain('x2="410"')
  })

  it('still cuts both flush room borders out of the opening', () => {
    const svg = flush(10)
    const from = svg.indexOf('<mask id="wall-stroke-mask-ab1"')
    const mask = svg.slice(from, svg.indexOf('</mask>', from))
    // From the pad inside the left room to the pad past the 10 cm wall: both border lines are cut.
    const line = mask.match(/<line [^>]*\/>/)?.[0] ?? ''
    const x1 = Number(line.match(/x1="([-\d.]+)"/)?.[1])
    const x2 = Number(line.match(/x2="([-\d.]+)"/)?.[1])
    expect(x1).toBeLessThan(400)
    expect(x2).toBeGreaterThan(400)
    expect(line).toContain('stroke-width="85"') // the door width
    expect(line).toContain('stroke-linecap="butt"')
  })
})

describe('renderArtboardSvg with fence walls', () => {
  /** One 400 x 300 cm room with the wall kinds given, next to an unfenced 300 x 300 cm room. */
  const fenced = (wallKinds: Record<string, 'wall' | 'fence'>, t = 10) => renderArtboardSvg(artboard({
    wallThicknessCm: t,
    rooms: [
      { ...rect('r1', 'Living', 0, 0, 400, 300), wallKinds },
      rect('r2', 'Kitchen', 400, 0, 700, 300),
    ],
  })).svg

  /** Markup of one fence railing group, from its data-fence attribute to its closing tag. */
  const fenceGroup = (svg: string, ref: string): string => {
    const from = svg.indexOf(`data-fence="${ref}"`)
    return svg.slice(from, svg.indexOf('</g>', from))
  }

  it('keeps the closed wall body polygon when no wall is a fence', () => {
    const svg = fenced({})
    expect(count(svg, '<polyline')).toBe(0)
    expect(svg).toContain(
      '<polygon points="0,0 400,0 400,300 0,300" fill="none" stroke="#5b6577" stroke-width="20" ' +
        'stroke-linejoin="miter" stroke-miterlimit="4" />',
    )
    expect(svg).toContain(
      '<polygon points="400,0 700,0 700,300 400,300" fill="none" stroke="#5b6577" stroke-width="20" ' +
        'stroke-linejoin="miter" stroke-miterlimit="4" />',
    )
    expect(svg).not.toContain('data-wall-kind="fence"')
  })

  it('breaks the wall body into one polyline per solid run and drops the fence edge', () => {
    const svg = fenced({ '0': 'fence' })
    // The three solid edges of r1 form one open run from (400,0) back to (0,0).
    expect(svg).toContain(
      '<polyline points="400,0 400,300 0,300 0,0" fill="none" stroke="#5b6577" stroke-width="20" ' +
        'stroke-linejoin="miter" stroke-miterlimit="4" stroke-linecap="butt" />',
    )
    // No closed wall body along the fence edge, and the unfenced room keeps its polygon.
    expect(svg).not.toContain('points="0,0 400,0 400,300 0,300" fill="none"')
    expect(svg).toContain('<polygon points="400,0 700,0 700,300 400,300" fill="none"')
  })

  it('emits no wall body at all when every wall is a fence', () => {
    const svg = renderArtboardSvg(artboard({
      wallThicknessCm: 10,
      rooms: [{
        ...rect('r1', 'Living', 0, 0, 400, 300),
        wallKinds: { '0': 'fence', '1': 'fence', '2': 'fence', '3': 'fence' },
      }],
    })).svg
    expect(svg).not.toContain('stroke="#5b6577"')
    expect(count(svg, 'data-wall-kind="fence"')).toBe(4)
  })

  it('draws a railing on the fence edge: dashed inner line, outer line, posts', () => {
    const svg = fenced({ '0': 'fence' })
    expect(svg).toContain('data-wall-kind="fence" data-fence="r1:0"')
    const group = fenceGroup(svg, 'r1:0')
    // 2 px/cm: 1.5 px = 0.75 cm, the 6/4 px dashes are 3/2 cm.
    expect(group).toContain(
      '<line x1="0" y1="0" x2="400" y2="0" stroke="#94a3b8" stroke-width="0.75" stroke-dasharray="3 2" />',
    )
    // The top wall of the room faces up (y -1): the outer rail sits 4 cm above the border.
    expect(group).toContain('<line x1="0" y1="-4" x2="400" y2="-4" stroke="#94a3b8" stroke-width="0.625" />')
    // Posts at both ends and every ~60 cm: 7 intervals over 400 cm, so 8 posts plus the 2 rails.
    expect(count(group, '<line')).toBe(10)
    expect(group).toContain('<line x1="0" y1="0" x2="0" y2="-4" stroke="#94a3b8" stroke-width="0.75" />')
    expect(group).toContain('<line x1="400" y1="0" x2="400" y2="-4" stroke="#94a3b8" stroke-width="0.75" />')
  })

  it('strokes the solid edges of a fenced room as a polyline inside the stroke mask', () => {
    const svg = fenced({ '0': 'fence' })
    const from = svg.indexOf('<g data-room-strokes="r1" mask="url(#wall-stroke-mask-ab1)">')
    expect(from).toBeGreaterThan(-1)
    const g = svg.slice(from, svg.indexOf('</g>', from))
    expect(g).toContain(
      '<polyline points="400,0 400,300 0,300 0,0" fill="none" stroke="#e4e4e7" stroke-width="0.75" ' +
        'stroke-linejoin="round" />',
    )
    expect(g).toContain('data-wall-kind="fence" data-fence="r1:0"')
    // The fill polygon of r1 lost its border; the unfenced room keeps the closed one.
    expect(svg).toContain('<polygon data-room="r1" points="0,0 400,0 400,300 0,300" fill="rgba(255,255,255,0.04)" stroke="none" />')
    expect(svg).toContain('<polygon points="400,0 700,0 700,300 400,300" fill="none" stroke="#e4e4e7" stroke-width="0.75"')
  })

  it('renders the railing on thin walls too, in an unmasked stroke group', () => {
    const svg = fenced({ '0': 'fence' }, 0)
    expect(svg).not.toContain('<mask')
    expect(svg).toContain('<g data-room-strokes="r1">')
    expect(svg).toContain('data-wall-kind="fence" data-fence="r1:0"')
    // No thick wall body at all, and the border moved out of the fill polygon.
    expect(svg).not.toContain('stroke="#5b6577"')
    expect(svg).toContain('data-room="r1" points="0,0 400,0 400,300 0,300" fill=');
    expect(svg).toContain('stroke="none" />')
  })
})
