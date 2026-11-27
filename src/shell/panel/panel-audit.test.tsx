// SSR smoke tests of the panel primitives touched by the design audit:
//   - Segmented is a radio group (role="radiogroup" + role="radio" + aria-checked), with exactly
//     one tab stop (the checked choice), instead of a row of aria-pressed buttons (L1).
//   - FieldRow prints a 12 px medium slate-300 label and a 12 px regular slate-400 hint (L2/L3).
// The interactive part (arrow keys moving the selection) needs a DOM and is not covered here.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FieldRow } from './FieldRow'
import { Segmented } from './Segmented'

const OPTIONS = [
  { value: 'door', label: 'Door' },
  { value: 'window', label: 'Window' },
  { value: 'opening', label: 'Opening' },
] as const

describe('Segmented', () => {
  it('renders a labelled radio group with the checked choice marked', () => {
    const html = renderToStaticMarkup(
      <Segmented options={OPTIONS} value="window" onChange={() => {}} ariaLabel="Opening type" />,
    )
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Opening type"')
    // one radio per choice, and only the current value is checked
    expect(html.match(/role="radio"/g)).toHaveLength(3)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toContain('aria-checked="true"')
    // no aria-pressed buttons any more
    expect(html).not.toContain('aria-pressed')
  })

  it('keeps a single tab stop: the checked radio, or the first one when nothing matches', () => {
    const checked = renderToStaticMarkup(
      <Segmented options={OPTIONS} value="opening" onChange={() => {}} ariaLabel="Opening type" />,
    )
    expect(checked.match(/tabindex="0"/g)).toHaveLength(1)
    expect(checked.match(/tabindex="-1"/g)).toHaveLength(2)

    const none = renderToStaticMarkup(
      <Segmented options={OPTIONS} value="nope" onChange={() => {}} ariaLabel="Opening type" />,
    )
    expect(none.match(/tabindex="0"/g)).toHaveLength(1)
    expect(none).not.toContain('aria-checked="true"')
  })

  it('marks a disabled choice and never gives it the tab stop', () => {
    const html = renderToStaticMarkup(
      <Segmented
        options={[...OPTIONS.slice(0, 1), { value: 'window', label: 'Window', disabled: true }]}
        value="door"
        onChange={() => {}}
        ariaLabel="Opening type"
      />,
    )
    expect(html).toContain('disabled=""')
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
  })
})

describe('FieldRow', () => {
  it('uses a 12 px medium slate-300 label and a 12 px slate-400 hint', () => {
    const html = renderToStaticMarkup(
      <FieldRow label="Ceiling" hint="for the 3D view">
        <span>field</span>
      </FieldRow>,
    )
    expect(html).toContain('>Ceiling<')
    expect(html).toContain('for the 3D view')
    // label: text-xs font-medium text-slate-300
    expect(html).toContain('text-xs font-medium text-slate-300')
    // hint: text-xs font-normal text-slate-400
    expect(html).toContain('text-xs font-normal text-slate-400')
    // no 10/11 px text and no light-theme leftovers in the row
    expect(html).not.toContain('text-[10px]')
    expect(html).not.toContain('text-[11px]')
    expect(html).not.toContain('dark:')
  })
})
