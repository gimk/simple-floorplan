// Layer visibility rules. Most layers are a plain on/off switch. The room codes and the wall
// numbers have three states, because they help in the survey and are in the way otherwise:
//   'on'   = always shown
//   'off'  = never shown
//   'auto' = shown in the Solve tab and in Measuring Mode, hidden in the other cases
// The helpers here are pure, so both the canvas and the menus can use them.
import type { Mode } from '../../model/types'
import type { Layers, LayerMode } from '../../model/store'
import type { SidebarTab } from '../sidebar/store'

export type { LayerMode }

/** What 'auto' looks at: the open sidebar tab and the app mode. */
export type LayerCtx = { tab: SidebarTab; mode: Mode }

/** True when a layer with this state is drawn for this context. */
export function layerVisible(mode: LayerMode, ctx: LayerCtx): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  // 'auto': the survey helpers are on while the user works on the values.
  return ctx.tab === 'solve' || ctx.mode === 'measure'
}

/** Old saved UI states and test fixtures can miss a three-state layer: it reads as 'auto'. */
export function layerModeOf(value: LayerMode | undefined | null): LayerMode {
  return value === 'on' || value === 'off' ? value : 'auto'
}

/** Visibility of a three-state layer, with the 'auto' fallback for old states. */
export function modeLayerVisible(layers: Layers, key: ModeLayerKey, ctx: LayerCtx): boolean {
  return layerVisible(layerModeOf(layers[key]), ctx)
}

/** Plain on/off layers, in display order. */
export const BOOLEAN_LAYER_KEYS = ['background', 'dimensions', 'bearingHighlight', 'openings', 'notes', 'clashes'] as const
export type BooleanLayerKey = (typeof BOOLEAN_LAYER_KEYS)[number]

/** Three-state layers (auto / on / off), in display order. */
export const MODE_LAYER_KEYS = ['roomCodes', 'wallLabels'] as const
export type ModeLayerKey = (typeof MODE_LAYER_KEYS)[number]

/** The state used by 'auto' in the Solve tab and in Measuring Mode, for the hint text. */
export const AUTO_HINT = 'Auto: shown in the Solve tab and in Measuring Mode'

export const LAYER_MODE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const

/** Switch one on/off layer; the other keys are kept as they are. */
export function toggleLayer(layers: Layers, key: BooleanLayerKey): Layers {
  const next: Layers = { ...layers }
  next[key] = !layers[key]
  return next
}

/** Set one three-state layer; the other keys are kept as they are. */
export function setLayerMode(layers: Layers, key: ModeLayerKey, mode: LayerMode): Layers {
  const next: Layers = { ...layers }
  next[key] = mode
  return next
}
