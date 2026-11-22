import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Pin } from '../../model/types'
import { PhotoMarksOverlay, PhotoSketch, MarksBadge } from './PhotoSketch'
import { PinPhotos } from '../annotations/PinEditor'

const pin = (over: Partial<Pin> = {}): Pin => ({
  id: 'p1',
  roomId: 'r1',
  at: { x: 10, y: 10 },
  photoKeys: ['data:image/png;base64,AA'],
  createdAt: '',
  updatedAt: '',
  ...over,
})

const render = (p: Pin = pin()) =>
  renderToString(<PhotoSketch pin={p} photoKey={p.photoKeys[0]} onClose={() => {}} />)

describe('PhotoSketch dialog', () => {
  it('is a full-screen dialog named after the photo', () => {
    const html = render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Annotate photo 1"')
    // Server rendering puts a comment between a text and its following interpolation.
    expect(html).toContain('0 marks')
  })

  it('says how many marks there are and how to draw one', () => {
    const html = render(pin({ sketches: { 'data:image/png;base64,AA': [{ id: 'mk1', a: { x: 0.1, y: 0.2 }, b: { x: 0.6, y: 0.2 }, valueCm: 412.5 }] } }))
    expect(html).toContain('1 mark')
    expect(html).toContain('Tap two points on the photo to draw an arrow.')
    // The chip of the mark shows its value with a comma.
    expect(html).toContain('412,5 cm')
  })

  it('offers undo and close with 44 px targets', () => {
    const html = render()
    expect(html).toContain('aria-label="Undo mark change"')
    expect(html).toContain('min-h-11')
    expect(html).toContain(' Close</button>')
  })

  it('waits for an R2 photo instead of breaking', () => {
    const html = render(pin({ photoKeys: ['proj/a.jpg'] }))
    expect(html).toContain('Loading photo…')
  })
})

describe('PhotoMarksOverlay', () => {
  it('draws one light arrow per mark', () => {
    const html = renderToString(
      <PhotoMarksOverlay marks={[{ id: 'mk1', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }]} />,
    )
    expect(html).toContain('viewBox="0 0 1 1"')
    expect(html).toContain('#f59e0b')
    expect(html).toContain('aria-hidden="true"')
  })

  it('renders nothing without marks', () => {
    expect(renderToString(<PhotoMarksOverlay marks={[]} />)).toBe('')
  })
})

describe('MarksBadge', () => {
  it('shows the number of marks', () => {
    const html = renderToString(<MarksBadge count={2} />)
    expect(html).toContain('data-marks="2"')
    expect(html).toContain('2 dimension marks')
  })

  it('renders nothing at zero', () => {
    expect(renderToString(<MarksBadge count={0} />)).toBe('')
  })
})

describe('photo thumbnails: annotate entry point', () => {
  const withMark = () =>
    pin({
      sketches: { 'data:image/png;base64,AA': [{ id: 'mk1', a: { x: 0.1, y: 0.2 }, b: { x: 0.6, y: 0.2 }, valueCm: 90 }] },
      photoKeys: ['data:image/png;base64,AA', 'data:image/png;base64,BB'],
    })

  it('gives every thumbnail an Annotate button', () => {
    const html = renderToString(<PinPhotos pin={withMark()} />)
    expect(html).toContain('aria-label="Annotate photo 1"')
    expect(html).toContain('aria-label="Annotate photo 2"')
    expect(html).toContain('title="Annotate"')
  })

  it('shows the mark count badge and the overlay on the annotated photo only', () => {
    const html = renderToString(<PinPhotos pin={withMark()} />)
    expect(html).toContain('data-marks="1"')
    expect(html.match(/#f59e0b/g)?.length).toBe(1)
  })

  it('keeps the delete button of each photo', () => {
    const html = renderToString(<PinPhotos pin={withMark()} />)
    expect(html).toContain('aria-label="Delete photo 1"')
    expect(html).toContain('aria-label="Delete photo 2"')
  })
})
