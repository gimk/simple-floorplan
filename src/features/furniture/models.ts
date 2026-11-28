// Model choices of a furniture item (3D solid and 2D plan symbol), for the model dropdowns of the
// Inspect card and the custom shape form. An item with no stored model shows the model that
// furnitureArchetype (src/features/view3d/furnitureSolids.ts) picks from its preset, name and size.
import type { FurnitureModel } from '../../model/types'
import type { SelectOption } from '../../shell/panel/SelectField'
import { isFurnitureModel } from '../view3d/furnitureSolids'

/** Human label of each model, in the order of the dropdown (grouped by room). */
export const FURNITURE_MODEL_LABELS: readonly { value: FurnitureModel; label: string }[] = [
  { value: 'bed', label: 'Bed' },
  { value: 'cot', label: 'Baby cot' },
  { value: 'pedestal', label: 'Bedside table' },
  { value: 'sofa', label: 'Sofa / armchair' },
  { value: 'cornerSofa', label: 'Corner sofa' },
  { value: 'chair', label: 'Chair' },
  { value: 'officeChair', label: 'Office chair' },
  { value: 'table', label: 'Table' },
  { value: 'roundTable', label: 'Round table' },
  { value: 'desk', label: 'Desk' },
  { value: 'tallStorage', label: 'Wardrobe / tall cabinet' },
  { value: 'bookshelf', label: 'Bookshelf' },
  { value: 'lowStorage', label: 'Chest / sideboard' },
  { value: 'tvUnit', label: 'TV unit' },
  { value: 'counter', label: 'Kitchen counter' },
  { value: 'sink', label: 'Sink unit' },
  { value: 'cooker', label: 'Cooker' },
  { value: 'appliance', label: 'Fridge / dishwasher' },
  { value: 'americanFridge', label: 'American fridge' },
  { value: 'drumAppliance', label: 'Washing machine / dryer' },
  { value: 'bathtub', label: 'Bathtub' },
  { value: 'shower', label: 'Shower' },
  { value: 'toilet', label: 'Toilet' },
  { value: 'basin', label: 'Washbasin' },
  { value: 'rug', label: 'Rug' },
  { value: 'box', label: 'Plain box (rect / circle)' },
]

/** Label of one model. */
export function furnitureModelLabel(model: FurnitureModel): string {
  return FURNITURE_MODEL_LABELS.find((m) => m.value === model)?.label ?? model
}

/** Dropdown options: every model. */
export const FURNITURE_MODEL_OPTIONS: readonly SelectOption[] = FURNITURE_MODEL_LABELS

/** Dropdown value to stored model: an unknown value gives undefined. */
export function modelFromSelect(value: string): FurnitureModel | undefined {
  return isFurnitureModel(value) ? value : undefined
}
