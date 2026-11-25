// "Room schedule" section of the Plan tab (docs/measurements-plan.md section 6): a compact table
// (code, name, area, survey progress) with a total line, a "Copy CSV" and a "Download CSV" button.
// The values come from ./rows (pure), the CSV text from the same module (French Excel: ';').
// The view takes its data as props, so it renders on the server in the tests; the exported
// SchedulePanel reads the document and the settings from the stores.
import { useMemo, useState } from 'react'
import { Copy, Download, Table } from 'lucide-react'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Selection } from '../../model/types'
import { download, slug } from '../export/csv'
import { BTN, EmptyHint, ERROR, MUTED, PanelSection } from '../../shell/panel'
import { scheduleAreaText, scheduleCsv, scheduleProgressText, scheduleRows, type ScheduleRow } from './rows'

const TH = 'px-1 py-1 font-medium'
const TD = 'px-1 py-1 text-right font-mono tabular-nums'

/** One row of the table. A click selects the room, so the Inspect tab shows its card. */
function Row({ row, selected, areaDecimals, onSelect }: {
  row: ScheduleRow
  selected: boolean
  areaDecimals: number
  onSelect: () => void
}) {
  return (
    <tr
      data-room-schedule-row={row.roomId}
      {...(row.storage ? { 'data-room-schedule-storage': 'yes' } : {})}
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`cursor-pointer border-b border-black/5 dark:border-white/5 ${
        selected ? 'bg-orange-500/15' : 'hover:bg-black/5 dark:hover:bg-white/10'
      }`}
    >
      {/* A built-in storage is a sub-row: a small left padding, under its parent room. */}
      <td className={`py-1 pr-1 text-left font-medium ${row.storage ? 'pl-3' : 'pl-1'}`} title={row.code}>{row.code}</td>
      {/* The name wraps onto 2 lines: in the narrow desktop sidebar a long name such as
          "Hall Closet (Room 1)" was cut to "Hall Closet (Ro...". The full name stays in `title`. */}
      <td className={`max-w-24 px-1 py-1 align-top ${row.outdoor || row.storage ? MUTED : ''}`} title={row.name}>
        <span className="line-clamp-2 break-words">{row.name === '' ? '—' : row.name}</span>
        {row.outdoor && <span className="ml-1 text-[10px] uppercase">out</span>}
      </td>
      <td className={TD}>{scheduleAreaText(row.areaM2, areaDecimals)}</td>
      <td className={`${TD} ${row.walls > 0 && row.measuredWalls === row.walls ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
        {row.walls > 0 ? scheduleProgressText(row) : '—'}
      </td>
    </tr>
  )
}

export type SchedulePanelViewProps = {
  doc: PlanDoc
  /** Decimals of the area (0, 1 or 2); default 2, like the room tag. */
  areaDecimals?: number
  selection?: Selection
  /** Called with the room of the clicked row. Missing: the rows are not clickable. */
  select?: (s: Selection) => void
}

export function SchedulePanelView({ doc, areaDecimals = 2, selection = null, select }: SchedulePanelViewProps) {
  const [copied, setCopied] = useState(false)
  const [copyErr, setCopyErr] = useState('')

  const { rows, totals } = useMemo(() => scheduleRows(doc), [doc])
  const csv = useMemo(() => scheduleCsv(rows, { areaDecimals, totals }), [rows, totals, areaDecimals])
  const selectedRoomId = selection?.kind === 'room' ? selection.roomId : null

  const copy = async () => {
    setCopyErr('')
    try {
      await navigator.clipboard.writeText(csv)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyErr('Clipboard blocked by browser')
    }
  }

  const save = () => {
    try {
      download(`${slug(doc.title)}-rooms.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    } catch {
      setCopyErr('Download failed')
    }
  }

  return (
    <PanelSection id="schedule" title="Room schedule" icon={<Table size={16} />} collapsible>
      {rows.length === 0 ? (
        <EmptyHint>No rooms yet. Draw a room to see the schedule.</EmptyHint>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="Room schedule">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10">
                  <th className={`${TH} text-left`}>Code</th>
                  <th className={`${TH} text-left`}>Name</th>
                  <th className={`${TH} text-right`} title="Floor area, m²">Area</th>
                  <th className={`${TH} text-right`} title="Measured walls / walls">Measured</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row
                    key={row.roomId}
                    row={row}
                    selected={row.roomId === selectedRoomId}
                    areaDecimals={areaDecimals}
                    onSelect={() => select?.({ kind: 'room', roomId: row.roomId })}
                  />
                ))}
                <tr className="font-semibold">
                  <td className="px-1 py-1" colSpan={2}>
                    Total <span className={`font-normal ${MUTED}`}>{`(${totals.rooms})`}</span>
                  </td>
                  <td className={TD} data-room-schedule-total-area>{scheduleAreaText(totals.areaM2, areaDecimals)}</td>
                  <td className={TD} data-room-schedule-total-measured>
                    {totals.walls > 0 ? `${totals.measuredWalls}/${totals.walls}` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {totals.missingCeiling > 0 && (
            <p className={MUTED}>{`${totals.missingCeiling} room(s) without ceiling height: no volume.`}</p>
          )}
          <p className={MUTED}>Perimeter, ceiling and volume are in the CSV.</p>
          {/* Two equal buttons, each label on ONE line (visual review V-8: "Download CSV" wrapped
              onto two lines while "Copy CSV" stayed on one). The text goes to `text-xs` and the
              padding to `px-1.5`, so the longer label fits the half width of the panel. */}
          <div className="flex items-stretch gap-2" data-schedule-buttons>
            <button
              type="button"
              className={`${BTN} min-w-0 flex-1 gap-1 whitespace-nowrap px-1.5 text-xs`}
              onClick={copy}
            >
              <Copy size={14} className="shrink-0" /> {copied ? 'Copied' : 'Copy CSV'}
            </button>
            <button
              type="button"
              className={`${BTN} min-w-0 flex-1 gap-1 whitespace-nowrap px-1.5 text-xs`}
              onClick={save}
            >
              <Download size={14} className="shrink-0" /> Download CSV
            </button>
          </div>
          {copyErr && (
            <p role="alert" className={ERROR}>
              {copyErr}
            </p>
          )}
        </>
      )}
    </PanelSection>
  )
}

/** The connected section of the Plan tab. */
export function SchedulePanel() {
  const doc = useDoc((s) => s.doc)
  const areaDecimals = useUi((s) => s.roomTag.areaDecimals)
  const selection = useUi((s) => s.selection)
  const select = useUi((s) => s.select)
  return <SchedulePanelView doc={doc} areaDecimals={areaDecimals} selection={selection} select={select} />
}
