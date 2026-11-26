// Row of color swatches (28 px) plus a "+" swatch that opens the native color picker.
import { useId } from 'react'
import { Plus } from 'lucide-react'

export type ColorRowProps = {
  /** Accessible name of the group, e.g. "Room color". */
  label: string
  colors: readonly string[]
  /** Selected color (any CSS hex), compared without case. */
  value?: string | null
  onChange: (color: string) => void
  /** Hide the custom "+" picker. */
  noCustom?: boolean
  disabled?: boolean
  className?: string
}

export function ColorRow({ label, colors, value, onChange, noCustom, disabled, className }: ColorRowProps) {
  const pickerId = useId()
  const current = value?.toLowerCase()
  const isCustom = !!current && !colors.some((c) => c.toLowerCase() === current)
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      {colors.map((c) => {
        const active = c.toLowerCase() === current
        return (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={c}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(c)}
            style={{ backgroundColor: c }}
            className={`h-7 w-7 shrink-0 rounded-full border border-black/20 disabled:opacity-50 dark:border-white/30 ${
              active ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-white dark:ring-offset-surface-1' : ''
            }`}
          />
        )
      })}
      {!noCustom && (
        <label
          htmlFor={pickerId}
          title="Custom color"
          className={`relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-black/40 text-slate-600 focus-within:outline-2 focus-within:outline-orange-500 dark:border-white/40 dark:text-slate-300 ${
            isCustom ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-white dark:ring-offset-surface-1' : ''
          }`}
          style={isCustom ? { backgroundColor: value ?? undefined } : undefined}
        >
          {!isCustom && <Plus size={14} aria-hidden="true" />}
          <input
            id={pickerId}
            type="color"
            aria-label="Custom color"
            disabled={disabled}
            value={isCustom && value ? value : '#c2410c'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      )}
    </div>
  )
}
