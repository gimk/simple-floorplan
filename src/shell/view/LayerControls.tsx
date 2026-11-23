// Layer controls shared by the Plan tab (LayersSection) and the canvas View menu.
// The plain layers are checkboxes; the room codes and the wall labels have three states
// (Auto / On / Off), because they only help in the survey.
import { useUi } from '../../model/store'
import { CheckboxRow, FieldRow, Segmented } from '../panel'
import { LAYER_LABELS } from '../sidebar/layerLabels'
import {
  AUTO_HINT, BOOLEAN_LAYER_KEYS, LAYER_MODE_OPTIONS, MODE_LAYER_KEYS,
  layerModeOf, setLayerMode, toggleLayer, type BooleanLayerKey, type LayerMode, type ModeLayerKey,
} from './layers'

const MODE_OPTIONS = LAYER_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

/** Checkbox rows of the plain on/off layers. */
export function LayerCheckboxes({ keys = BOOLEAN_LAYER_KEYS, className }: { keys?: readonly BooleanLayerKey[]; className?: string }) {
  const layers = useUi((s) => s.layers)
  const set = useUi((s) => s.set)
  return (
    <div className={className ?? 'flex flex-col gap-1'}>
      {keys.map((k) => (
        <CheckboxRow
          key={k}
          name={`layer-${k}`}
          label={LAYER_LABELS[k]}
          checked={layers[k]}
          onChange={() => set({ layers: toggleLayer(layers, k) })}
        />
      ))}
    </div>
  )
}

/** One three-state layer: a label and a compact Auto | On | Off switch. */
export function LayerModeRow({ layerKey }: { layerKey: ModeLayerKey }) {
  const layers = useUi((s) => s.layers)
  const set = useUi((s) => s.set)
  return (
    <div data-layer-name={`layer-${layerKey}`}>
      <FieldRow label={LAYER_LABELS[layerKey]}>
        <Segmented
          ariaLabel={`${LAYER_LABELS[layerKey]} visibility`}
          options={MODE_OPTIONS}
          value={layerModeOf(layers[layerKey])}
          onChange={(v) => set({ layers: setLayerMode(layers, layerKey, layerModeOf(v as LayerMode)) })}
          size="sm"
        />
      </FieldRow>
    </div>
  )
}

/** The two three-state layers, with the 'auto' hint under them. */
export function LayerModeRows({ hint = true }: { hint?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {MODE_LAYER_KEYS.map((k) => (
        <LayerModeRow key={k} layerKey={k} />
      ))}
      {hint && <p className="text-xs leading-4 text-slate-500 dark:text-slate-400">{AUTO_HINT}</p>}
    </div>
  )
}
