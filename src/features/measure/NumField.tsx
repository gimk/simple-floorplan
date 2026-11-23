import { useRef, useState } from 'react'
import { fmtCm } from '../../model/geometry'
import { parseCm } from './logic'

type Props = {
  id?: string
  value: number | undefined
  /** Called with a valid number, or null when the field is emptied. Not called for invalid text. */
  onValue: (n: number | null) => void
  placeholder?: string
  ariaLabel?: string
  allowZero?: boolean
  enterKeyHint?: 'next' | 'done'
  onFocus?: () => void
  onBlur?: () => void
  onEnter?: () => void
  /** Show the number from the store instead of nothing when it is 0 (default: show 0). */
  hideZero?: boolean
}

/** Number input in cm: comma or dot, inline validation, keeps the typed text while focused. */
export function NumField({ id, value, onValue, placeholder, ariaLabel, allowZero, enterKeyHint = 'next', onFocus, onBlur, onEnter, hideZero }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const shown = value != null && !(hideZero && value === 0) ? fmtCm(value) : ''
  const errId = id ? `${id}-err` : undefined
  return (
    <div className="min-w-0">
      <div className={`flex items-center rounded-lg border bg-white focus-within:ring-2 dark:bg-[#12161b] ${bad ? 'border-red-500 ring-red-500/30' : 'border-slate-300 focus-within:border-orange-600 focus-within:ring-orange-600/25 dark:border-slate-600 dark:focus-within:border-orange-400'}`}>
        <input
          ref={ref}
          id={id}
          name={id ?? (ariaLabel ? ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined)}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint={enterKeyHint}
          aria-label={ariaLabel}
          aria-invalid={bad}
          aria-describedby={bad ? errId : undefined}
          placeholder={placeholder}
          value={draft ?? shown}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-lg tabular-nums outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          onFocus={() => { setDraft(shown); onFocus?.() }}
          onBlur={() => { setDraft(null); setBad(false); onBlur?.() }}
          onChange={(e) => {
            const text = e.target.value
            setDraft(text)
            const n = parseCm(text, allowZero)
            if (Number.isNaN(n)) { setBad(true); return }
            setBad(false)
            onValue(n)
          }}
          onKeyDown={(e) => {
            // Esc leaves the field (the App does not use Esc while a field has the focus).
            if (e.key === 'Escape') { e.preventDefault(); ref.current?.blur(); return }
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (onEnter) onEnter(); else ref.current?.blur()
          }}
        />
        <span className="pr-3 text-sm text-slate-500 dark:text-slate-400">cm</span>
      </div>
      {bad && <p id={errId} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">Type a number in cm, for example 412 or 412,5.</p>}
    </div>
  )
}
