// Render smoke tests of the thick-wall opening cutout on the canvas (react-dom/server, no DOM).
// The viewport context defaults to px = cm and zoom 1, so the markup is directly readable in cm.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Artboard, Opening } from '../../model/types'
import { openingHitEndpoints, openingHitWidth } from '../openings/hit'
import { OpeningShape } from '../openings/OpeningsLayer'
import { RoomsLayer } from './RoomsLayer'

const AB = 'ab1'

/** Two rooms side by side, sharing the thick wall at x = 400, with one window on that wall. */
const board = (wallThicknessCm: number): Artboard => ({
  id: AB, name: 'Ground floor', xCm: 0, yCm: 0, ceilingHeightCm: 250, precisionCm: 1, wallThicknessCm,
  rooms: [
    {
      id: 'r1', name: 'Living',
      vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
    },
    {
      id: 'r2', name: 'Kitchen',
      vertices: [{ x: 400, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 300 }, { x: 400, y: 300 }],
    },
  ],
  openings: [{ id: 'w1', kind: 'window', xCm: 400, yCm: 150, angleDeg: 90, widthCm: 120 }],
  furniture: [],
})

const windowOp: Opening = { id: 'w1', kind: 'window', xCm: 400, yCm: 150, angleDeg: 90, widthCm: 120 }

const shape = (wall: { out: { x: number; y: number }; thicknessCm: number } | null) =>
  renderToStaticMarkup(<svg><OpeningShape op={windowOp} wall={wall} /></svg>)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

/** One 400 x 300 cm room whose wall kinds are given, on an artboard with 10 cm walls. */
const fencedBoard = (wallKinds: Record<string, 'wall' | 'fence'>): Artboard => ({
  id: AB, name: 'Balcony plan', xCm: 0, yCm: 0, ceilingHeightCm: 250, precisionCm: 1, wallThicknessCm: 10,
  rooms: [{
    id: 'r1', name: 'Living',
    vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
    wallKinds,
  }],
  openings: [],
  furniture: [],
})

/** Markup of the thick wall body layer, up to the mask that hides the room border strokes. */
const wallBodyOf = (html: string) =>
  html.slice(html.indexOf(`data-testid="wall-layer-${AB}"`), html.indexOf('<mask id="wall-stroke-mask-'))

describe('RoomsLayer with thick walls', () => {
  it('adds a stroke mask and masks the room border of both rooms', () => {
    const html = renderToStaticMarkup(<RoomsLayer artboard={board(10)} />)
    expect(html).toContain(`wall-stroke-mask-${AB}`)
    // ONE masked stroke group for all rooms (a single mask pass), holding one entry per room.
    expect(count(html, 'data-testid="room-strokes-')).toBe(1)
    expect(count(html, 'data-room-stroke="')).toBe(2)
    expect(count(html, 'mask="url(#wall-stroke-mask-')).toBe(1)
    expect(html).toContain(`mask="url(#wall-stroke-mask-${AB})"`)
    // The interactive fill keeps its handlers and loses its stroke, so no line crosses the opening.
    expect(count(html, 'stroke="none"')).toBe(2)
  })

  it('cuts the stroke mask with one butt-capped cutout of the exact opening width', () => {
    const html = renderToStaticMarkup(<RoomsLayer artboard={board(10)} />)
    const from = html.indexOf(`<mask id="wall-stroke-mask-${AB}"`)
    const mask = html.slice(from, html.indexOf('</mask>', from))
    expect(mask).toContain('fill="#fff"')
    // Window on the shared wall at x = 400, outward = +x: pad max(3, 1.5) = 3 cm on both faces, so the
    // cutout runs from 3 cm inside the room (397) to 3 cm past the outer wall face (413), 120 cm wide.
    expect(mask).toContain(
      'x1="397" y1="150" x2="413" y2="150" stroke="#000" stroke-width="120" stroke-linecap="butt"',
    )
  })

  it('keeps the plain single polygon when the walls are thin', () => {
    const html = renderToStaticMarkup(<RoomsLayer artboard={board(0)} />)
    expect(html).not.toContain('wall-stroke-mask')
    expect(html).not.toContain('data-testid="room-strokes-')
    // Thin walls keep the border stroke on the interactive polygon.
    expect(html).toContain('stroke="rgba(226,232,240,0.85)"')
  })
})

