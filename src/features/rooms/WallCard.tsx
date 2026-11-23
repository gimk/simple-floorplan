// Inspect card for one wall (or a Shift + click group of walls): type, renovation state,
// thickness, line, length, lock, and the elements on the wall. The header steps to the
// previous / next wall of the same room (docs/sidebar-plan-3.md step 4).
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { innerWallLengths, roomWalls } from '../../model/geometry'
import { planPrecision, shownLength } from '../../model/precision'
import { useUi } from '../../model/store'
import type { PlanDoc, Room, WallAlign, WallStatus, WallType } from '../../model/types'
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
  if (!wall || !props) return null

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
