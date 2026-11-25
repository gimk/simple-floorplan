// Inspect card for ONE stored wall of a v2 document (docs/walls-plan.md, "Walls in the
// interface"): the wall is one object with two sides, so the card shows the wall once and then
// what each side sees.
//   Wall W12      : type, renovation, thickness, 'In line on' (Side A | Centre | Side B, the side
//                   of the wall; the stored value is relative to a room face, see cards.ts),
//                   lock, length (centre) and its value W12-C. A single wall (no room sees it)
//                   also has its DRAWN length: the field moves node b along the wall, one undo step.
//   Side A / B    : the faces of that side in order along the wall (room code + name, its label
//                   'EN-3', the value field, 'Measured x · Solved y'), and 'Outside' for a span
//                   that no room covers (with the facade value W12-E when the whole side is out).
//                   The header of each side is a BUTTON (`aria-pressed`): it selects that side, so
//                   the plan highlights it, and the active side carries a 'Selected' tag (a word,
//                   not colour only). A single wall (no room at all) shows 'Outside' on both sides.
//   Doors and windows on this wall : the elements whose `wallId` is this wall.
//   Delete wall   : the trash button of the header (one delete per card). It is refused while a
//                   room uses the wall (a toast names the rooms).
// The side the user clicked on the canvas is highlighted. All lengths are cm, one undo step per
// edit of the wall itself; a value is not an undo step (same as Measuring Mode).
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Check, DoorOpen, Ruler, Trash2 } from 'lucide-react'
import { dist, fmtCm } from '../../model/geometry'
import { useUi } from '../../model/store'
import type { PlanDoc, WallStatus, WallType } from '../../model/types'
import { targetOfLabel } from '../../model/v2/targets'
import { wallValueLabel } from '../../model/wallValues'
import { setMeasurement } from '../measure/actions'
import { NumField } from '../measure/NumField'
import {
  ERROR, EmptyHint, FIELD_GAP, FieldRow, HEADING, IconButton, MUTED, NumberField, PANEL_CARD, PanelSection, ROW, ROW_GAP, ROW_OFF, ROW_ON, SECTION_PAD,
  Segmented, SwitchRow,
} from '../../shell/panel'
import { MEASURED_TEXT, SOLVED_TEXT } from '../../shell/panel/styles'
import { solverChangeForLabel, wallSolvedSummary } from '../solver/lookup'
import type { AlignSideChoice } from './cards'
import {
  alignOfSideChoice, alignSideChoice, deleteStoredWall, patchStoredWall, setStoredWallSide,
  setStoredWallFace, setStoredWallLength, structuralWarning, update, wallOwnerSide, WALL_ALIGN_SIDES, WALL_STATUSES, WALL_TYPES,
} from './cards'
import { ElementList } from './ElementList'
import { KIND_LABEL, VARIANT_LABEL } from '../elements/geometry'
import type { ElementRow } from './roomLists'
import { sideFaceKeys, storedWallView, type WallSideFace, type WallSideView } from './wallSides'

/** The title of the card: 'Wall W12'. */
const wallTitle = (wallId: string) => `Wall ${wallId}`

/** Elements that sit on one stored wall, in order along the wall. */
function wallElements(doc: Pick<PlanDoc, 'elements'>, wallId: string): ElementRow[] {
  return (doc.elements ?? [])
    .filter((e) => e.wallId === wallId)
    .sort((a, b) => (a.alongCm ?? a.offsetCm) - (b.alongCm ?? b.offsetCm))
    .map((e) => ({
      id: e.id,
      kindLabel: KIND_LABEL[e.kind] ?? e.kind,
      variantLabel: e.variant ? VARIANT_LABEL[e.variant] ?? null : null,
      wallStart: e.wallStart,
      wallLabel: null,
      widthCm: e.widthCm,
      offsetCm: e.alongCm ?? e.offsetCm,
    }))
}