describe('RoomsLayer with fence walls', () => {
  it('keeps the closed wall body polygon when no wall is a fence', () => {
    const html = renderToStaticMarkup(<RoomsLayer artboard={fencedBoard({})} />)
    const body = wallBodyOf(html)
    expect(count(body, '<polyline')).toBe(0)
    expect(body).toContain('points="0,0 400,0 400,300 0,300" fill="none" stroke="#5b6577" stroke-width="20"')
    expect(html).not.toContain('data-wall-kind="fence"')
  })

  it('breaks the wall body into one polyline per solid run and drops the fence edge', () => {
    const html = renderToStaticMarkup(<RoomsLayer artboard={fencedBoard({ '0': 'fence' })} />)
    const body = wallBodyOf(html)
    // The three solid edges form one open run from (400,0) back to (0,0): no wall along the fence.
    expect(count(body, '<polyline')).toBe(1)
    expect(body).toContain(
      'points="400,0 400,300 0,300 0,0" fill="none" stroke="#5b6577" stroke-width="20" ' +
        'stroke-linejoin="miter" stroke-miterlimit="4" stroke-linecap="butt"',
    )
    expect(body).not.toContain('points="0,0 400,0 400,300 0,300" fill="none"')
  })

  it('emits no wall body at all when every wall is a fence', () => {
    const html = renderToStaticMarkup(
      <RoomsLayer artboard={fencedBoard({ '0': 'fence', '1': 'fence', '2': 'fence', '3': 'fence' })} />,
    )
    const body = wallBodyOf(html)
    expect(count(body, '<polyline')).toBe(0)
    expect(body).not.toContain('fill="none" stroke')
    // The railing is still drawn, one group per fence edge.
    expect(count(html, 'data-wall-kind="fence"')).toBe(4)
  })

  it('draws the railing on the fence edge inside the masked room strokes', () => {
    const html = renderToStaticMarkup(<RoomsLayer artboard={fencedBoard({ '0': 'fence' })} />)
    const strokes = html.slice(html.indexOf(`data-testid="room-strokes-${AB}"`))
    expect(strokes).toContain('data-wall-kind="fence" data-fence="r1:0"')
    // The solid edges keep the normal room border stroke, as a polyline (no line along the fence).
    expect(strokes).toContain(
      'points="400,0 400,300 0,300 0,0" fill="none" stroke="rgba(226,232,240,0.85)" stroke-width="1" ' +
        'stroke-linejoin="round"',
    )
    const from = strokes.indexOf('data-fence="r1:0"')
    const group = strokes.slice(from, strokes.indexOf('</g>', from))
    // Inner dashed line on the room border, outer solid line 4 cm outward (top wall: y -4).
    expect(group).toContain(
      'x1="0" y1="0" x2="400" y2="0" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4"',
    )
    expect(group).toContain('x1="0" y1="-4" x2="400" y2="-4" stroke="#94a3b8" stroke-width="1.25"')
    // Posts: start, end and 6 ticks between them (7 intervals of ~57 cm over 400 cm), plus 2 rails.
    expect(count(group, '<line')).toBe(10)
    expect(group).toContain('x1="0" y1="0" x2="0" y2="-4" stroke="#94a3b8" stroke-width="1.5"')
    expect(group).toContain('x1="400" y1="0" x2="400" y2="-4" stroke="#94a3b8" stroke-width="1.5"')
  })

  it('keeps the wall interaction attributes of a fence edge', () => {
    const html = renderToStaticMarkup(<RoomsLayer artboard={fencedBoard({ '0': 'fence' })} />)
    expect(html).toContain('data-wall="r1:0" data-entity="wall" data-id="r1" data-edge="0"')
    expect(html).toContain('data-wall="r1:1" data-entity="wall" data-id="r1" data-edge="1"')
  })
})

describe('OpeningShape with a thick wall', () => {
  it('drops the opaque gap-eraser line, so the page below stays visible', () => {
    const withWall = shape({ out: { x: 0, y: -1 }, thicknessCm: 10 })
    expect(withWall).not.toContain('#09090b')
    // The jambs still span the wall thickness.
    expect(count(withWall, '<line')).toBe(2)
  })

  it('keeps the gap-eraser line for thin walls and for a ghost preview', () => {
    expect(shape(null)).toContain('stroke="#09090b"')
    const ghost = renderToStaticMarkup(
      <svg><OpeningShape op={windowOp} ghost wall={{ out: { x: 0, y: -1 }, thicknessCm: 10 }} /></svg>,
    )
    expect(ghost).toContain('stroke="#09090b"')
  })
})

describe('opening hit band', () => {
  const a = { x: 400, y: 90 }, b = { x: 400, y: 210 }
  const px = (n: number) => n // zoom 1: 1 cm per screen px

  it('shifts the hit line half the wall thickness along the outward normal', () => {
    const hit = openingHitEndpoints(a, b, { out: { x: 1, y: 0 }, thicknessCm: 10 })
    expect(hit.start).toEqual({ x: 405, y: 90 })
    expect(hit.end).toEqual({ x: 405, y: 210 })
  })

  it('keeps the plain endpoints for a thin wall or no host wall', () => {
    expect(openingHitEndpoints(a, b, null)).toEqual({ start: a, end: b })
    expect(openingHitEndpoints(a, b, { out: { x: 1, y: 0 }, thicknessCm: 0 })).toEqual({ start: a, end: b })
  })

  it('covers the whole wall thickness plus a margin on both faces', () => {
    const wall = { out: { x: 1, y: 0 }, thicknessCm: 10 }
    // 10 cm wall: 10 + 6 = 16 cm, which is wider than the 14 cm thin-wall band.
    expect(openingHitWidth(wall, px)).toBe(16)
    // Zoomed in 4x (px(1) = 0.25 cm) the band still spans the 10 cm wall, plus 1.5 cm on both faces.
    const zoomed = openingHitWidth(wall, (n) => n / 4)
    expect(zoomed).toBeCloseTo(11.5)
    expect(zoomed).toBeGreaterThan(wall.thicknessCm)
    // A thick wall narrower than the minimum pointer size keeps the minimum.
    expect(openingHitWidth({ out: { x: 1, y: 0 }, thicknessCm: 2 }, px)).toBe(14)
  })

  it('keeps the plain 14 px band for thin walls', () => {
    expect(openingHitWidth(null, px)).toBe(14)
    expect(openingHitWidth({ out: { x: 1, y: 0 }, thicknessCm: 0 }, px)).toBe(14)
  })
})
