// Inspect card for one wall (or a Shift + click group of walls): type, renovation state,
// thickness, line, length, lock, and the elements on the wall. The header steps to the
// previous / next wall of the same room (docs/sidebar-plan-3.md step 4).
import { facadePlannedLengths } from './outside/outsideDims'
import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtCm, innerWallLengths, roomWalls } from '../../model/geometry'
import { planPrecision, shownLength } from '../../model/precision'
import { useUi } from '../../model/store'
import type { PlanDoc, Room, StoredWall, WallAlign, WallStatus, WallType } from '../../model/types'
import {
  outsideFaceSide, storedWallOfRoomWall, wallCentreCm, wallOutsidePlanCm, wallValueLabel,
} from '../../model/wallValues'
import { setMeasurement } from '../measure/actions'
import { solveGlobal } from './globalSolve'
import { EmptyHint, FieldRow, IconButton, NumberField, PanelSection, Segmented, SwitchRow } from '../../shell/panel'
import {
  WALL_ALIGNS,
  WALL_STATUSES,
  WALL_TYPES,
  adjacentWallStart,
  patchWalls,
  setWallAligns,
  setWallLength,
  setWallTypes,
  structuralWarning,
  type WallRef,
} from './cards'
import { ElementList } from './ElementList'
import { wallElementRows } from './roomLists'
import { wallProps } from './walls'
import { isV2Doc } from '../../model/v2/targets'
import { StoredWallCard } from './StoredWallCard'
import { sideOfRoomWall } from './wallSides'

/** Survey label of a wall reference, e.g. "SE-2"; "?" when the room or the wall is gone. */
function refLabel(doc: PlanDoc, w: WallRef): string {
  const r = doc.rooms.find((x) => x.id === w.roomId)
  const i = r ? r.vertices.findIndex((v) => v.id === w.wallStart) : -1
  return r && i >= 0 ? `${r.code}-${i + 1}` : '?'
}

export function WallCard({ doc, room, wallStart, group }: {
  doc: PlanDoc; room: Room; wallStart: string; group: WallRef[] | null
}) {
  const walls = roomWalls(room)
  const wall = walls.find((w) => w.start.id === wallStart)
  const props = wall ? wallProps(room, wall.start.id) : undefined
  // The stored wall this room wall is part of: it holds the centre and outside face values.
  const stored = storedWallOfRoomWall(doc, room.id, wallStart)
  if (!wall || !props) return null
  // A v2 document: a wall is ONE object with two sides, so the card of a single wall is
  // StoredWallCard (docs/walls-plan.md, Walls in the interface). A v1 document, and a Shift + click
  // group of walls, keep this per-room card. No hook is called above this point, so the early
  // return is safe.
  if (stored && !group && isV2Doc(doc)) {
    return <StoredWallCard doc={doc} wallId={stored.id} side={sideOfRoomWall(doc, stored.id, room.id, wallStart)} />
  }

  const select = useUi.getState().select
  /** Step to the previous / next wall of this room, wrapping around. */
  const stepTo = (step: 1 | -1) => {
    const next = adjacentWallStart(room, wall.start.id, step)
    if (next) select({ kind: 'wall', roomId: room.id, wallStart: next })
  }

  // Shift + click group: the wall controls change every selected wall (values shown are the primary wall's).
  const targets: WallRef[] = group ?? [{ roomId: room.id, wallStart: wall.start.id }]

  return (
    <>
      <PanelSection
        title={group ? `${group.length} walls` : `Wall ${room.code}-${wall.index + 1}`}
        actions={group ? undefined : (
          <>
            <IconButton label="Previous wall" icon={<ChevronLeft size={16} />} onClick={() => stepTo(-1)} />
            <IconButton label="Next wall" icon={<ChevronRight size={16} />} onClick={() => stepTo(1)} />
          </>
        )}
      >
        {group && <EmptyHint>{group.map((w) => refLabel(doc, w)).join(', ')}. Changes apply to all of them.</EmptyHint>}
        <FieldRow label="Type" stacked>
          <Segmented ariaLabel="Wall type" options={WALL_TYPES} value={props.type} onChange={(t) => setWallTypes(targets, t as WallType)} />
        </FieldRow>
        <FieldRow label="Renovation" stacked>
          <Segmented
            ariaLabel="Wall status"
            options={WALL_STATUSES}
            value={props.status ?? 'existing'}
            onChange={(st) => patchWalls(targets, () => ({ status: st as WallStatus }))}
          />
        </FieldRow>
        {props.status === 'demolish' && (props.type === 'bearing' || props.type === 'exterior') && (
          <p role="alert" className="rounded border border-red-600/50 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-700 dark:border-red-400/50 dark:bg-red-500/15 dark:text-red-300">
            {structuralWarning(props.type)}
          </p>
        )}
        <FieldRow label="Thickness" htmlFor="wall-thickness">
          <NumberField
            id="wall-thickness"
            name="thickness"
            unit="cm"
            value={props.thicknessCm}
            min={1}
            max={200}
            onCommit={(v) => {
              if (v === null || v < 1 || v > 200) return false
              patchWalls(targets, () => ({ thicknessCm: v }))
            }}
          />
        </FieldRow>
        <FieldRow label="In line on" stacked>
          <Segmented
            ariaLabel="Line of the wall that lines up with the next walls"
            options={WALL_ALIGNS}
            value={props.align ?? 'room'}
            onChange={(a) => setWallAligns(targets, a as WallAlign)}
          />
        </FieldRow>
        {!group && <FieldRow label="Length" htmlFor="wall-length">
          <NumberField
            id="wall-length"
            name="length"
            unit="cm"
            value={shownLength(innerWallLengths(room)[wall.index], planPrecision(doc))}
            min={1}
            disabled={!!props.locked}
            onCommit={(v) => {
              if (v === null || v < 1) return false
              setWallLength(room.id, wall.start.id, v)
            }}
          />
        </FieldRow>}
        {!group && stored && <StoredWallValues doc={doc} wall={stored} />}
        <SwitchRow
          name="wallLocked"
          label="Locked (cannot be resized)"
          checked={!!props.locked}
          onChange={(checked) => patchWalls(targets, () => ({ locked: checked }))}
        />
        <EmptyHint>
          Key B: bearing / partition. Length moves the end vertex. "In line on" is the line of this wall that lines up with
          the walls that continue it: the face in this room (as measured on site), the centre (as on an architect plan),
          or the face on the other side. The dotted blue line on the plan shows it. "Solve whole plan" uses it.
        </EmptyHint>
      </PanelSection>

      {!group && (
        <PanelSection id="wall-elements" title="On this wall" collapsible>
          {(() => {
            const rows = wallElementRows(doc, room, wall.start.id)
            return rows.length
              ? <ElementList rows={rows} show="offset" onSelect={(id) => select({ kind: 'element', elementId: id })} />
              : <EmptyHint>No door, window or fixture on this wall.</EmptyHint>
          })()}
        </PanelSection>
      )}
    </>
  )
}

