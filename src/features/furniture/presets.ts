// Starter furniture presets, floor fill swatches and furniture colours (no React, no store).
// Colours are muted so they read well on the dark canvas (#12161b) at low opacity.

import type { FloorPattern } from '../../model/types'

/** A floor finish choice. `color` undefined means no fill (the default canvas look). */
export type Swatch = { id: string; label: string; color: string | undefined }

/** Floor fills for room polygons. Intended to be painted at ~0.28 opacity over the canvas. */
export const FLOOR_SWATCHES: Swatch[] = [
  { id: 'none', label: 'Default', color: undefined },
  { id: 'warm-wood', label: 'Warm Wood', color: '#8a6b4a' },
  { id: 'light-oak', label: 'Light Oak', color: '#b5976b' },
  { id: 'walnut', label: 'Walnut', color: '#5a4232' },
  { id: 'slate-tile', label: 'Slate Tile', color: '#4c5b6b' },
  { id: 'ceramic', label: 'Ceramic', color: '#8d969e' },
  { id: 'concrete', label: 'Concrete', color: '#6b7075' },
  { id: 'carpet', label: 'Carpet', color: '#6b5b73' },
  { id: 'terrace', label: 'Terrace', color: '#4f6b55' },
  { id: 'lawn', label: 'Lawn', color: '#5b7a3e' },
]

/** Floor textures offered in the room Inspect card. */
export const FLOOR_PATTERNS: { id: FloorPattern; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'wood', label: 'Wood' },
  { id: 'parquet', label: 'Parquet' },
  { id: 'tile', label: 'Tile' },
  { id: 'stone', label: 'Stone' },
  { id: 'carpet', label: 'Carpet' },
  { id: 'grass', label: 'Grass' },
]

/** Accent paint colours for single walls. `color` undefined clears the paint. */
export const WALL_ACCENT_COLORS: Swatch[] = [
  { id: 'none', label: 'Default', color: undefined },
  { id: 'warm-white', label: 'Warm White', color: '#e5e0d5' },
  { id: 'terracotta', label: 'Terracotta', color: '#b85d43' },
  { id: 'sage', label: 'Sage', color: '#5a7a65' },
  { id: 'slate-blue', label: 'Slate Blue', color: '#486581' },
  { id: 'ochre', label: 'Ochre', color: '#c4943a' },
  { id: 'charcoal', label: 'Charcoal', color: '#4b5563' },
  { id: 'blush', label: 'Blush', color: '#a66e76' },
]

/** Furniture body colours. */
export const FURNITURE_COLORS: { id: string; label: string; color: string }[] = [
  { id: 'slate', label: 'Slate', color: '#4b5563' },
  { id: 'sand', label: 'Sand', color: '#9c8669' },
  { id: 'sage', label: 'Sage', color: '#527362' },
  { id: 'terracotta', label: 'Terracotta', color: '#9e5a47' },
  { id: 'navy', label: 'Navy', color: '#3e5470' },
  { id: 'charcoal', label: 'Charcoal', color: '#374151' },
  { id: 'amber', label: 'Amber', color: '#9a7438' },
  { id: 'mauve', label: 'Mauve', color: '#73586d' },
]

/** A starter item: sizes in cm, `shape` 'circle' draws a round table or rug. */
export type FurniturePreset = {
  id: string
  name: string
  shape: 'rect' | 'circle'
  widthCm: number
  depthCm: number
  color: string
  heightCm: number
  /** Directional items (bed, sofa, desk...) draw a subtle front-direction arrow. */
  showDirection?: boolean
  /** Stack place of a new item: 'bottom' = under the existing items (a rug), default 'top'. */
  layer?: 'top' | 'bottom'
}

const DEFAULT_PRESET_COLOR = '#4b5563'

