// Sidebar "Solve" tab: document-level solver switch, recorded changes, kept walls,
// progress of each room, Measure next, and Settings (docs/solver-plan.md).
import { useEffect, useId, useRef, useState } from 'react'
import { CircleHelp, Lock, Ruler, Sparkles } from 'lucide-react'
import { fmtCm } from '../../model/geometry'
import { DEFAULT_PRECISION_CM, planPrecision } from '../../model/precision'
import { useDoc, useUi } from '../../model/store'
import type { Mode, PlanDoc, SolverChange, SolverHold, SolverKey } from '../../model/types'
import { handleTipsKeyDown } from '../../shell/ToolHints'
import { BTN, CheckboxRow, EmptyHint, FieldRow, MUTED, PanelSection, Segmented } from '../../shell/panel'
import { ESTIMATED_TEXT, MEASURED_TEXT, SOLVED_HEX, SOLVED_TEXT } from '../../shell/panel/styles'
import type { RoomAngles, SurfaceMode } from '../rooms/globalSolve'
import {
  hoverLabelForWall,
  restoreSolverChange,
  revokeSolverChange,
  setSolverEnabled,
  wallLabel,
} from '../solver'
import { MeasureNext, useRowHover } from './MeasureNext'
import { progressRows, progressTotals, type ProgressRow } from './logic'

const update = (fn: (d: PlanDoc) => PlanDoc) => useDoc.getState().update(fn)

const PRECISIONS = [
  { value: '0', label: 'Off' },
  { value: '0.5', label: '0,5' },
  { value: '1', label: '1' },
] as const

const DIR_WORD: Record<'N' | 'S' | 'E' | 'W', string> = {
  N: 'north',
  S: 'south',
  E: 'east',
  W: 'west',
}

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

