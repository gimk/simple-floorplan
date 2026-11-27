// Read-only reference card of Design mode: the usual planning sizes (see ./measurements).
// It sits at the bottom of the right Inspect panel, under whatever card the selection shows.
// Collapsible and closed on the first visit, so it never pushes the working card out of the way.
// One 12 px scale like the other cards of the panel; the label wraps, the value stays right-aligned,
// so the card fits var(--panel-w-right) and the phone bottom sheet without a horizontal scroll.
import { Ruler } from 'lucide-react'
import { MUTED, PanelSection } from '../../shell/panel'
import { MEASUREMENT_GROUPS } from './measurements'

export function MeasurementCheatsheet() {
  return (
    <PanelSection
      title="Measurements"
      icon={<Ruler size={14} aria-hidden="true" />}
      collapsible
      defaultOpen={false}
    >
      {MEASUREMENT_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</h3>
          <dl className="flex flex-col gap-1">
            {group.items.map((item) => (
              <div key={item.label} className="flex items-baseline justify-between gap-2">
                <dt className={`min-w-0 flex-1 ${MUTED}`}>{item.label}</dt>
                <dd className="min-w-0 text-right text-xs tabular-nums text-slate-200">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </PanelSection>
  )
}
