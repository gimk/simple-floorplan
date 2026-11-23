// Sidebar "Solve" tab: everything that works on the whole plan from the measured values
// (docs/sidebar-plan-3.md). In workflow order: Progress of each room, Settings (precision,
// keep locked), Actions (apply to all rooms, solve whole plan), and the last report.
// The report lives in the UI store, so it stays when the selection changes.
import { Crosshair, Lock, Ruler } from 'lucide-react'
import { fmtCm } from '../../model/geometry'
import { DEFAULT_PRECISION_CM, planPrecision } from '../../model/precision'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import { BTN, CheckboxRow, EmptyHint, FieldRow, MUTED, PanelSection, Segmented } from '../../shell/panel'
import { applyMeasuredAll, describeReport, verifiedWalls } from '../rooms/apply'
import { applyGlobal, describeGlobal } from '../rooms/applyGlobal'
import type { SurfaceMode } from '../rooms/globalSolve'
import { progressRows, progressTotals, type ProgressRow } from './logic'

const update = (fn: (d: PlanDoc) => PlanDoc) => useDoc.getState().update(fn)

/** Report of the last run, in the UI store (not per room). */
const setReport = (text: string) => useUi.getState().setSolveReport(text)

const PRECISIONS = [
  { value: '0', label: 'Off' },
  { value: '0.5', label: '0,5' },
  { value: '1', label: '1' },
] as const

/** 0.5 is the default: it is not stored. Off is stored as 0. */
function setPrecision(value: string) {
  update((d) => {
    const apartment = { ...(d.apartment ?? {}) }
    const cm = Number(value) as 0 | 0.5 | 1
    if (cm === DEFAULT_PRECISION_CM) delete apartment.precisionCm
    else apartment.precisionCm = cm
    return { ...d, apartment }
  })
}

/** "Solve whole plan" option: keep locked walls (UI setting, on by default). */
function KeepLockedToggle() {
  const on = useUi((s) => s.solveKeepLocked)
  return (
    <CheckboxRow
      name="solveKeepLocked"
      label="Keep locked walls when solving the whole plan"
      checked={on}
      onChange={(checked) => useUi.getState().set({ solveKeepLocked: checked })}
    />
  )
}

const SURFACE_MODES = [
  { value: 'off', label: 'Off', title: 'Do not use the surface references' },
  { value: 'guide', label: 'Guide', title: 'Never move a surface away from its reference: only block the wrong direction' },
  { value: 'match', label: 'Match', title: 'Pull the surface toward its reference (weak: a measured wall always wins)' },
] as const

/** "Solve whole plan" option: how the surface references act. Only enabled with references. */
function SurfaceModeRow({ mode, hasReferences, onChange }: {
  mode: SurfaceMode
  hasReferences: boolean
  onChange: (m: SurfaceMode) => void
}) {
  return (
    <>
      <FieldRow label="Surface references" stacked>
        <Segmented
          ariaLabel="Surface references: Off, Guide or Match"
          options={SURFACE_MODES}
          value={mode}
          onChange={(v) => onChange(v as SurfaceMode)}
          disabled={!hasReferences}
        />
      </FieldRow>
      {hasReferences ? (
        <EmptyHint>
          Guide blocks only the wrong direction: below its reference a surface cannot get smaller,
          above it cannot get bigger. Match pulls the surface toward its reference. A measured wall
          always wins.
        </EmptyHint>
      ) : (
        <EmptyHint>Add surface references in the Apartment card.</EmptyHint>
      )}
    </>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One progress line: "3 rooms, 7 of 18 walls measured, fit error 0,8 cm rms, 2 rooms locked." */
function totalsText(rows: readonly ProgressRow[]): string {
  const t = progressTotals(rows)
  const parts = [plural(t.rooms, 'room'), `${t.verified} of ${t.walls} walls measured`]
  if (t.residualCm !== null) parts.push(`fit error ${fmtCm(t.residualCm)} cm rms`)
  if (t.lockedRooms) parts.push(`${plural(t.lockedRooms, 'room')} locked`)
  return `${parts.join(', ')}.`
}

function ProgressRows({ rows }: { rows: readonly ProgressRow[] }) {
  if (!rows.length) return <EmptyHint>No room in the plan yet.</EmptyHint>
  return (
    <>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.roomId}>
            <button
              type="button"
              data-solve-room={row.code}
              aria-label={`Select room ${row.name} (${row.code})`}
              onClick={() => useUi.getState().select({ kind: 'room', roomId: row.roomId })}
              className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11"
            >
              <span className="w-10 shrink-0 font-mono text-xs">{row.code}</span>
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span
                data-solve-verified={row.code}
                title="Measured walls / walls"
                className={`shrink-0 font-mono text-xs tabular-nums ${row.verified ? 'text-emerald-700 dark:text-emerald-400' : MUTED}`}
              >
                {row.verified}/{row.walls}
              </span>
              {row.residualCm !== null && (
                <span
                  data-solve-residual={row.code}
                  title="Fit error of the measured values against the plan"
                  className={`shrink-0 font-mono text-xs tabular-nums ${row.residualCm >= 2 ? 'font-semibold text-orange-700 dark:text-orange-300' : ''}`}
                >
                  ±{fmtCm(row.residualCm)}
                  <span className={`ml-0.5 text-[11px] ${MUTED}`}>cm</span>
                </span>
              )}
              {row.allLocked && <Lock size={12} role="img" aria-label="locked" className="shrink-0 text-slate-500 dark:text-slate-400" />}
            </button>
          </li>
        ))}
      </ul>
      <p data-solve-totals className={MUTED}>{totalsText(rows)}</p>
    </>
  )
}

