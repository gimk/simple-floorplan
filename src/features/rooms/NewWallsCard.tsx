// Inspect card of the Wall tool: the thickness and the type of the walls it draws
// (docs/walls-plan.md phase 6). Shown when the tool is active and nothing is selected.
import { useUi } from '../../model/store'
import type { WallType } from '../../model/types'
import { FieldRow, NumberField, PanelSection, Segmented } from '../../shell/panel'
import { WALL_TYPES } from './cards'
import { safeType } from './wallToolLogic'

export function NewWallsCard({ thicknessCm, type, onThickness, onType }: {
  thicknessCm: number
  type: WallType
  onThickness: (cm: number | null) => boolean | void
  onType: (type: WallType) => void
}) {
  return (
    <PanelSection
      title="New walls"
      description="Type and thickness of the walls that the Wall tool draws (W)."
    >
      <FieldRow label="Type" stacked>
        <Segmented ariaLabel="New wall type" options={WALL_TYPES} value={type} onChange={(t) => onType(safeType(t))} />
      </FieldRow>
      <FieldRow label="Thickness" htmlFor="new-wall-thickness">
        <NumberField
          id="new-wall-thickness"
          name="newWallThickness"
          ariaLabel="Thickness of the new walls"
          value={thicknessCm}
          unit="cm"
          min={1}
          max={100}
          onCommit={(v) => onThickness(v)}
        />
      </FieldRow>
    </PanelSection>
  )
}

/** Same card, connected to the UI store (no props). */
export function NewWallsCardConnected() {
  const thicknessCm = useUi((s) => s.wallToolThicknessCm)
  const type = useUi((s) => s.wallToolType)
  return (
    <NewWallsCard
      thicknessCm={thicknessCm}
      type={type}
      onType={(t) => useUi.getState().set({ wallToolType: t })}
      onThickness={(cm) => {
        if (cm === null || !(cm > 0)) return false
        useUi.getState().set({ wallToolThicknessCm: cm })
        return true
      }}
    />
  )
}
