// Inspect card for ONE stored wall of a v2 document (docs/walls-plan.md, "Walls in the
// interface"): the wall is one object with two sides, so the card shows the wall once and then
// what each side sees.
//   Wall W12      : type, renovation, thickness, line, lock, length (centre) and its value W12-C
//   Side A / B    : the faces of that side in order along the wall (room code + name, its label
//                   'EN-3', the value field, 'Measured x · Solved y'), and 'Outside' for a span
//                   that no room covers (with the facade value W12-E when the whole side is out).
//   Doors and windows on this wall : the elements whose `wallId` is this wall.
//   Delete wall   : refused while a room uses the wall (a toast names the rooms).
// The side the user clicked on the canvas is highlighted. All lengths are cm, one undo step per
// edit of the wall itself; a value is not an undo step (same as Measuring Mode).
import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Check, DoorOpen, Ruler, Trash2 } from 'lucide-react'
import { fmtCm } from '../../model/geometry'
import { useUi } from '../../model/store'
import type { PlanDoc, WallAlign, WallStatus, WallType } from '../../model/types'
import { targetOfLabel } from '../../model/v2/targets'
import { wallValueLabel } from '../../model/wallValues'
import { setMeasurement } from '../measure/actions'
import { NumField } from '../measure/NumField'
import {
  BTN, ERROR, EmptyHint, FieldRow, IconButton, MUTED, NumberField, PanelSection, Segmented, SwitchRow,
} from '../../shell/panel'
import { toast } from '../toast'
import { solveGlobal } from './globalSolve'
import {
  deleteStoredWall, patchStoredWall, refusedDeleteText, structuralWarning, WALL_ALIGNS, WALL_STATUSES, WALL_TYPES,
} from './cards'
import { ElementList } from './ElementList'
import { KIND_LABEL, VARIANT_LABEL } from '../elements/geometry'
import type { ElementRow } from './roomLists'
import { storedWallView, type WallSideFace, type WallSideView } from './wallSides'

/** The title of the card: 'Wall W12'. */
const wallTitle = (wallId: string) => `Wall ${wallId}`

/** Elements that sit on one stored wall, in order along the wall. */
function wallElements(doc: Pick<PlanDoc, 'elements'>, wallId: string): ElementRow[] {
  return (doc.elements ?? [])
    .filter((e) => e.wallId === wallId)
    .sort((a, b) => (a.alongCm ?? a.offsetCm) - (b.alongCm ?? b.offsetCm))
    .map((e) => ({
      id: e.id,
      kindLabel: KIND_LABEL[e.kind],
      variantLabel: e.variant ? VARIANT_LABEL[e.variant] ?? null : null,
      wallStart: e.wallStart,
      wallLabel: null,
      widthCm: e.widthCm,
      offsetCm: e.alongCm ?? e.offsetCm,
    }))
}

