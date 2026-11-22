import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Pin, TapeMeasure } from '../../model/types'
import { PinCard, TapeCard } from './index'

const tape = (over: Partial<TapeMeasure> = {}): TapeMeasure => ({
  id: 't1',
  a: { x: 0, y: 0 },
  b: { x: 245, y: 0 },
  ...over,
})

const pin = (over: Partial<Pin> = {}): Pin => ({
  id: 'p1',
  roomId: 'r1',
  at: { x: 10, y: 10 },
  photoKeys: [],
  createdAt: '',
  updatedAt: '',
  ...over,
})

const renderTape = (t: TapeMeasure = tape()) =>
  renderToString(<TapeCard tape={t} onPatch={() => {}} onDelete={() => {}} />)

const renderPin = (p: Pin = pin()) => renderToString(<PinCard pin={p} onDelete={() => {}} />)

describe('TapeCard', () => {
  it('shows the colour chip, the drawn length and both fields', () => {
    const html = renderTape()
    expect(html).toContain('aria-label="Tape"')
    expect(html).toContain('Drawn length')
    expect(html).toContain('245 cm')
    expect(html).toContain('background:#0891b2')
    expect(html).toContain('name="tapeLength"')
    expect(html).toContain('aria-label="Real length"')
    expect(html).toContain('name="tapeNote"')
    expect(html).toContain('aria-label="Tape note"')
  })

  it('puts the delete action in the header', () => {
    const html = renderTape()
    expect(html).toContain('aria-label="Delete tape"')
    expect(html).toContain('title="Delete tape"')
  })

  it('shows the measured length with a comma', () => {
    expect(renderTape(tape({ actualCm: 243.5 }))).toContain('value="243,5"')
  })

  it('leaves the measured length empty when there is none', () => {
    expect(renderTape()).toContain('aria-label="Real length"')
    expect(renderTape()).not.toContain('value="243')
  })

  it('renders as one shared panel card', () => {
    expect(renderTape().match(/<section/g)?.length).toBe(1)
  })
})

describe('PinCard', () => {
  it('shows the pin icon, the text field and the photo input', () => {
    const html = renderPin()
    expect(html).toContain('aria-label="Pin"')
    expect(html).toContain('aria-label="Pin note"')
    expect(html).toContain('name="pinNote"')
    expect(html).toContain('name="pinPhotos"')
    expect(html).toContain('Add photo')
    expect(html).toContain('data-pin="p1"')
  })

  it('puts the delete action in the header', () => {
    const html = renderPin()
    expect(html).toContain('aria-label="Delete pin"')
    expect(html).toContain('title="Delete pin"')
  })

  it('keeps the photos grid with one delete button per photo', () => {
    const html = renderPin(pin({ photoKeys: ['data:image/png;base64,AA', 'data:image/png;base64,BB'] }))
    expect(html).toContain('alt="Photo 1"')
    expect(html).toContain('alt="Photo 2"')
    expect(html).toContain('aria-label="Delete photo 1"')
    expect(html).toContain('aria-label="Delete photo 2"')
  })

  it('renders as one shared panel card', () => {
    expect(renderPin().match(/<section/g)?.length).toBe(1)
  })
})
