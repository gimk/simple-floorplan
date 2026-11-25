// Colour of one dimension text (docs/solver-plan.md, "Purple everywhere"): green when the value is
// measured on site, purple when the solver changed the wall, grey when it is just the plan.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Viewport } from '../../../canvas/Viewport'
import { ESTIMATED_FILL, MEASURED_FILL, MISMATCH_FILL, SOLVED_FILL } from '../../../shell/panel/styles'
import { DimLineView, valueFill } from './DimLineView'
import { dimLine } from './dimLine'

const line = dimLine({
  start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, normal: { x: 0, y: 1 },
  offsetCm: 10, zoom: 1, text: '400',
})!

const draw = (props: Partial<Parameters<typeof DimLineView>[0]> = {}) =>
  renderToString(
    <Viewport>
      <DimLineView line={line} text="400" measured={false} kind="wall" dimKey="SE-1" {...props} />
    </Viewport>,
  )

describe('DimLineView: state of a value', () => {
  it('writes a measured value in green and bold', () => {
    const html = draw({ measured: true, state: 'measured' })
    expect(html).toContain(MEASURED_FILL)
    expect(html).toContain('font-weight="600"')
    expect(html).toContain('data-dim-state="measured"')
  })

  it('writes a value the solver changed in purple, and not bold', () => {
    const html = draw({ state: 'solved' })
    expect(html).toContain(SOLVED_FILL)
    expect(html).not.toContain(MEASURED_FILL)
    expect(html).not.toContain('font-weight="600"')
    expect(html).toContain('data-dim-state="solved"')
  })

  it('writes an estimated value in the grey of the plan', () => {
    const html = draw({ state: 'estimated' })
    expect(html).toContain(ESTIMATED_FILL)
    expect(html).not.toContain(SOLVED_FILL)
    expect(html).toContain('data-dim-state="estimated"')
  })

  it('follows `measured` when no state is given', () => {
    expect(draw({ measured: true })).toContain(MEASURED_FILL)
    expect(draw({ measured: false })).toContain(ESTIMATED_FILL)
  })
})

describe('DimLineView: a measured value the plan does not fit', () => {
  it('writes it in amber, and keeps its state measured', () => {
    const html = draw({ measured: true, state: 'measured', mismatch: true })
    expect(html).toContain(MISMATCH_FILL)
    expect(html).not.toContain(MEASURED_FILL)
    // The state of the value does not change: it is measured, only its fit does not.
    expect(html).toContain('data-dim-state="measured"')
    expect(html).toContain('data-dim-mismatch=""')
    // Still a measured value: bold.
    expect(html).toContain('font-weight="600"')
  })

  it('marks no mismatch on a value the plan fits', () => {
    expect(draw({ measured: true, state: 'measured' })).not.toContain('data-dim-mismatch')
  })

  it('keeps a solved value purple: amber is only for a measured value', () => {
    const html = draw({ state: 'solved', mismatch: true })
    expect(html).toContain(SOLVED_FILL)
    expect(html).not.toContain(MISMATCH_FILL)
  })

  it('is the colour of valueFill', () => {
    expect(valueFill('measured', true)).toBe(MISMATCH_FILL)
    expect(valueFill('measured', false)).toBe(MEASURED_FILL)
    expect(valueFill('measured')).toBe(MEASURED_FILL)
    expect(valueFill('solved', true)).toBe(SOLVED_FILL)
    expect(valueFill('estimated', true)).toBe(ESTIMATED_FILL)
  })
})

describe('DimLineView: the pointer on the text', () => {
  it('takes no pointer event when the text does nothing', () => {
    expect(draw()).toContain('pointer-events="none"')
  })

  it('takes the pointer for a breakdown on hover, with no text-edit cursor', () => {
    const html = draw({ onTextPointerEnter: () => {}, onTextPointerLeave: () => {} })
    expect(html).toContain('pointer-events="auto"')
    // No double-click and no press: the label is not a text to type, so no cursor: text.
    expect(html).not.toContain('cursor:text')
    expect(html).not.toContain('data-dim-text')
  })
})