export function StoredWallCard({ doc, wallId, side, face }: {
  doc: PlanDoc; wallId: string; side?: 'L' | 'R'; face?: string
}) {
  const view = useMemo(() => storedWallView(doc, wallId), [doc, wallId])
  const measureSource = useUi((s) => s.measureSource)
  const select = useUi.getState().select

  // Delete / Backspace is handled by `deleteSelection` (features/rooms/interaction.ts): one handler.

  if (!view) return <EmptyHint>This wall is not on the plan any more.</EmptyHint>
  const { wall, props } = view
  const centreLabel = wallValueLabel(wall.id, 'centre')
  const centreValue = doc.measurements[centreLabel]?.actualCm ?? null
  // "In line on" is relative to a ROOM face (the room the solver takes first), the card shows the
  // side of the wall (Side A = side L, Side B = side R).
  const owner = wallOwnerSide(doc, wall.id)
  // A wall that no room sees (single wall, or left by a deleted room): its drawn length is editable.
  const single = view.rooms.length === 0
  const drawnCm = Math.round(dist(view.a, view.b) * 10) / 10

  const fmtDiff = (planCm: number, measuredCm: number) => {
    const d = Math.round((planCm - measuredCm) * 10) / 10
    return d === 0 ? '0 cm' : `${d > 0 ? '+' : '-'}${fmtCm(Math.abs(d))} cm`
  }

  /** 'Measured x · Solved y (diff)' or 'Measured x · Plan y (diff)' from recorded solver state. */
  const solvedLine = (label: string, measuredCm: number, planCm: number | null) => {
    if (planCm == null) {
      return (
        <p className={MUTED} data-solved-line={label}>
          <span className={MEASURED_TEXT}>Measured {fmtCm(measuredCm)}</span>
        </p>
      )
    }
    const changed = solverChangeForLabel(doc, label) !== undefined
    return (
      <p className={MUTED} data-solved-line={label}>
        <span className={MEASURED_TEXT}>Measured {fmtCm(measuredCm)}</span>
        {' · '}
        {changed
          ? <span className={SOLVED_TEXT}>Solved {fmtCm(planCm)} ({fmtDiff(planCm, measuredCm)})</span>
          : <>Plan {fmtCm(planCm)} ({fmtDiff(planCm, measuredCm)})</>}
      </p>
    )
  }

  const removeWallButton = () => {
    deleteStoredWall(wall.id)
  }

  return (
    <>
      <PanelSection
        title={wallTitle(wall.id)}
        icon={<Ruler size={16} />}
        actions={
          <IconButton
            label={wall.locked ? 'Delete wall (this wall is locked: unlock it first)' : 'Delete wall'}
            variant="danger" icon={<Trash2 size={16} />} disabled={!!wall.locked} onClick={removeWallButton}
          />
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
                aria-label={`Select room ${r.name} (${r.code})`}
                title={`${r.code} — ${r.name}`}
                className="inline-flex min-h-9 items-center rounded px-2 font-mono text-xs underline hover:no-underline pointer-coarse:min-h-11"
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
            ariaLabel="Side of the wall that lines up with the walls that continue it"
            options={WALL_ALIGN_SIDES}
            value={alignSideChoice(props.align, owner)}
            onChange={(choice) =>
              patchStoredWall(wall.id, { align: alignOfSideChoice(choice as AlignSideChoice, owner) })
            }
          />
        </FieldRow>
        {single && (
          // A single wall (no room sees it): the drawn length is the only length it has, so the
          // card moves its far end (node b) along the wall, in one undo step.
          <FieldRow label="Drawn length" htmlFor={`stored-wall-${wall.id}-drawn`} hint="moves the far end">
            <NumberField
              id={`stored-wall-${wall.id}-drawn`}
              name="wallDrawnLength"
              unit="cm"
              value={drawnCm}
              min={1}
              onCommit={(v) => {
                if (v === null || !(v > 0)) return false
                update((d) => setStoredWallLength(d, wall.id, v))
                return true
              }}
            />
          </FieldRow>
        )}
        {/* Length of the wall, on its CENTRE line: the value 'W12-C' read on the architect plan.
            The label holds the value name and 'node to node' is a short muted subline, so the row
            stays one line high (visual review V-9: three lines was too tall). */}
        <FieldRow
          label={`Length (${centreLabel})`}
          htmlFor={`stored-wall-${wall.id}-centre`}
          hint="node to node"
          className="[&_label>span]:text-[11px]"
        >
          <NumberField
            id={`stored-wall-${wall.id}-centre`}
            name="wallCentre"
            unit="cm"
            value={centreValue}
            placeholder={fmtCm(view.centreCm)}
            min={1}
            onCommit={(v) => {
              if (v !== null && !(v > 0)) return false
              setMeasurement(centreLabel, v, 'plan', targetOfLabel(doc, centreLabel))
              return true
            }}
          />
        </FieldRow>
        {centreValue != null
          ? solvedLine(centreLabel, centreValue, view.centreCm)
          : (() => {
              const note = wallSolvedSummary(doc, wall.id)
              return note ? <p className={`text-xs ${SOLVED_TEXT}`} data-wall-solved={wall.id}>{note}</p> : null
            })()}
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
          wallId={wall.id}
          doc={doc}
          view={s}
          active={side === s.side && face === undefined}
          activeFace={face}
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
    </>
  )
}

/**
 * One side of the wall: its faces in order along the wall, in the room's own order. The header is a
 * BUTTON: a click selects this side (`selection.side`), so the plan highlights that side of the
 * wall (docs/walls-plan.md "Walls in the interface"). The other side keeps its faces one click
 * away, so the user reads and measures either side at will.
 */
function SideSection({ wallId, doc, view, active, activeFace, measureSource, solvedLine }: {
  wallId: string
  doc: PlanDoc
  view: WallSideView
  active: boolean
  /** Key of the selected face (`Selection.face`), when the user picked one face. */
  activeFace?: string
  measureSource: Parameters<typeof setMeasurement>[2]
  solvedLine: (label: string, measuredCm: number, planCm: number | null) => ReactNode
}) {
  const select = useUi.getState().select
  const keys = sideFaceKeys(view)
  const hasFace = activeFace !== undefined && keys.includes(activeFace)
  return (
    <section
      className={`${PANEL_CARD} ${SECTION_PAD} flex flex-col ${active || hasFace ? 'ring-2 ring-orange-500/60' : ''}`}
      aria-label={`Side ${view.letter}`}
    >
      <div className="flex min-h-9 items-center gap-1 pointer-coarse:min-h-11">
        <button
          type="button"
          aria-pressed={active}
          data-wall-side-button={view.side}
          title={`Show side ${view.letter} on the plan`}
          onClick={() => setStoredWallSide(wallId, view.side)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11"
        >
          <span className={`truncate ${HEADING}`}>Side {view.letter}</span>
          {active && (
            // A word, not colour only: the side the user clicked is named on the card.
            <span className="shrink-0 rounded bg-orange-700 px-1.5 py-0.5 text-[10px] font-medium text-white">Selected</span>
          )}
        </button>
      </div>
      <ul className={`mt-3 flex flex-col ${ROW_GAP}`} data-wall-side={view.side} data-wall-side-active={active ? 'true' : 'false'}>
        {view.faces.length === 0 && (
          // A side that no room covers and that has no face at all: a single wall (the Wall tool,
          // or a wall left by a deleted room), or the free side of a facade.
          <li className={`flex min-h-9 min-w-0 items-center gap-2 ${ROW} ${ROW_OFF} pointer-coarse:min-h-11`} data-wall-outside="none">
            <span className="min-w-0 flex-1 truncate text-xs">Outside</span>
            {view.facadeLabel && <span className={`shrink-0 font-mono ${MUTED}`}>{view.facadeLabel}</span>}
          </li>
        )}
        {view.faces.map((face, i) => (
          <li key={`${face.from}-${face.to}-${face.kind === 'room' ? face.label : 'out'}`}
            data-wall-face-row={keys[i]}
            // A click on the row (not on a field or a button) selects this face.
            onClick={(e) => {
              if (e.target instanceof Element && e.target.closest('input, button, a, textarea, select')) return
              setStoredWallFace(wallId, view.side, keys[i])
            }}
            className={`${ROW} ${activeFace === keys[i] ? ROW_ON : ROW_OFF}`}>
            {face.kind === 'room'
              ? (
                <RoomFaceRow
                  doc={doc}
                  face={face}
                  active={view.letter}
                  measureSource={measureSource}
                  solvedLine={solvedLine}
                  onSelectRoom={() => select({ kind: 'room', roomId: face.roomId })}
                  selected={activeFace === keys[i]}
                  onSelectFace={() => setStoredWallFace(wallId, view.side, keys[i])}
                />
              )
              : (
                <OutsideRow
                  doc={doc} face={face} view={view} measureSource={measureSource} solvedLine={solvedLine}
                  selected={activeFace === keys[i]}
                  onSelectFace={() => setStoredWallFace(wallId, view.side, keys[i])}
                />
              )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One face of one room on this side: code + name, label, value field, measured / solved. */
function RoomFaceRow({ doc, face, active, measureSource, solvedLine, onSelectRoom, selected, onSelectFace }: {
  doc: PlanDoc
  face: Extract<WallSideFace, { kind: 'room' }>
  active: string
  measureSource: Parameters<typeof setMeasurement>[2]
  solvedLine: (label: string, measuredCm: number, planCm: number | null) => ReactNode
  onSelectRoom: () => void
  selected: boolean
  onSelectFace: () => void
}) {
  const verified = face.measuredCm != null
  return (
    <div className={`flex min-w-0 flex-col ${FIELD_GAP}`} data-wall-face={face.label}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onSelectRoom}
          title={`Room ${face.name}`}
          aria-label={`Select room ${face.name} (${face.code})`}
          className="inline-flex min-h-9 min-w-0 flex-1 items-center gap-1 rounded text-left text-xs hover:underline pointer-coarse:min-h-11"
        >
          <span className="shrink-0 font-mono font-semibold">{face.code}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{face.name}</span>
        </button>
        <FaceButton selected={selected} onSelect={onSelectFace} title={`Show face ${face.label} on the plan`}
          className={verified ? MEASURED_TEXT : MUTED}>
          {verified && <Check size={11} role="img" aria-label="measured" className="mr-0.5 inline align-[-1px]" />}
          {face.label}
        </FaceButton>
      </div>
      <NumField
        id={`stored-wall-${face.label}`}
        compact
        value={face.measuredCm ?? undefined}
        placeholder={face.plannedCm != null ? fmtCm(face.plannedCm) : undefined}
        ariaLabel={`Measured ${face.label} (${face.code}, side ${active})`}
        onValue={(n) => setMeasurement(face.label, n, measureSource, targetOfLabel(doc, face.label))}
      />
      {verified && solvedLine(face.label, face.measuredCm!, face.plannedCm)}
    </div>
  )
}

/**
 * A span of this side that no room covers. When the whole side is outside (a facade), the span
 * carries the outside face value 'W12-E': outside corner to outside corner, measured from outside.
 */
function OutsideRow({ doc, face, view, measureSource, solvedLine, selected, onSelectFace }: {
  doc: PlanDoc
  face: Extract<WallSideFace, { kind: 'outside' }>
  view: WallSideView
  measureSource: Parameters<typeof setMeasurement>[2]
  solvedLine: (label: string, measuredCm: number, planCm: number | null) => ReactNode
  selected: boolean
  onSelectFace: () => void
}) {
  const label = view.facadeLabel
  const value = label ? doc.measurements[label]?.actualCm ?? null : null
  return (
    <div className={`flex min-w-0 flex-col ${FIELD_GAP}`} data-wall-outside={fmtCm(face.lengthCm)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex min-h-9 min-w-0 flex-1 items-center truncate text-xs pointer-coarse:min-h-11">{label ? 'Outside (facade)' : 'Outside'}</span>
        <FaceButton selected={selected} onSelect={onSelectFace} title="Show this outside span on the plan" className={MUTED}>
          {label ?? 'no value'}
        </FaceButton>
      </div>
      {label && (
        <>
          <NumField
            id={`stored-wall-${label}`}
            compact
            value={value ?? undefined}
            placeholder={view.facadePlannedCm != null ? fmtCm(view.facadePlannedCm) : undefined}
            ariaLabel={`Measured ${label} (outside face)`}
            onValue={(n) => setMeasurement(label, n, measureSource, targetOfLabel(doc, label))}
          />
          {value != null && solvedLine(label, value, view.facadePlannedCm)}
        </>
      )}
    </div>
  )
}

/**
 * The button of one face row: a click selects that face (`aria-pressed`), and the selected row
 * carries a 'Selected' word, not colour only (same as the header of a side).
 */
function FaceButton({ selected, onSelect, title, className, children }: {
  selected: boolean
  onSelect: () => void
  title: string
  className: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={onSelect}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded px-1 font-mono text-xs hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11 ${className}`}
    >
      {children}
      {selected && <span className="rounded bg-orange-700 px-1.5 py-0.5 font-sans text-[10px] font-medium text-white">Selected</span>}
    </button>
  )
}
