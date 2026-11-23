// "Wall conversion" section of the Apartment card (docs/walls-plan.md 5c, step 4).
// Lists what the v1 -> v2 conversion did, in words, and lets the user hide the report once read.
import { ArrowRightLeft } from 'lucide-react'
import type { PlanDoc } from '../../model/types'
import { BTN, EmptyHint, MUTED, PanelSection } from '../../shell/panel'
import {
  CONVERSION_SECTION_ID,
  CONVERSION_SECTION_TITLE,
  conversionCountsText,
  conversionEntryText,
  hideConversionReport,
  useConversionNotice,
} from './conversion'

/**
 * Renders nothing: shows the "plan converted to walls" toast once after the load.
 * The Apartment panel already calls the hook; mount this component in App.tsx for the screens
 * where the sidebar is not mounted (phone, Measure Mode on a desktop).
 */
export function ConversionNotice() {
  useConversionNotice()
  return null
}

/**
 * The report of the conversion, collapsible. Presentational (the doc comes as a prop), so it can
 * be rendered without the stores in the tests.
 */
export function WallConversionSection({ conversion }: { conversion: NonNullable<PlanDoc['conversion']> }) {
  const { report } = conversion
  const entries = report.entries
  return (
    <PanelSection
      id={CONVERSION_SECTION_ID}
      title={CONVERSION_SECTION_TITLE}
      icon={<ArrowRightLeft size={14} />}
      collapsible
      className="mt-1 bg-black/[0.03] dark:bg-white/[0.04]"
      contentClassName="mt-2 flex flex-col gap-2"
      actions={<span className={`tabular-nums ${MUTED}`}>{report.counts.sharedWalls}</span>}
    >
      <p className={`text-xs tabular-nums ${MUTED}`}>{conversionCountsText(report)}</p>
      {entries.length === 0 ? (
        <EmptyHint>No wall needed a change: the walls were already single, with one thickness and one type.</EmptyHint>
      ) : (
        <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {entries.map((entry) => (
            <li key={entry.wallId} className="py-1.5 text-xs tabular-nums first:pt-0 last:pb-0">
              <span className="block break-words">{conversionEntryText(entry)}</span>
              <span className={`block text-[11px] ${MUTED}`}>{entry.wallId}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={`${BTN} w-full`} onClick={hideConversionReport}>
        Hide this report
      </button>
    </PanelSection>
  )
}
