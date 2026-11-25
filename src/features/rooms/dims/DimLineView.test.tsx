// Colour of one dimension text (docs/solver-plan.md, "Purple everywhere"): green when the value is
// measured on site, purple when the solver changed the wall, grey when it is just the plan.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Viewport } from '../../../canvas/Viewport'
import { ESTIMATED_FILL, MEASURED_FILL, SOLVED_FILL } from '../../../shell/panel/styles'
import { DimLineView } from './DimLineView'
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
