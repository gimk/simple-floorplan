// Text input (or textarea) that commits on Enter/blur and reverts on Escape,
// like the number field. `onCommit` may return false to keep the typed text and
// show `invalidMessage`.
import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ERROR, INPUT, INPUT_INVALID } from './styles'

export type TextFieldProps = {
  value: string
  /** Called on Enter/blur when the text changed. Return false to reject it. */
  onCommit: (value: string) => boolean | void
  id?: string
  name?: string
  ariaLabel?: string
  'aria-label'?: string
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  /** Renders a textarea with this many rows instead of a one-line input. */
  rows?: number
  invalidMessage?: string
  className?: string
  inputClassName?: string
}

export function TextField({
  value,
  onCommit,
  id,
  name,
  ariaLabel,
  'aria-label': ariaLabelProp,
  placeholder,
  disabled,
  maxLength,
  rows,
  invalidMessage,
  className,
  inputClassName,
}: TextFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  // Rejected text + its message, derived from the current text: the message disappears
  // as soon as the user edits or the store value changes, so no effect is needed.
  const [rejected, setRejected] = useState<{ text: string; message: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const errId = useId()
  const text = draft ?? value
  const error = rejected && rejected.text === text ? rejected.message : null

  /** Returns true when the draft was accepted (or nothing changed). */
  const commit = (): boolean => {
    if (draft === null || draft === value) {
      setDraft(null)
      setRejected(null)
      return true
    }
    if (onCommit(draft) === false) {
      setRejected({ text: draft, message: invalidMessage ?? 'This value is not valid.' })
      return false
    }
    setDraft(null)
    setRejected(null)
    return true
  }

  const onChange = (next: string) => setDraft(next)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, single: boolean) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(null)
      setRejected(null)
      if (single) inputRef.current?.blur()
      else areaRef.current?.blur()
      return
    }
    // A textarea keeps Enter for new lines.
    if (e.key === 'Enter' && single) {
      e.preventDefault()
      if (commit()) inputRef.current?.blur()
    }
  }

  const classes = `${INPUT} ${rows ? 'h-auto py-2' : ''} ${error ? INPUT_INVALID : ''} ${inputClassName ?? ''}`
  const common = {
    id,
    name,
    'aria-label': ariaLabel ?? ariaLabelProp,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errId : undefined,
    placeholder,
    disabled,
    value: text,
    className: classes,
  }

  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      {rows ? (
        <textarea
          ref={areaRef}
          rows={rows}
          maxLength={maxLength}
          {...common}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            commit()
          }}
          onKeyDown={(e) => onKeyDown(e, false)}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={maxLength}
          {...common}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            commit()
          }}
          onKeyDown={(e) => onKeyDown(e, true)}
        />
      )}
      {error && (
        <p id={errId} role="alert" className={`mt-1 ${ERROR}`}>
          {error}
        </p>
      )}
    </div>
  )
}
