// Compact numeric input with a data-testid on the <input> itself (agents and tests target it).
// Same look as the panel NumberField; commits on Enter/blur, Escape reverts. Accepts "4,25" and "4.25".
import { useRef, useState } from 'react'
import { INPUT_BARE, inputGroup, formatCmInput, parseDecimal } from '../../shell/panel'

export type NumInputProps = {
  value: number | null
  /** Called with the parsed value on Enter/blur. Return false to reject it. */
  onCommit: (value: number) => boolean | void
  testId: string
  id?: string
  ariaLabel?: string
  unit?: string
  min?: number
  disabled?: boolean
}

export function NumInput({ value, onCommit, testId, id, ariaLabel, unit = 'cm', min, disabled }: NumInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const draftRef = useRef<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const set = (d: string | null) => { draftRef.current = d; setDraft(d) }
  const shown = formatCmInput(value)

  const commit = (): boolean => {
    const d = draftRef.current
    if (d === null) return true
    const n = parseDecimal(d.trim())
    if (n === null || (min !== undefined && n < min) || onCommit(n) === false) { setBad(true); return false }
    setBad(false)
    set(null)
    return true
  }

  return (
    <div className={`min-w-0 ${inputGroup(bad)}`}>
      <input
        ref={ref}
        id={id}
        data-testid={testId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={bad ? true : undefined}
        disabled={disabled}
        value={draft ?? shown}
        className={`${INPUT_BARE} tabular-nums`}
        onFocus={(e) => { set(shown); e.currentTarget.select() }}
        onChange={(e) => { setBad(false); set(e.target.value) }}
        onBlur={() => { if (!commit()) { set(null); setBad(false) } }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (commit()) ref.current?.blur() }
          else if (e.key === 'Escape') { e.preventDefault(); set(null); setBad(false); ref.current?.blur() }
        }}
      />
      {unit && <span aria-hidden="true" className="shrink-0 pr-2 text-xs text-slate-400">{unit}</span>}
    </div>
  )
}