/**
 * Values of the stored wall (docs/walls-plan.md phase 5b): the CENTRE line length, read on the
 * architect plan, and the OUTSIDE face length of a facade wall, measured on site from outside.
 * Labels 'W12-C' and 'W12-E': one value per wall, shared by the two rooms on its sides.
 */
function StoredWallValues({ doc, wall }: { doc: PlanDoc; wall: StoredWall }) {
  const nodes = doc.nodes ?? []
  const centreCm = wallCentreCm(nodes, wall)
  const centreLabel = wallValueLabel(wall.id, 'centre')
  const outsideLabel = wallValueLabel(wall.id, 'outside')
  const centreValue = doc.measurements[centreLabel]?.actualCm
  const outsideValue = doc.measurements[outsideLabel]?.actualCm
  const outsidePlanCm = facadePlannedLengths(doc).get(wallValueLabel(wall.id, 'outside')) ?? wallOutsidePlanCm(doc.rooms, nodes, wall)
  const facade = centreCm !== null && outsideFaceSide(wall, centreCm) !== null
  // Source of the outside value, picked in Measuring Mode. The centre value is a plan value.
  const measureSource = useUi((s) => s.measureSource)
  // What the solver says these values are now (a centre value with no source counts as 'plan').
  const solved = useMemo(() => {
    if (centreValue == null && outsideValue == null) return null
    return new Map(solveGlobal(doc).residuals.map((r) => [r.label, r]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])
  const solvedLine = (label: string, measuredCm: number) => {
    const r = solved?.get(label)
    return (
      <EmptyHint>
        Measured {fmtCm(measuredCm)}{r ? ` · Solved ${fmtCm(r.solvedCm)}` : ' · not used by the solve'}
      </EmptyHint>
    )
  }
  return (
    <>
      {/* One wall of the plan: its values are shared by the two rooms on its sides. */}
      <p className="mt-1 font-mono text-xs font-semibold text-slate-600 dark:text-slate-300" data-wall-values={wall.id}>
        Wall {wall.id}
      </p>
      <FieldRow label="Centre (plan)" htmlFor={`wall-${wall.id}-centre`} hint="node to node">
        <NumberField
          id={`wall-${wall.id}-centre`}
          name="wallCentre"
          unit="cm"
          value={centreValue ?? null}
          placeholder={centreCm !== null ? fmtCm(centreCm) : undefined}
          min={1}
          onCommit={(v) => {
            if (v !== null && !(v > 0)) return false
            setMeasurement(centreLabel, v, 'plan')
            return true
          }}
        />
      </FieldRow>
      {centreValue != null && solvedLine(centreLabel, centreValue)}
      {facade && (
        <>
          <FieldRow label="Outside face" htmlFor={`wall-${wall.id}-outside`} hint="corner to corner">
            <NumberField
              id={`wall-${wall.id}-outside`}
              name="wallOutside"
              unit="cm"
              value={outsideValue ?? null}
              placeholder={outsidePlanCm !== null ? fmtCm(outsidePlanCm) : undefined}
              min={1}
              onCommit={(v) => {
                if (v !== null && !(v > 0)) return false
                setMeasurement(outsideLabel, v, measureSource)
                return true
              }}
            />
          </FieldRow>
          {outsideValue != null && solvedLine(outsideLabel, outsideValue)}
        </>
      )}
    </>
  )
}
