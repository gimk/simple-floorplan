// UI store for the v2 shell: mode, tool, active artboard, selection and viewport.
import { create } from 'zustand'
import type { Vec } from '../model/geometry'
import type { OpeningKind, Selection } from '../model/types'

export type View = { x: number; y: number; zoom: number }
export type Mode = 'plan' | 'design'
export type Tool = 'select' | 'rect' | 'pen' | 'cutout' | 'place-opening' | 'calibrate-image' | 'tape'

type UiData = {
  /** World point at the screen origin (cm) + screen px per cm. */
  view: View
  tool: Tool
  mode: Mode
  activeArtboardId: string | null
  selection: Selection
  /** Opening kind being placed while tool = 'place-opening'. */
  placingOpeningKind: OpeningKind | null
  /** Reference image being calibrated while tool = 'calibrate-image'. */
  calibratingImageId: string | null
  /** Left panel (Objects / Furniture) hidden on desktop to reclaim canvas width. */
  leftCollapsed: boolean
  /** Inspect panel hidden on desktop to reclaim canvas width. */
  inspectCollapsed: boolean
  /** Panel shown as a drawer (tablet) or bottom sheet (phone) over the canvas; null = none. */
  drawer: 'left' | 'inspect' | null
  /** Keyboard shortcuts cheat-sheet is open. */
  shortcutsOpen: boolean
}

type UiState = UiData & {
  set: (patch: Partial<UiData>) => void
}

export const useUi = create<UiState>((set) => ({
  view: { x: -100, y: -100, zoom: 1 },
  tool: 'select',
  mode: 'plan',
  activeArtboardId: null,
  selection: { kind: 'none' },
  placingOpeningKind: null,
  calibratingImageId: null,
  leftCollapsed: false,
  inspectCollapsed: false,
  drawer: null,
  shortcutsOpen: false,
  set: (patch) => set(patch),
}))

export type { Vec }
