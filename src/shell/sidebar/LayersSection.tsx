// Layers visibility toggles, moved out of App.tsx so the sidebar owns its sections.
// The `name="layer-*"` inputs are kept: other code and the browser tests use them.
import { Layers as LayersIcon } from 'lucide-react'
import { useUi, type Layers } from '../../model/store'
import { RENOVATION_VIEWS, RENOVATION_VIEW_LABELS, type RenovationView } from '../../features/renovation/logic'
import { CheckboxRow, FieldRow, PanelSection, Segmented } from '../panel'

export const LAYER_LABELS: Record<keyof Layers, string> = {
  background: 'Background image',
  dimensions: 'Dimensions',
  bearingHighlight: 'Bearing walls highlight',
  openings: 'Openings',
  notes: 'Notes',
  clashes: 'Clearance clashes',
}

const RENOVATION_OPTIONS = RENOVATION_VIEWS.map((v) => ({ value: v, label: RENOVATION_VIEW_LABELS[v] }))

export function LayersSection() {
  const layers = useUi((s) => s.layers)
  const renovationView = useUi((s) => s.renovationView)
  const set = useUi((s) => s.set)
  return (
    <PanelSection id="layers" title="Layers" icon={<LayersIcon size={16} />} collapsible>
      <div className="flex flex-col gap-1">
        {(Object.keys(LAYER_LABELS) as (keyof Layers)[]).map((k) => (
          <CheckboxRow
            key={k}
            name={`layer-${k}`}
            label={LAYER_LABELS[k]}
            checked={layers[k]}
            onChange={(checked) => set({ layers: { ...layers, [k]: checked } })}
          />
        ))}
      </div>
      <FieldRow label="Renovation">
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
