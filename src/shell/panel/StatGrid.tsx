// Label/value pairs with tabular numbers. Numbers are formatted with a French comma.
import { formatDecimal } from './number'
import { MUTED } from './styles'

export type StatTone = 'default' | 'ok' | 'warn' | 'bad' | 'muted'

export type StatItem = {
  label: string
  /** Pre-formatted string, or a number formatted with 2 decimals and a comma. */
  value: string | number
  /** Small line under the value. */
  hint?: string
  tone?: StatTone
}

export type StatGridProps = {
  items: readonly StatItem[]
  columns?: 1 | 2
  className?: string
}

const TONE: Record<StatTone, string> = {
  default: 'text-slate-100',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  muted: 'text-slate-400',
}

export function StatGrid({ items, columns = 2, className }: StatGridProps) {
  return (
    <dl className={`grid gap-x-3 gap-y-1.5 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'} ${className ?? ''}`}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className={`truncate ${MUTED}`}>{item.label}</dt>
          <dd className={`font-mono text-sm tabular-nums ${TONE[item.tone ?? 'default']}`}>
            {typeof item.value === 'number' ? formatDecimal(item.value) : item.value}
            {item.hint && <span className={`block font-sans font-normal ${MUTED}`}>{item.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
