// Native select with the shared field look. Commits on change (one undo step).
import { INPUT } from './styles'

export type SelectOption = { value: string; label: string; disabled?: boolean }

export type SelectFieldProps = {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  id?: string
  name?: string
  ariaLabel?: string
  'aria-label'?: string
  disabled?: boolean
  className?: string
}

export function SelectField({ value, options, onChange, id, name, ariaLabel, 'aria-label': ariaLabelProp, disabled, className }: SelectFieldProps) {
  return (
    <select
      id={id}
      name={name}
      aria-label={ariaLabel ?? ariaLabelProp}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${INPUT} ${className ?? ''}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