/** Actions of the whole plan; disabled when no room has a verified wall length. */
function Actions({ doc }: { doc: PlanDoc }) {
  const anyVerified = doc.rooms.some((r) => verifiedWalls(doc, r).length > 0)

  const runApplyAll = () => {
    const current = useDoc.getState().doc
    const r = applyMeasuredAll(current)
    if (r.doc !== current) update(() => r.doc)
    const done = r.reports.filter((x) => x.mode !== 'none')
    setReport(done.length
      ? `Applied to ${done.length} room${done.length === 1 ? '' : 's'}. ${done.map(describeReport).join(' ')}`
      : 'No room has verified wall lengths.')
  }

  const runGlobal = () => {
    const current = useDoc.getState().doc
    const r = applyGlobal(current, {
      keepLocked: useUi.getState().solveKeepLocked,
      surfaceMode: useUi.getState().solveSurfaceMode,
    })
    if (r.doc !== current) update(() => r.doc)
    setReport(describeGlobal(r.report))
  }

  return (
    <>
      <button className={BTN} disabled={!anyVerified} onClick={runApplyAll}>
        Apply measured lengths to all rooms
      </button>
      <button
        className={BTN}
        disabled={!anyVerified}
        onClick={runGlobal}
        title="Solve all rooms together: shared walls, wall thicknesses and walls in line. Keeps all measured values; other walls move to fit."
      >
        Solve whole plan
      </button>
      {!anyVerified && <EmptyHint>No verified wall length in any room. Measure a room in Measuring Mode first.</EmptyHint>}
    </>
  )
}

/** The whole tab from plain data, so it can be rendered without the stores (tests, SSR). */
export function SolvePanelView({ doc, report, surfaceMode, onSurfaceMode }: {
  doc: PlanDoc
  report: string | null
  /** Current surface reference mode (default: the value of the UI store). */
  surfaceMode?: SurfaceMode
  onSurfaceMode?: (m: SurfaceMode) => void
}) {
  const rows = progressRows(doc)
  const mode = surfaceMode ?? useUi.getState().solveSurfaceMode
  const setMode = onSurfaceMode ?? ((m: SurfaceMode) => useUi.getState().set({ solveSurfaceMode: m }))
  return (
    <>
      <PanelSection id="solve-progress" title="Progress" icon={<Ruler size={16} />} collapsible>
        <ProgressRows rows={rows} />
      </PanelSection>

      <PanelSection id="solve-settings" title="Settings">
        <FieldRow label="Precision (cm)" stacked>
          <Segmented
            ariaLabel="Precision of solved corners and thicknesses"
            options={PRECISIONS}
            value={String(planPrecision(doc))}
            onChange={setPrecision}
          />
        </FieldRow>
        <EmptyHint>
          Smallest step for the corners and wall thicknesses that "Apply measured lengths" and "Solve whole plan" write.
          Default 0,5 cm. Off keeps the exact result.
        </EmptyHint>
        <KeepLockedToggle />
        <SurfaceModeRow
          mode={mode}
          hasReferences={(doc.apartment?.references ?? []).length > 0}
          onChange={setMode}
        />
      </PanelSection>

      <PanelSection id="solve-actions" title="Actions" icon={<Crosshair size={16} />}>
        <Actions doc={doc} />
      </PanelSection>

      {report !== null && (
        <PanelSection title="Last result">
          <p data-solve-report className="whitespace-pre-line text-xs text-slate-700 dark:text-slate-200">{report}</p>
        </PanelSection>
      )}
    </>
  )
}

/** Sidebar "Solve" tab, wired to the stores (doc + the report of the last run). */
export function SolvePanel() {
  const doc = useDoc((s) => s.doc)
  const report = useUi((s) => s.solveReport)
  const surfaceMode = useUi((s) => s.solveSurfaceMode)
  return <SolvePanelView doc={doc} report={report} surfaceMode={surfaceMode} />
}
