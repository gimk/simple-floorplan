// Segmented control: a radio group (role="radiogroup") with one role="radio" per choice,
// `aria-checked` on the active one. Used for wall type, element kind and units.
//
// Keyboard (WAI-ARIA radio group): the checked radio is the single tab stop; Left/Up and
// Right/Down move the selection to the previous/next enabled choice, Home/End jump to the
// first/last one. The focus follows the new choice, so the arrow keys work in one press.
import { useRef } from 'react'

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
  const groupRef = useRef<HTMLDivElement>(null)

  // Enabled choices, in display order: the arrow keys skip the disabled ones.
  const enabled = options.filter((o) => !(disabled || o.disabled))
  // The tab stop: the checked radio, or the first enabled one when the value matches nothing.
  const checked = enabled.some((o) => o.value === value) ? value : enabled[0]?.value

  const move = (to: string | undefined) => {
    if (!to || to === value) return
    onChange(to)
    // Focus the radio that is about to be checked, so the ring and the selection agree.
    const radios = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []
    const i = options.findIndex((o) => o.value === to)
    radios[i]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return
    const at = enabled.findIndex((o) => o.value === value)
    const cur = at < 0 ? 0 : at
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(enabled[(cur + 1) % enabled.length].value)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(enabled[(cur - 1 + enabled.length) % enabled.length].value)
    else if (e.key === 'Home') move(enabled[0].value)
    else if (e.key === 'End') move(enabled[enabled.length - 1].value)
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`flex overflow-hidden rounded-md border border-white/30 ${className ?? ''}`}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title ?? o.label}
            tabIndex={o.value === checked ? 0 : -1}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={`min-h-9 min-w-0 flex-1 truncate text-center pointer-coarse:min-h-11 ${
              size === 'sm' ? 'px-1 text-xs' : 'px-2 text-sm'
            } ${active ? 'bg-orange-700 font-medium text-white' : 'hover:bg-white/10 disabled:opacity-50'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
