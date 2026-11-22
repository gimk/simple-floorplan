// Segmented control: one button per choice, `aria-pressed` on the active one.
// Used for wall type, element kind and units.
export type SegmentedOption = { value: string; label: string; title?: string; disabled?: boolean }

export type SegmentedProps = {
  options: readonly SegmentedOption[]
  value: string
  onChange: (value: string) => void
  /** Accessible name of the group, e.g. "Wall type". */
  ariaLabel: string
  disabled?: boolean
  /** Classes of the wrapper. */
  className?: string
  /** `sm` = compact text for tight rows. */
  size?: 'sm' | 'md'
}

export function Segmented({ options, value, onChange, ariaLabel, disabled, className, size = 'md' }: SegmentedProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex overflow-hidden rounded-md border border-black/15 dark:border-white/15 ${className ?? ''}`}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            title={o.title ?? o.label}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={`min-h-9 min-w-0 flex-1 truncate px-2 text-center pointer-coarse:min-h-11 ${
              size === 'sm' ? 'text-xs' : 'text-sm'
            } ${active ? 'bg-orange-700 font-medium text-white' : 'hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
