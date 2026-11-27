// Read-only reference card of Design mode: the usual planning sizes (see ./measurements).
// It sits at the bottom of the right Inspect panel, under whatever card the selection shows.
// Collapsible and closed on the first visit, so it never pushes the working card out of the way.
// One group at a time: a wrapping row of chips (the short group names) picks the group, the chip
// row is the only heading of the list, and the last choice is kept in localStorage. Each row puts
// the label on the left (it may wrap) and the value on the right (it never wraps), with the note on
// a quieter second line, so the card fits var(--panel-w-right) and the phone bottom sheet without a
// horizontal scroll.
import { useState } from 'react'
import { Ruler } from 'lucide-react'
import { PanelSection } from '../../shell/panel'
import { MEASUREMENT_GROUPS } from './measurements'

/** Where the last shown group is remembered. */
const GROUP_KEY = 'measurements:group'

/** Read the last shown group; missing, unknown or blocked storage gives the first group. */
function loadGroup(): string {
  const fallback = MEASUREMENT_GROUPS[0].short
  try {
    const raw = localStorage.getItem(GROUP_KEY)
    if (raw && MEASUREMENT_GROUPS.some((group) => group.short === raw)) return raw
  } catch {
    // storage blocked: fall back to the first group
  }
  return fallback
}

/** Write the chosen group. Errors (blocked or full storage) are ignored. */
function saveGroup(short: string): void {
  try {
    localStorage.setItem(GROUP_KEY, short)
  } catch {
    // storage blocked: the choice stays in memory only
  }
}

export function MeasurementCheatsheet() {
  const [short, setShort] = useState(loadGroup)
  const group = MEASUREMENT_GROUPS.find((g) => g.short === short) ?? MEASUREMENT_GROUPS[0]

  const select = (next: string) => {
    setShort(next)
    saveGroup(next)
  }

  return (
    <PanelSection
      title="Measurements"
      icon={<Ruler size={14} aria-hidden="true" />}
      collapsible
      defaultOpen={false}
    >
      <div role="group" aria-label="Measurement groups" className="flex flex-wrap gap-1">
        {MEASUREMENT_GROUPS.map((g) => {
          const active = g.short === group.short
          return (
            <button
              key={g.short}
              type="button"
              aria-pressed={active}
              onClick={() => select(g.short)}
              className={`min-h-7 rounded-full border px-2.5 text-xs font-medium pointer-coarse:min-h-10 ${
                active
                  ? 'border-orange-500 bg-orange-500/15 text-orange-700 dark:text-orange-300'
                  : 'border-black/15 text-slate-700 hover:bg-black/5 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/10'
              }`}
            >
              {g.short}
            </button>
          )
        })}
      </div>

      <dl className="mt-2 divide-y divide-white/5">
        {group.items.map((item) => (
          <div key={item.label} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 text-xs text-slate-300">{item.label}</dt>
              <dd className="shrink-0 whitespace-nowrap text-sm font-medium tabular-nums text-slate-50">
                {item.value}
              </dd>
            </div>
            {item.note ? <dd className="mt-0.5 text-xs text-slate-400">{item.note}</dd> : null}
          </div>
        ))}
      </dl>
    </PanelSection>
  )
}
