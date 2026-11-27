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

/** 12 starter items. `widthCm` runs along the local X axis, `depthCm` along local Y. */
export const FURNITURE_PRESETS: FurniturePreset[] = [
  { id: 'bed', name: 'Bed', shape: 'rect', widthCm: 160, depthCm: 200, color: DEFAULT_PRESET_COLOR, heightCm: 50, showDirection: true },
  { id: 'single-bed', name: 'Single Bed', shape: 'rect', widthCm: 90, depthCm: 200, color: DEFAULT_PRESET_COLOR, heightCm: 50, showDirection: true },
  { id: 'sofa', name: 'Sofa', shape: 'rect', widthCm: 220, depthCm: 95, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'armchair', name: 'Armchair', shape: 'rect', widthCm: 85, depthCm: 85, color: DEFAULT_PRESET_COLOR, heightCm: 80, showDirection: true },
  { id: 'dining-table', name: 'Dining Table', shape: 'rect', widthCm: 180, depthCm: 90, color: DEFAULT_PRESET_COLOR, heightCm: 75 },
  { id: 'round-table', name: 'Round Table', shape: 'circle', widthCm: 110, depthCm: 110, color: DEFAULT_PRESET_COLOR, heightCm: 75 },
  { id: 'coffee-table', name: 'Coffee Table', shape: 'rect', widthCm: 120, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 40 },
  { id: 'desk', name: 'Desk', shape: 'rect', widthCm: 140, depthCm: 70, color: DEFAULT_PRESET_COLOR, heightCm: 75, showDirection: true },
  { id: 'wardrobe', name: 'Wardrobe', shape: 'rect', widthCm: 150, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 200, showDirection: true },
  { id: 'bookshelf', name: 'Bookshelf', shape: 'rect', widthCm: 100, depthCm: 35, color: DEFAULT_PRESET_COLOR, heightCm: 180, showDirection: true },
  { id: 'kitchen-counter', name: 'Kitchen Counter', shape: 'rect', widthCm: 240, depthCm: 60, color: DEFAULT_PRESET_COLOR, heightCm: 90, showDirection: true },
  { id: 'rug', name: 'Rug', shape: 'rect', widthCm: 200, depthCm: 300, color: DEFAULT_PRESET_COLOR, heightCm: 1, layer: 'bottom' },
]
