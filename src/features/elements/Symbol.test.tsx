import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ElementSymbol, symbolExtent } from './Symbol'

// Local coords: x along the wall, y toward the room interior (y > 0 = inside the host room).

/** The swing arc path of a single door, e.g. "M 80.0 0.0 A 80.0 80.0 0 0 1 0.0 80.0". */
const arcOf = (html: string) => /<path[^>]*d="([^"]*)"/.exec(html)?.[1] ?? ''

describe('ElementSymbol: door swing', () => {
  it('draws an in-door leaf inside the host room (positive y)', () => {
    const arc = arcOf(renderToString(<ElementSymbol kind="door" variant="single" w={80} t={10} hinge="start" swing="in" hair={1} />))
    expect(arc).toMatch(/A 80 80 0 0 1 0 80$/)
  })

  it('draws an out-door leaf on the other side (negative y)', () => {
    const arc = arcOf(renderToString(<ElementSymbol kind="door" variant="single" w={80} t={10} hinge="start" swing="out" hair={1} />))
    expect(arc).toMatch(/A 80 80 0 0 0 0 -80$/)
  })

  it('treats a missing swing as in', () => {
    const arc = arcOf(renderToString(<ElementSymbol kind="door" variant="single" w={80} t={10} hinge="start" hair={1} />))
    expect(arc).toMatch(/A 80 80 0 0 1 0 80$/)
  })

  it('mirrors the hinge when it is at the end of the opening', () => {
    const arc = arcOf(renderToString(<ElementSymbol kind="door" variant="single" w={80} t={10} hinge="end" swing="in" hair={1} />))
    expect(arc).toMatch(/A 80 80 0 0 0 80 80$/)
  })
})

describe('symbolExtent: the drawn side of a door', () => {
  it('extends into the room for an in-door and out of it for an out-door', () => {
    expect(symbolExtent('door', 'single', 80, 10, undefined, 'in')).toEqual([-5, 80])
    expect(symbolExtent('door', 'single', 80, 10, undefined, 'out')).toEqual([-80, 5])
  })
})

describe('ElementSymbol: bifold door', () => {
  /** Every path `d` of the symbol. */
  const pathsOf = (html: string) => [...html.matchAll(/<path[^>]*d="([^"]*)"/g)].map((m) => m[1])

  it('draws two folded leaves from each jamb, each leaf w/4 wide at 45 degrees', () => {
    const paths = pathsOf(renderToString(<ElementSymbol kind="door" variant="bifold" w={80} t={10} swing="in" hair={1} />))
    // Left jamb: (0,0) -> (20,20) -> (40,0). Right jamb mirrored.
    expect(paths).toContain('M 0 0 L 20 20 L 40 0')
    expect(paths).toContain('M 80 0 L 60 20 L 40 0')
  })

  it('folds into the swing side (negative y for an out-door)', () => {
    const paths = pathsOf(renderToString(<ElementSymbol kind="door" variant="bifold" w={80} t={10} swing="out" hair={1} />))
    expect(paths).toContain('M 0 0 L 20 -20 L 40 0')
    expect(paths).toContain('M 80 0 L 60 -20 L 40 0')
  })

  it('extends the hit area by one leaf on the swing side', () => {
    expect(symbolExtent('door', 'bifold', 80, 10, undefined, 'in')).toEqual([-5, 20])
    expect(symbolExtent('door', 'bifold', 80, 10, undefined, 'out')).toEqual([-20, 5])
  })
})
