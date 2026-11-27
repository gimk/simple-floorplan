// Number input with comma decimals and the unit inside the field.
//   - `inputMode="decimal"`: the phone shows the numeric keyboard.
//   - accepts "4,25" and "4.25"; shows stored values as "4,25".
//   - commits on Enter and on blur, Escape reverts to the stored value.
//   - `onCommit` returns false to reject the value: the typed text and the message stay.
import { useId, useRef, useState } from 'react'
import { formatCmInput, parseDecimal } from './number'
import { ERROR, INPUT_BARE, inputGroup } from './styles'

export type NumberFieldProps = {
  /** Value from the store. null = no value yet. */
  value: number | null
  /** Called on Enter/blur with the parsed value (null when the field is emptied). */
  onCommit: (value: number | null) => boolean | void
  /** Unit shown inside the field (cm, m², %). */
  unit?: string
  id?: string
  name?: string
  ariaLabel?: string
  'aria-label'?: string
  placeholder?: string
  disabled?: boolean
  /** Local range check, on top of `onCommit` returning false. */
  min?: number
  max?: number
  /** Message shown for a rejected value (a generic one is used by default). */
  invalidMessage?: string
  /** Classes of the wrapper (the invalid message sits under it). */
  className?: string
  inputClassName?: string
}

export function NumberField({
  value,
  onCommit,
  unit,
  id,
  name,
  ariaLabel,
  'aria-label': ariaLabelProp,
  placeholder,
  disabled,
  min,
  max,
  invalidMessage,
  className,
  inputClassName,
}: NumberFieldProps) {
  const [draft, setDraftState] = useState<string | null>(null)
  // Same draft, readable at once: Enter commits and then blurs, and the blur handler still
  // has the old `draft` in its closure. Without this it would commit a second time.
  const draftRef = useRef<string | null>(null)
  const setDraft = (d: string | null) => { draftRef.current = d; setDraftState(d) }
  // Rejected text + its message. The message is derived from the current text, so it
  // disappears as soon as the user edits or the store value changes: no effect needed.
  const [rejected, setRejected] = useState<{ text: string; message: string } | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const errId = useId()
  const shown = formatCmInput(value)
  const text = draft ?? shown
  const baseLabel = ariaLabel ?? ariaLabelProp
  const label = baseLabel && unit && !baseLabel.includes(unit) ? `${baseLabel} (${unit})` : baseLabel
  const error = rejected && rejected.text === text ? rejected.message : null

  const withUnit = (n: number) => `${formatCmInput(n)}${unit ? ` ${unit}` : ''}`

  const rangeMessage = () => {
    if (invalidMessage) return invalidMessage
    if (min !== undefined && max !== undefined) return `Use a number between ${withUnit(min)} and ${withUnit(max)}.`
    if (min !== undefined) return `Use a number of at least ${withUnit(min)}.`
    return `Use a number of at most ${withUnit(max ?? 0)}.`
  }

  /** Returns true when the draft was accepted (or there was nothing to commit). */
  const commit = (): boolean => {
    const draft = draftRef.current
    if (draft === null) return true
    const trimmed = draft.trim()
    if (trimmed === '') {
      setDraft(null)
      setRejected(null)
      // Only clear the store when there was a value: no empty undo step.
      if (value != null) onCommit(null)
      return true
    }
    const n = parseDecimal(trimmed)
    if (n === null) {
      setRejected({ text: trimmed, message: invalidMessage ?? 'Type a number, for example 412 or 412,5.' })
      return false
    }
    if (n === value) {
      setDraft(null)
      setRejected(null)
      return true
    }
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
      setRejected({ text: trimmed, message: rangeMessage() })
      return false
    }
    if (onCommit(n) === false) {
      setRejected({ text: trimmed, message: invalidMessage ?? 'This value is not valid.' })
      return false
    }
    setDraft(null)
    setRejected(null)
    return true
  }

  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <div className={inputGroup(!!error)}>
        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          placeholder={placeholder}
          disabled={disabled}
          value={text}
          className={`${INPUT_BARE} tabular-nums ${inputClassName ?? ''}`}
          onFocus={(e) => {
            setDraft(shown)
            e.currentTarget.select()
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            commit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (commit()) ref.current?.blur()
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const step = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
              const cur = parseDecimal((draftRef.current ?? shown).trim()) ?? value ?? 0
              let n = Math.round((cur + step) * 100) / 100
              if (min !== undefined) n = Math.max(min, n)
              if (max !== undefined) n = Math.min(max, n)
              setDraft(formatCmInput(n))
              commit()
              // Keep editing: show the new value as the draft again.
              setDraft(formatCmInput(n))
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(null)
              setRejected(null)
              ref.current?.blur()
            }
          }}
        />
        {unit && (
          <span aria-hidden="true" className="shrink-0 pr-2 text-xs text-slate-400">
            {unit}
          </span>
        )}
      </div>
      {error && (
        <p id={errId} role="alert" className={`mt-1 ${ERROR}`}>
          {error}
        </p>
      )}
    </div>
  )
}