/** Format an ISO timestamp as a short relative time ("just now", "2 min ago", "1 h ago"). */
export function formatRelativeTime(iso: string | undefined, nowMs: number = Date.now()): string {
  if (!iso) return 'just now'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'just now'
  const sec = Math.max(0, Math.round((nowMs - t) / 1000))
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hrs = Math.round(min / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.round(hrs / 24)
  return `${days} d ago`
}

/** Solver option: keep locked walls (UI setting, on by default). */
function KeepLockedToggle() {
  const on = useUi((s) => s.solveKeepLocked)
  return (
    <CheckboxRow
      name="solveKeepLocked"
      label="Keep locked walls when solving"
      checked={on}
      onChange={(checked) => useUi.getState().set({ solveKeepLocked: checked })}
    />
  )
}

/** Solver option: snap thicknesses that the data does not find (UI setting, off by default). */
function SnapThicknessToggle() {
  const on = useUi((s) => s.solveSnapThickness)
  return (
    <CheckboxRow
      name="solveSnapThickness"
      label="Snap thicknesses not found by the data to usual values"
      checked={on}
      onChange={(checked) => useUi.getState().set({ solveSnapThickness: checked })}
    />
  )
}

const SURFACE_MODES = [
  { value: 'off', label: 'Off', title: 'Do not use the surface references' },
  { value: 'guide', label: 'Guide', title: 'Never move a surface away from its reference: only block the wrong direction' },
  { value: 'match', label: 'Match', title: 'Pull the surface toward its reference (weak: a measured wall always wins)' },
] as const

/** Solver option: how the surface references act. Only enabled with references. */
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

const ROOM_ANGLES = [
  { value: 'square', label: 'Square', title: 'Keep walls drawn horizontal or vertical at their drawn angle' },
  { value: 'free', label: 'Free', title: 'Let every wall turn: a measured diagonal can show a room that is not square' },
] as const

/** Solver option: do the walls keep right angles, or can a room be out of square? */
function RoomAnglesRow({ angles, onChange }: { angles: RoomAngles; onChange: (a: RoomAngles) => void }) {
  return (
    <>
      <FieldRow label="Room angles" stacked>
        <Segmented
          ariaLabel="Room angles: Square or Free"
          options={ROOM_ANGLES}
          value={angles}
          onChange={(v) => onChange(v as RoomAngles)}
        />
      </FieldRow>
      <EmptyHint>Free: a measured diagonal can show a room that is not square.</EmptyHint>
    </>
  )
}

/** Small "?" button and popover explaining estimated / measured / solved colors and the solver. */
function SolverHelpTip({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (handleTipsKeyDown(e, () => setOpen(false))) btnRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        title="About the solver"
        aria-label="About the solver"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-black/5 hover:text-slate-800 pointer-coarse:h-11 pointer-coarse:w-11 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
      >
        <CircleHelp size={16} />
      </button>
      {open && (
        <div
          id={popId}
          role="dialog"
          aria-label="About the solver"
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-black/10 bg-white p-3 text-left text-xs shadow-xl dark:border-white/15 dark:bg-[#1b2128]"
        >
          <p className="mb-2 font-medium text-slate-900 dark:text-slate-100">Colours on the plan</p>
          <ul className="mb-2 flex flex-col gap-1">
            <li><span className={`font-semibold ${ESTIMATED_TEXT}`}>Grey</span> = estimated on the plan</li>
            <li><span className={`font-semibold ${MEASURED_TEXT}`}>Green</span> = measured</li>
            <li><span className={`font-semibold ${SOLVED_TEXT}`}>Purple</span> = solved</li>
          </ul>
          <p className="leading-snug text-slate-600 dark:text-slate-300">
            The solver fits the whole plan to your measured values and records each change.
            Turning it off puts the plan back.
          </p>
        </div>
      )}
    </div>
  )
}

/** Top section: Solver On/Off switch, status line, and help tip. */
function SolverSwitchSection({ doc, mode, onToggle, nowMs, tipDefaultOpen }: {
  doc: PlanDoc
  mode: Mode
  onToggle: (on: boolean) => void
  nowMs?: number
  tipDefaultOpen?: boolean
}) {
  const solver = doc.solver
  const enabled = Boolean(solver?.enabled)
  const changeCount = solver?.changes.length ?? 0
  const rms = fmtCm(solver?.rmsCm ?? 0)

  let statusText: string
  if (!enabled) {
    statusText = 'Off: the plan shows estimated and measured values only.'
  } else if (mode === 'measure') {
    statusText = 'Waits until you leave Measuring Mode.'
  } else {
    const rel = formatRelativeTime(solver?.solvedAt, nowMs)
    const changesWord = `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`
    statusText = `Solved ${rel} · ${changesWord} · average mismatch ${rms} cm`
  }

  return (
    <PanelSection
      id="solve-solver"
      title="Solver"
      icon={<Sparkles size={16} className={enabled ? SOLVED_TEXT : undefined} />}
      actions={<SolverHelpTip defaultOpen={tipDefaultOpen} />}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Solver"
          data-solver-switch
          onClick={() => onToggle(!enabled)}
          className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11"
        >
          <span
            aria-hidden="true"
            style={enabled ? { backgroundColor: SOLVED_HEX } : undefined}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? '' : 'bg-black/20 dark:bg-white/25'}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`}
            />
          </span>
          <span className={enabled ? `font-medium ${SOLVED_TEXT}` : ''}>
            {enabled ? 'On' : 'Off'}
          </span>
        </button>
      </div>
      <p data-solver-status className={MUTED}>{statusText}</p>
    </PanelSection>
  )
}

/** One recorded solver change row: description in SOLVED_TEXT, hover highlights wall, Revoke button. */
function ChangeRow({ doc, change, onRevoke }: {
  doc: PlanDoc
  change: SolverChange
  onRevoke: (key: SolverKey) => void
}) {
  const hoverLabel = hoverLabelForWall(doc, change.wallId)
  const hover = useRowHover(hoverLabel)
  const lengthChanged =
    change.kind === 'position'
    && change.lengthFromCm !== undefined
    && change.lengthToCm !== undefined
    && Math.abs(change.lengthToCm - change.lengthFromCm) >= 0.05

  return (
    <li
      data-solver-change={`${change.kind}:${change.wallId}`}
      data-hover-row={hoverLabel}
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
      className="flex min-h-9 items-center gap-2 py-1 pointer-coarse:min-h-11"
    >
      <span className="flex min-w-0 flex-1 flex-col text-xs leading-snug">
        {change.kind === 'position' ? (
          <>
            <span className={SOLVED_TEXT}>
              {change.label} moved {fmtCm(change.moveCm ?? 0)} cm {change.dir ? DIR_WORD[change.dir] : ''}
            </span>
            {lengthChanged && (
              <span className={MUTED}>
                (length {fmtCm(change.lengthFromCm!)} → {fmtCm(change.lengthToCm!)} cm)
              </span>
            )}
          </>
        ) : (
          <span className={SOLVED_TEXT}>
            {change.label} thickness {fmtCm(change.fromCm ?? 0)} → {fmtCm(change.toCm ?? 0)} cm
          </span>
        )}
      </span>
      <button
        type="button"
        data-solver-revoke={`${change.kind}:${change.wallId}`}
        onClick={() => onRevoke({ kind: change.kind, wallId: change.wallId })}
        className={`${BTN} shrink-0 text-xs`}
      >
        Revoke
      </button>
    </li>
  )
}

/** One kept (revoked or edited) wall row with a Restore button. */
function KeptWallRow({ doc, hold, onRestore }: {
  doc: PlanDoc
  hold: SolverHold
  onRestore: (key: SolverKey) => void
}) {
  const label = wallLabel(doc, hold.wallId)
  const hoverLabel = hoverLabelForWall(doc, hold.wallId)
  const hover = useRowHover(hoverLabel)
  const reason = hold.by === 'edit' ? '(you edited it)' : '(revoked)'
  // A wall can be held twice: its position and its thickness. The row says which one.
  const kind = hold.kind === 'thickness' ? 'thickness' : 'position'
  return (
    <li
      data-solver-kept={`${hold.kind}:${hold.wallId}`}
      data-hover-row={hoverLabel}
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
      className="flex min-h-9 items-center gap-2 py-1 pointer-coarse:min-h-11"
    >
      <span className="flex min-w-0 flex-1 flex-col text-xs leading-snug">
        <span>{label} {kind}: kept at plan value</span>
        <span className={MUTED}>{reason}</span>
      </span>
      <button
        type="button"
        data-solver-restore={`${hold.kind}:${hold.wallId}`}
        onClick={() => onRestore({ kind: hold.kind, wallId: hold.wallId })}
        className={`${BTN} shrink-0 text-xs`}
      >
        Restore
      </button>
    </li>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One progress line: "3 rooms, 7 of 18 walls measured, average mismatch 0,8 cm, 2 rooms locked." */
function totalsText(rows: readonly ProgressRow[]): string {
  const t = progressTotals(rows)
  const parts = [plural(t.rooms, 'room'), `${t.verified} of ${t.walls} walls measured`]
  if (t.residualCm !== null) parts.push(`average mismatch ${fmtCm(t.residualCm)} cm`)
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
                className={`shrink-0 font-mono text-xs tabular-nums ${row.verified ? MEASURED_TEXT : MUTED}`}
              >
                {row.verified}/{row.walls}
              </span>
              {row.residualCm !== null && (
                <span
                  data-solve-residual={row.code}
                  title="Average mismatch of the measured values against the plan"
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

/** The whole tab from plain data, so it can be rendered without the stores (tests, SSR). */
export function SolvePanelView({
  doc,
  mode,
  surfaceMode,
  onSurfaceMode,
  angles,
  onAngles,
  onToggleSolver,
  onRevoke,
  onRestore,
  nowMs,
  tipDefaultOpen,
}: {
  doc: PlanDoc
  /** Current app mode (default: UI store mode). */
  mode?: Mode
  /** Current surface reference mode (default: the value of the UI store). */
  surfaceMode?: SurfaceMode
  onSurfaceMode?: (m: SurfaceMode) => void
  /** Current room angles mode (default: the value of the UI store). */
  angles?: RoomAngles
  onAngles?: (a: RoomAngles) => void
  onToggleSolver?: (on: boolean) => void
  onRevoke?: (key: SolverKey) => void
  onRestore?: (key: SolverKey) => void
  /** Optional current epoch ms for deterministic relative time in tests. */
  nowMs?: number
  /** Start the "?" tip open (tests only). */
  tipDefaultOpen?: boolean
}) {
  const rows = progressRows(doc)
  const appMode = mode ?? useUi.getState().mode
  const sMode = surfaceMode ?? useUi.getState().solveSurfaceMode
  const setMode = onSurfaceMode ?? ((m: SurfaceMode) => useUi.getState().set({ solveSurfaceMode: m }))
  const roomAngles = angles ?? useUi.getState().solveAngles
  const setAngles = onAngles ?? ((a: RoomAngles) => useUi.getState().set({ solveAngles: a }))
  const handleToggle = onToggleSolver ?? ((on: boolean) => { setSolverEnabled(on) })
  const handleRevoke = onRevoke ?? ((key: SolverKey) => { revokeSolverChange(key) })
  const handleRestore = onRestore ?? ((key: SolverKey) => { restoreSolverChange(key) })

  const solverOn = Boolean(doc.solver?.enabled)
  const changes = doc.solver?.changes ?? []
  const revoked = doc.solver?.revoked ?? []

  return (
    <>
      <SolverSwitchSection
        doc={doc}
        mode={appMode}
        onToggle={handleToggle}
        nowMs={nowMs}
        tipDefaultOpen={tipDefaultOpen}
      />

      {solverOn && (
        <PanelSection id="solve-changes" title="Changes" collapsible>
          {changes.length > 0 ? (
            <ul data-solver-changes className="flex flex-col">
              {changes.map((c) => (
                <ChangeRow key={`${c.kind}:${c.wallId}`} doc={doc} change={c} onRevoke={handleRevoke} />
              ))}
            </ul>
          ) : (
            <EmptyHint>The solver changed nothing.</EmptyHint>
          )}
        </PanelSection>
      )}

      {revoked.length > 0 && (
        <PanelSection id="solve-kept" title="Kept walls" collapsible>
          <ul data-solver-kept-list className="flex flex-col">
            {revoked.map((h) => (
              <KeptWallRow key={`${h.kind}:${h.wallId}`} doc={doc} hold={h} onRestore={handleRestore} />
            ))}
          </ul>
        </PanelSection>
      )}

      <PanelSection id="solve-progress" title="Progress" icon={<Ruler size={16} />} collapsible>
        <ProgressRows rows={rows} />
      </PanelSection>

      <MeasureNext doc={doc} surfaceMode={sMode} angles={roomAngles} />

      {/* The settings come last and stay closed: they are set once, and the work stays in view. */}
      <PanelSection id="solve-settings" title="Settings" collapsible defaultOpen={false}>
        <FieldRow label="Precision (cm)" stacked>
          <Segmented
            ariaLabel="Precision of solved corners and thicknesses"
            options={PRECISIONS}
            value={String(planPrecision(doc))}
            onChange={setPrecision}
          />
        </FieldRow>
        <EmptyHint>
          Smallest step for the corners and wall thicknesses that the solver writes.
          Default 0,5 cm. Off keeps the exact result.
        </EmptyHint>
        <KeepLockedToggle />
        <SnapThicknessToggle />
        <SurfaceModeRow
          mode={sMode}
          hasReferences={(doc.apartment?.references ?? []).length > 0}
          onChange={setMode}
        />
        <RoomAnglesRow angles={roomAngles} onChange={setAngles} />
      </PanelSection>
    </>
  )
}

/** Sidebar "Solve" tab, wired to the stores. */
export function SolvePanel() {
  const doc = useDoc((s) => s.doc)
  const mode = useUi((s) => s.mode)
  const surfaceMode = useUi((s) => s.solveSurfaceMode)
  const angles = useUi((s) => s.solveAngles)
  return <SolvePanelView doc={doc} mode={mode} surfaceMode={surfaceMode} angles={angles} />
}