/** 42 starter items, grouped by category. `widthCm` runs along the local X axis, `depthCm` along local Y. */
export const FURNITURE_PRESETS: FurniturePreset[] = [
  // Beds
  { id: 'bed', name: 'Bed', shape: 'rect', widthCm: 160, depthCm: 200, color: DEFAULT_PRESET_COLOR, heightCm: 50, showDirection: true },
  { id: 'single-bed', name: 'Single Bed', shape: 'rect', widthCm: 90, depthCm: 200, color: DEFAULT_PRESET_COLOR, heightCm: 50, showDirection: true },
  { id: 'bed-140', name: 'Double Bed 140', shape: 'rect', widthCm: 140, depthCm: 200, color: DEFAULT_PRESET_COLOR, heightCm: 50, showDirection: true },
  { id: 'bed-180', name: 'King Bed 180', shape: 'rect', widthCm: 180, depthCm: 200, color: DEFAULT_PRESET_COLOR, heightCm: 50, showDirection: true },
  { id: 'baby-cot', name: 'Baby Cot', shape: 'rect', widthCm: 60, depthCm: 120, color: DEFAULT_PRESET_COLOR, heightCm: 90 },
  { id: 'bedside-table', name: 'Bedside Table', shape: 'rect', widthCm: 45, depthCm: 40, color: DEFAULT_PRESET_COLOR, heightCm: 55, showDirection: true },
  // Seating
  { id: 'sofa', name: 'Sofa', shape: 'rect', widthCm: 220, depthCm: 95, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'armchair', name: 'Armchair', shape: 'rect', widthCm: 85, depthCm: 85, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'sofa-2', name: '2-Seat Sofa', shape: 'rect', widthCm: 160, depthCm: 90, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'corner-sofa', name: 'Corner Sofa', shape: 'rect', widthCm: 250, depthCm: 160, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'dining-chair', name: 'Dining Chair', shape: 'rect', widthCm: 45, depthCm: 50, color: DEFAULT_PRESET_COLOR, heightCm: 90, showDirection: true },
  { id: 'office-chair', name: 'Office Chair', shape: 'circle', widthCm: 65, depthCm: 65, color: DEFAULT_PRESET_COLOR, heightCm: 110 },
  // Tables
  { id: 'dining-table', name: 'Dining Table', shape: 'rect', widthCm: 180, depthCm: 90, color: DEFAULT_PRESET_COLOR, heightCm: 75 },
  { id: 'round-table', name: 'Round Table', shape: 'circle', widthCm: 110, depthCm: 110, color: DEFAULT_PRESET_COLOR, heightCm: 75 },
  { id: 'coffee-table', name: 'Coffee Table', shape: 'rect', widthCm: 120, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 40 },
  { id: 'desk', name: 'Desk', shape: 'rect', widthCm: 140, depthCm: 70, color: DEFAULT_PRESET_COLOR, heightCm: 75, showDirection: true },
  { id: 'dining-table-4', name: 'Dining Table (4)', shape: 'rect', widthCm: 120, depthCm: 80, color: DEFAULT_PRESET_COLOR, heightCm: 75 },
  { id: 'side-table', name: 'Side Table', shape: 'circle', widthCm: 45, depthCm: 45, color: DEFAULT_PRESET_COLOR, heightCm: 50 },
  // Storage
  { id: 'wardrobe', name: 'Wardrobe', shape: 'rect', widthCm: 150, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 200, showDirection: true },
  { id: 'bookshelf', name: 'Bookshelf', shape: 'rect', widthCm: 100, depthCm: 35, color: DEFAULT_PRESET_COLOR, heightCm: 180, showDirection: true },
  { id: 'chest-of-drawers', name: 'Chest of Drawers', shape: 'rect', widthCm: 80, depthCm: 50, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'sideboard', name: 'Sideboard', shape: 'rect', widthCm: 160, depthCm: 45, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'tv-unit', name: 'TV Unit', shape: 'rect', widthCm: 180, depthCm: 40, color: DEFAULT_PRESET_COLOR, heightCm: 50, showDirection: true },
  { id: 'shoe-cabinet', name: 'Shoe Cabinet', shape: 'rect', widthCm: 80, depthCm: 30, color: DEFAULT_PRESET_COLOR, heightCm: 100, showDirection: true },
  // Kitchen
  { id: 'kitchen-counter', name: 'Kitchen Counter', shape: 'rect', widthCm: 240, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 90, showDirection: true },
  { id: 'base-cabinet-60', name: 'Base Cabinet 60', shape: 'rect', widthCm: 60, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 90, showDirection: true },
  { id: 'sink-unit', name: 'Sink Unit', shape: 'rect', widthCm: 80, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 90, showDirection: true },
  { id: 'cooker', name: 'Cooker', shape: 'rect', widthCm: 60, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 90, showDirection: true },
  { id: 'dishwasher', name: 'Dishwasher', shape: 'rect', widthCm: 60, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 85, showDirection: true },
  { id: 'fridge', name: 'Fridge', shape: 'rect', widthCm: 60, depthCm: 65, color: DEFAULT_PRESET_COLOR, heightCm: 185, showDirection: true },
  { id: 'american-fridge', name: 'American Fridge', shape: 'rect', widthCm: 90, depthCm: 70, color: DEFAULT_PRESET_COLOR, heightCm: 180, showDirection: true },
  { id: 'kitchen-island', name: 'Kitchen Island', shape: 'rect', widthCm: 180, depthCm: 90, color: DEFAULT_PRESET_COLOR, heightCm: 90 },
  // Bathroom
  { id: 'bathtub', name: 'Bathtub', shape: 'rect', widthCm: 170, depthCm: 75, color: DEFAULT_PRESET_COLOR, heightCm: 60 },
  { id: 'shower-tray', name: 'Shower 90x90', shape: 'rect', widthCm: 90, depthCm: 90, color: DEFAULT_PRESET_COLOR, heightCm: 200 },
  { id: 'toilet', name: 'Toilet', shape: 'rect', widthCm: 38, depthCm: 70, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'washbasin', name: 'Washbasin', shape: 'rect', widthCm: 60, depthCm: 46, color: DEFAULT_PRESET_COLOR, heightCm: 85, showDirection: true },
  { id: 'double-washbasin', name: 'Double Washbasin', shape: 'rect', widthCm: 120, depthCm: 46, color: DEFAULT_PRESET_COLOR, heightCm: 85, showDirection: true },
  { id: 'washing-machine', name: 'Washing Machine', shape: 'rect', widthCm: 60, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 85, showDirection: true },
  { id: 'dryer', name: 'Dryer', shape: 'rect', widthCm: 60, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 85, showDirection: true },
  // Rugs
  { id: 'rug', name: 'Rug', shape: 'rect', widthCm: 200, depthCm: 300, color: DEFAULT_PRESET_COLOR, heightCm: 1, layer: 'bottom' },
  { id: 'rug-160', name: 'Rug 160x230', shape: 'rect', widthCm: 160, depthCm: 230, color: DEFAULT_PRESET_COLOR, heightCm: 1, layer: 'bottom' },
  { id: 'round-rug', name: 'Round Rug', shape: 'circle', widthCm: 160, depthCm: 160, color: DEFAULT_PRESET_COLOR, heightCm: 1, layer: 'bottom' },
]

