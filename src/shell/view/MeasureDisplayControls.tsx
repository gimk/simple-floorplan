// How measurements are written on the plan (docs/measurements-plan.md): wall length style and
// the rows of the room tag. Shared by the canvas View menu and the Plan tab.
import { useUi, type CanvasUnits, type DimStyle, type RoomTagFields } from '../../model/store'
import { CheckboxRow, FieldRow, Segmented } from '../panel'

const DIM_OPTIONS = [
  { value: 'lines', label: 'Lines', title: 'Dimension lines with ticks' },
  { value: 'text', label: 'Text', title: 'Text only' },
] as const

const TAG_ROWS: { key: Exclude<keyof RoomTagFields, 'areaDecimals'>; label: string }[] = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Name' },
  { key: 'area', label: 'Area' },
  { key: 'perimeter', label: 'Perimeter' },
  { key: 'ceiling', label: 'Ceiling height' },
  { key: 'progress', label: 'Measured walls' },
]

const UNIT_OPTIONS = [
  { value: 'cm', label: 'cm' },
  { value: 'm', label: 'm' },
  { value: 'mm', label: 'mm' },
] as const

const LEN_DECIMAL_OPTIONS = [
  { value: '0', label: '0' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
] as const

const DECIMAL_OPTIONS = [
  { value: '0', label: '0' },
  { value: '1', label: '0,0' },
  { value: '2', label: '0,00' },
] as const

export function MeasureDisplayControls() {
  const dimStyle = useUi((s) => s.dimStyle)
  const tag = useUi((s) => s.roomTag)
  const units = useUi((s) => s.canvasUnits)
  const set = useUi((s) => s.set)
  return (
    <div className="flex flex-col gap-1.5" data-measure-display>
      <FieldRow label="Units">
        <Segmented
          ariaLabel="Length units on the plan"
          options={UNIT_OPTIONS}
          value={units.unit}
          onChange={(v) => set({ canvasUnits: { ...units, unit: v as CanvasUnits['unit'] } })}
          size="sm"
        />
      </FieldRow>
      <FieldRow label="Decimals">
        <Segmented
          ariaLabel="Length decimals on the plan"
          options={LEN_DECIMAL_OPTIONS}
          value={String(units.decimals)}
          onChange={(v) => set({ canvasUnits: { ...units, decimals: Number(v) as CanvasUnits['decimals'] } })}
          size="sm"
        />
      </FieldRow>
      <FieldRow label="Wall lengths">
        <Segmented
          ariaLabel="Wall lengths style"
          options={DIM_OPTIONS}
          value={dimStyle}
          onChange={(v) => set({ dimStyle: (v === 'text' ? 'text' : 'lines') as DimStyle })}
          size="sm"
        />
      </FieldRow>
      <h3 className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Room tag</h3>
      <div className="flex flex-col gap-1">
        {TAG_ROWS.map((r) => (
          <CheckboxRow
            key={r.key}
            name={`room-tag-${r.key}`}
            label={r.label}
            checked={tag[r.key]}
            onChange={() => set({ roomTag: { ...tag, [r.key]: !tag[r.key] } })}
          />
        ))}
      </div>
      <FieldRow label="Area decimals">
        <Segmented
          ariaLabel="Area decimals"
          options={DECIMAL_OPTIONS}
          value={String(tag.areaDecimals)}
          onChange={(v) => set({ roomTag: { ...tag, areaDecimals: (Number(v) as 0 | 1 | 2) } })}
          size="sm"
          disabled={!tag.area}
        />
      </FieldRow>
    </div>
  )
}