export function StoredWallCard({ doc, wallId, side }: {
  doc: PlanDoc; wallId: string; side?: 'L' | 'R'
}) {
  const view = useMemo(() => storedWallView(doc, wallId), [doc, wallId])
  const measureSource = useUi((s) => s.measureSource)
  const select = useUi.getState().select
  // What the solver says the values are now (only when the wall or one of its faces has a value).
  const solved = useMemo(() => {
    const labels = [wallValueLabel(wallId, 'centre'), wallValueLabel(wallId, 'outside')]
    if (view) labels.push(...view.sides.flatMap((s) => s.faces.flatMap((f) => (f.kind === 'room' && f.measuredCm != null ? [f.label] : []))))
    if (!labels.some((l) => doc.measurements[l] != null)) return null
    return new Map(solveGlobal(doc).residuals.map((r) => [r.label, r]))
  }, [doc, wallId, view])

  // Delete / Backspace removes the whole wall, like the button (docs: one wall, one object).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) return
      if (useUi.getState().mode !== 'edit') return
      e.preventDefault()
      const res = deleteStoredWall(wallId)
      if (!res.removed && res.refusedBy.length) toast(refusedDeleteText(wallId, res.refusedBy))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wallId])

  if (!view) return <EmptyHint>This wall is not on the plan any more.</EmptyHint>
  const { wall, props } = view
  const centreLabel = wallValueLabel(wall.id, 'centre')
  const centreValue = doc.measurements[centreLabel]?.actualCm ?? null

  /** 'Measured x · Solved y' under a field, when the value exists. */
  const solvedLine = (label: string, measuredCm: number) => {
    const r = solved?.get(label)
    return (
      <p className={MUTED} data-solved-line={label}>
        Measured {fmtCm(measuredCm)}{r ? ` · Solved ${fmtCm(r.solvedCm)}` : ' · not used by the solve'}
      </p>
    )
  }

  const removeWallButton = () => {
    const res = deleteStoredWall(wall.id)
    if (!res.removed && res.refusedBy.length) toast(refusedDeleteText(wall.id, res.refusedBy))
  }

  return (
    <>
      <PanelSection
        title={wallTitle(wall.id)}
        icon={<Ruler size={16} />}
        actions={
          <IconButton label="Delete wall" variant="danger" icon={<Trash2 size={16} />} onClick={removeWallButton} />
        }
      >
        {view.rooms.length > 0 && (
          // The rooms of the two sides: a link to each one (the breadcrumb has no room, the wall
          // belongs to none of them: see shell/sidebar/trail.ts).
          <p className={`flex flex-wrap items-center gap-1 ${MUTED}`} data-wall-rooms={wall.id}>
            <span>Rooms:</span>
            {view.rooms.map((r) => (
              <button
                key={r.roomId}
                type="button"
                onClick={() => select({ kind: 'room', roomId: r.roomId })}
                className="rounded px-1 font-mono text-xs underline hover:no-underline"
              >
                {r.code}
              </button>
            ))}
          </p>
        )}
        <FieldRow label="Type" stacked>
          <Segmented
            ariaLabel="Wall type"
            options={WALL_TYPES}
            value={props.type}
            onChange={(t) => patchStoredWall(wall.id, { type: t as WallType })}
          />
        </FieldRow>
        <FieldRow label="Renovation" stacked>
          <Segmented
            ariaLabel="Wall status"
            options={WALL_STATUSES}
            value={props.status ?? 'existing'}
            onChange={(s) => patchStoredWall(wall.id, { status: s as WallStatus })}
          />
        </FieldRow>
        {props.status === 'demolish' && (props.type === 'bearing' || props.type === 'exterior') && (
          <p role="alert" className={`${ERROR} rounded border border-red-600/50 bg-red-500/10 px-2 py-1 font-semibold dark:border-red-400/50`}>
            {structuralWarning(props.type)}
          </p>
        )}
        <FieldRow label="Thickness" htmlFor="stored-wall-thickness">
          <NumberField
            id="stored-wall-thickness"
            name="thickness"
            unit="cm"
            value={props.thicknessCm}
            min={1}
            max={200}
            onCommit={(v) => {
              if (v === null || v < 1 || v > 200) return false
              patchStoredWall(wall.id, { thicknessCm: v })
            }}
          />
        </FieldRow>
        <FieldRow label="In line on" stacked>
          <Segmented
            ariaLabel="Line of the wall that lines up with the next walls"
            options={WALL_ALIGNS}
            value={props.align ?? 'room'}
            onChange={(a) => patchStoredWall(wall.id, { align: a as WallAlign })}
          />
        </FieldRow>
        {/* Length of the wall, on its CENTRE line: the value 'W12-C' read on the architect plan. */}
        <FieldRow label="Length (centre)" htmlFor={`stored-wall-${wall.id}-centre`} hint={`${centreLabel} · node to node`}>
          <NumberField
            id={`stored-wall-${wall.id}-centre`}
            name="wallCentre"
            unit="cm"
            value={centreValue}
            placeholder={fmtCm(view.centreCm)}
            min={1}
            disabled={!!props.locked}
            onCommit={(v) => {
              if (v !== null && !(v > 0)) return false
              setMeasurement(centreLabel, v, 'plan', targetOfLabel(doc, centreLabel))
              return true
            }}
          />
        </FieldRow>
        {centreValue != null && solvedLine(centreLabel, centreValue)}
        <SwitchRow
          name="storedWallLocked"
          label="Locked (cannot be moved or resized)"
          checked={!!props.locked}
          onChange={(checked) => patchStoredWall(wall.id, { locked: checked })}
        />
      </PanelSection>

      {view.sides.map((s) => (
        <SideSection
          key={s.side}
          doc={doc}
          view={s}
          active={side === s.side}
          measureSource={measureSource}
          solvedLine={solvedLine}
        />
      ))}

      <PanelSection id="stored-wall-elements" title="Doors and windows on this wall" icon={<DoorOpen size={16} />} collapsible>
        {(() => {
          const rows = wallElements(doc, wall.id)
          return rows.length
            ? <ElementList rows={rows} show="offset" onSelect={(id) => select({ kind: 'element', elementId: id })} />
            : <EmptyHint>No door, window or fixture on this wall.</EmptyHint>
        })()}
      </PanelSection>

      <div className="flex">
        <button
          type="button"
          onClick={removeWallButton}
          className={`${BTN} flex-1 border-red-600/40 text-red-700 hover:bg-red-500/10 dark:border-red-400/40 dark:text-red-300`}
        >
          <Trash2 size={14} /> Delete wall
        </button>
      </div>
    </>
  )
}