/** Category of each built-in preset id, in list order: the preset list stays grouped by category. */
export const FURNITURE_CATEGORY_BY_ID: Record<string, string> = {
  bed: 'Beds',
  'single-bed': 'Beds',
  'bed-140': 'Beds',
  'bed-180': 'Beds',
  'baby-cot': 'Beds',
  'bedside-table': 'Beds',
  sofa: 'Seating',
  armchair: 'Seating',
  'sofa-2': 'Seating',
  'corner-sofa': 'Seating',
  'dining-chair': 'Seating',
  'office-chair': 'Seating',
  'dining-table': 'Tables',
  'round-table': 'Tables',
  'coffee-table': 'Tables',
  desk: 'Tables',
  'dining-table-4': 'Tables',
  'side-table': 'Tables',
  wardrobe: 'Storage',
  bookshelf: 'Storage',
  'chest-of-drawers': 'Storage',
  sideboard: 'Storage',
  'tv-unit': 'Storage',
  'shoe-cabinet': 'Storage',
  'kitchen-counter': 'Kitchen',
  'base-cabinet-60': 'Kitchen',
  'sink-unit': 'Kitchen',
  cooker: 'Kitchen',
  dishwasher: 'Kitchen',
  fridge: 'Kitchen',
  'american-fridge': 'Kitchen',
  'kitchen-island': 'Kitchen',
  bathtub: 'Bathroom',
  'shower-tray': 'Bathroom',
  toilet: 'Bathroom',
  washbasin: 'Bathroom',
  'double-washbasin': 'Bathroom',
  'washing-machine': 'Bathroom',
  dryer: 'Bathroom',
  rug: 'Rugs',
  'rug-160': 'Rugs',
  'round-rug': 'Rugs',
}
