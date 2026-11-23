// Source of the values typed in Measuring Mode (docs/walls-plan.md phase 3a).
// Every value typed while a source is selected is saved with that source; the solver
// then weights it: laser counts most, tape next, plan (read on the drawing) least.
import { MEASURE_SOURCES, MEASURE_SOURCE_LABELS, sourceSigmaCm } from '../../model/measureSource'
import type { MeasureSource } from '../../model/types'
import { Segmented } from '../../shell/panel'

/** Sources of the compact picker. 'other' stays for API / MCP values, it is not shown here. */
export const PICKER_SOURCES: readonly MeasureSource[] = MEASURE_SOURCES.filter((s) => s !== 'other')

const isPickerSource = (v: string): v is MeasureSource => (PICKER_SOURCES as readonly string[]).includes(v)

export type SourcePickerProps = {
  value: MeasureSource
  onChange: (s: MeasureSource) => void
  /** Wrapper classes; the control is compact, so give it a free width. */
  className?: string
}

/** Tape | Laser | Plan. The chosen source is used by every value typed after it. */
export function SourcePicker({ value, onChange, className }: SourcePickerProps) {
  return (
    <Segmented
      ariaLabel="Measurement source"
      size="sm"
      className={className}
      value={value}
      options={PICKER_SOURCES.map((s) => ({
        value: s,
        label: MEASURE_SOURCE_LABELS[s],
        title: `${MEASURE_SOURCE_LABELS[s]} · ±${sourceSigmaCm(s)} cm`,
      }))}
      onChange={(v) => {
        if (isPickerSource(v)) onChange(v)
      }}
    />
  )
}