/** One side of the wall: its faces in order along the wall, in the room's own order. */
function SideSection({ doc, view, active, measureSource, solvedLine }: {
  doc: PlanDoc
  view: WallSideView
  active: boolean
  measureSource: Parameters<typeof setMeasurement>[2]
  solvedLine: (label: string, measuredCm: number) => ReactNode
}) {
  const select = useUi.getState().select
  return (
    <PanelSection
      title={`Side ${view.letter}`}
      collapsible
      id={`stored-wall-side-${view.side}`}
      className={active ? 'ring-2 ring-orange-500/60' : undefined}
      description={view.outside ? 'No room on this side.' : undefined}
    >
      <ul className="flex flex-col gap-2" data-wall-side={view.side} data-wall-side-active={active ? 'true' : 'false'}>
        {view.faces.map((face) => (
          <li key={`${face.from}-${face.to}-${face.kind === 'room' ? face.label : 'out'}`}>
            {face.kind === 'room'
              ? (
                <RoomFaceRow
                  doc={doc}
                  face={face}
                  active={view.letter}
                  measureSource={measureSource}
                  solvedLine={solvedLine}
                  onSelectRoom={() => select({ kind: 'room', roomId: face.roomId })}
                />
              )
              : <OutsideRow doc={doc} face={face} view={view} measureSource={measureSource} solvedLine={solvedLine} />}
          </li>
        ))}
      </ul>
    </PanelSection>
  )
}

/** One face of one room on this side: code + name, label, value field, measured / solved. */
function RoomFaceRow({ doc, face, active, measureSource, solvedLine, onSelectRoom }: {
  doc: PlanDoc
  face: Extract<WallSideFace, { kind: 'room' }>
  active: string
  measureSource: Parameters<typeof setMeasurement>[2]
  solvedLine: (label: string, measuredCm: number) => ReactNode
  onSelectRoom: () => void
}) {
  const verified = face.measuredCm != null
  return (
    <div className="flex min-w-0 flex-col gap-1" data-wall-face={face.label}>
      <div className="flex min-w-0 items-baseline gap-2">
        <button
          type="button"
          onClick={onSelectRoom}
          title={`Room ${face.name}`}
          className="min-w-0 flex-1 truncate rounded text-left text-xs hover:underline"
        >
          <span className="font-mono font-semibold">{face.code}</span> · {face.name}
        </button>
        <span className={`shrink-0 font-mono text-[11px] ${verified ? 'text-green-700 dark:text-green-400' : MUTED}`}>
          {verified && <Check size={11} role="img" aria-label="measured" className="mr-0.5 inline align-[-1px]" />}
          {face.label}
        </span>
      </div>
      <NumField
        id={`stored-wall-${face.label}`}
        value={face.measuredCm ?? undefined}
        placeholder={face.plannedCm != null ? fmtCm(face.plannedCm) : undefined}
        ariaLabel={`Measured ${face.label} (${face.code}, side ${active})`}
        onValue={(n) => setMeasurement(face.label, n, measureSource, targetOfLabel(doc, face.label))}
      />
      {verified && solvedLine(face.label, face.measuredCm!)}
    </div>
  )
}

/**
 * A span of this side that no room covers. When the whole side is outside (a facade), the span
 * carries the outside face value 'W12-E': outside corner to outside corner, measured from outside.
 */
function OutsideRow({ doc, face, view, measureSource, solvedLine }: {
  doc: PlanDoc
  face: Extract<WallSideFace, { kind: 'outside' }>
  view: WallSideView
  measureSource: Parameters<typeof setMeasurement>[2]
  solvedLine: (label: string, measuredCm: number) => ReactNode
}) {
  const label = view.facadeLabel
  const value = label ? doc.measurements[label]?.actualCm ?? null : null
  return (
    <div className="flex min-w-0 flex-col gap-1" data-wall-outside={fmtCm(face.lengthCm)}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs">{label ? 'Outside (facade)' : 'Outside'}</span>
        <span className={`shrink-0 font-mono text-[11px] ${MUTED}`}>{label ?? 'no value'}</span>
      </div>
      {label && (
        <>
          <NumField
            id={`stored-wall-${label}`}
            value={value ?? undefined}
            placeholder={view.facadePlannedCm != null ? fmtCm(view.facadePlannedCm) : undefined}
            ariaLabel={`Measured ${label} (outside face)`}
            onValue={(n) => setMeasurement(label, n, measureSource, targetOfLabel(doc, label))}
          />
          {value != null && solvedLine(label, value)}
        </>
      )}
    </div>
  )
}
