// Layers visibility toggles, moved out of App.tsx so the sidebar owns its sections.
// The `name="layer-*"` inputs are kept: other code and the browser tests use them.
// The room codes and the wall labels have three states: their controls are shared with the
// canvas View menu (shell/view/LayerControls.tsx).
import { Layers as LayersIcon } from 'lucide-react'
import { useUi } from '../../model/store'
import { RENOVATION_VIEWS, RENOVATION_VIEW_LABELS, type RenovationView } from '../../features/renovation/logic'
import { FieldRow, PanelSection, Segmented } from '../panel'
import { LayerCheckboxes, LayerModeRows } from '../view/LayerControls'
import { LAYER_LABELS } from './layerLabels'

export { LAYER_LABELS }

const RENOVATION_OPTIONS = RENOVATION_VIEWS.map((v) => ({ value: v, label: RENOVATION_VIEW_LABELS[v] }))

export function LayersSection() {
  const renovationView = useUi((s) => s.renovationView)
  const set = useUi((s) => s.set)
  return (
    <PanelSection id="layers" title="Layers" icon={<LayersIcon size={16} />} collapsible>
      <LayerCheckboxes />
      <LayerModeRows />
      <FieldRow label="Renovation" stacked>
        <Segmented
          ariaLabel="Renovation view"
          options={RENOVATION_OPTIONS}
          value={renovationView}
          onChange={(v) => set({ renovationView: v as RenovationView })}
        />
      </FieldRow>
    </PanelSection>
  )
}
