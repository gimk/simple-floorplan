// Checkbox row and switch row: 44 px target on coarse pointers, one muted description line.
import { useId } from 'react'
import { MUTED } from './styles'

export type CheckboxRowProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
  /** Passed to the input, e.g. `layer-notes` (kept for tests and other code). */
  name?: string
  disabled?: boolean
  /** Muted line under the label. */
  description?: string
  className?: string
}

/** Plain checkbox with its label. */
export function CheckboxRow({ label, checked, onChange, id, name, disabled, description, className }: CheckboxRowProps) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <div className={className}>
      <label htmlFor={inputId} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11">
        <input
          id={inputId}
          name={name}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 shrink-0 cursor-pointer accent-orange-700 disabled:cursor-not-allowed pointer-coarse:h-5 pointer-coarse:w-5"
        />
        <span className="min-w-0">{label}</span>
      </label>
      {description && <p className={`mt-0.5 pl-6 ${MUTED}`}>{description}</p>}
    </div>
  )
}

export type SwitchRowProps = CheckboxRowProps

/** Same state as a checkbox, drawn as a switch (`role="switch"`). */
export function SwitchRow({ label, checked, onChange, id, name, disabled, description, className }: SwitchRowProps) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <div className={className}>
      <label htmlFor={inputId} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11">
        <input
          id={inputId}
          name={name}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="relative h-5 w-9 shrink-0 rounded-full bg-black/20 transition-colors peer-checked:bg-orange-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange-700 peer-disabled:opacity-50 dark:bg-white/25 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:after:translate-x-4"
        />
        <span className="min-w-0">{label}</span>
      </label>
      {description && <p className={`mt-0.5 pl-11 ${MUTED}`}>{description}</p>}
    </div>
  )
}
