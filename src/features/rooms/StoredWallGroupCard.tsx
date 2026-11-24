// Inspect card for a Shift + click or box group of stored walls (v2 document): the title says
// "N walls", the list gives the wall ids, and the controls that fit many walls (type,
// renovation, thickness, lock) change EVERY wall of the group in ONE undo step. The values shown
// are the ones of the primary wall (the last one picked). Length and side controls are not here:
// they belong to one wall. The look comes from the shared panel styles, like StoredWallCard.
import { Ruler, Trash2 } from 'lucide-react'
import type { PlanDoc, WallStatus, WallType } from '../../model/types'
import { EmptyHint, FieldRow, IconButton, NumberField, PanelSection, Segmented, SwitchRow } from '../../shell/panel'
import { ERROR } from '../../shell/panel'
import { deleteStoredWalls, patchStoredWalls, structuralWarning, WALL_STATUSES, WALL_TYPES } from './cards'
import { storedWallView } from './wallSides'

export function StoredWallGroupCard({ doc, wallIds, primaryId }: { doc: PlanDoc; wallIds: string[]; primaryId: string }) {
  // Only walls that are still on the plan count.
  const ids = wallIds.filter((id) => (doc.walls ?? []).some((w) => w.id === id))
  const view = storedWallView(doc, ids.includes(primaryId) ? primaryId : ids[0] ?? primaryId)
  if (!view || !ids.length) return <EmptyHint>These walls are not on the plan any more.</EmptyHint>
  const { props } = view
  return (
    <PanelSection
      title={`${ids.length} walls`}
      icon={<Ruler size={16} />}
      actions={<IconButton label="Delete walls" variant="danger" icon={<Trash2 size={16} />} onClick={() => deleteStoredWalls(ids)} />}
    >
      <EmptyHint>{ids.join(', ')}. Changes apply to all of them.</EmptyHint>
      <FieldRow label="Type" stacked>
        <Segmented
          ariaLabel="Wall type"
          options={WALL_TYPES}
          value={props.type}
          onChange={(t) => patchStoredWalls(ids, { type: t as WallType })}
        />
      </FieldRow>
      <FieldRow label="Renovation" stacked>
        <Segmented
          ariaLabel="Wall status"
          options={WALL_STATUSES}
          value={props.status ?? 'existing'}
          onChange={(s) => patchStoredWalls(ids, { status: s as WallStatus })}
        />
      </FieldRow>
      {props.status === 'demolish' && (props.type === 'bearing' || props.type === 'exterior') && (
        <p role="alert" className={`${ERROR} rounded border border-red-600/50 bg-red-500/10 px-2 py-1 font-semibold dark:border-red-400/50`}>
          {structuralWarning(props.type)}
        </p>
      )}
      <FieldRow label="Thickness" htmlFor="stored-wall-group-thickness">
        <NumberField
          id="stored-wall-group-thickness"
          name="thickness"
          unit="cm"
          value={props.thicknessCm}
          min={1}
          max={200}
          onCommit={(v) => {
            if (v === null || v < 1 || v > 200) return false
            patchStoredWalls(ids, { thicknessCm: v })
          }}
        />
      </FieldRow>
      <SwitchRow
        name="storedWallGroupLocked"
        label="Locked (cannot be moved or resized)"
        checked={!!props.locked}
        onChange={(checked) => patchStoredWalls(ids, { locked: checked })}
      />
    </PanelSection>
  )
}
