// UI store for the v2 shell: mode, tool, active artboard, selection and viewport.
import { create } from 'zustand'
import type { Vec } from '../model/geometry'
import type { OpeningKind, Selection, ViewProjection, WallViewMode } from '../model/types'
import type { TapeSnap } from '../features/tape/geometry'

export type View = { x: number; y: number; zoom: number }
export type Mode = 'plan' | 'design' | 'views'
export type Tool = 'select' | 'rect' | 'pen' | 'cutout' | 'place-opening' | 'calibrate-image' | 'tape' | 'artboard'

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
  /** 90° angle lock (Plan mode): drawn and edited room angles stay orthogonal. */
  ortho: boolean
  /** Cmd/Ctrl+': draw the canvas grid in Plan mode. */
  showGrid: boolean
  /** Cmd/Ctrl+\: all panels and toolbars are hidden, the canvas keeps the whole window. */
  uiHidden: boolean
  /**
   * Furniture item whose name field the Rename shortcut (Cmd/Ctrl+R) has to focus. The Inspect card
   * of that item focuses the field and clears the request.
   */
  renameRequestId: string | null
  /**
   * The pinned (locked) Tape measurement, in world cm. It stays on the canvas after the Tape tool is
   * left, until its x button is pressed or a new measurement starts (one at a time).
   * UI state only: never saved in the document, never in the undo history.
   */
  pinnedTape: { a: TapeSnap; b: TapeSnap } | null
  /** 3D Views mode: how the walls are drawn ('cutaway' by default, a doll-house look). */
  wallViewMode: WallViewMode
  /** 3D Views mode: perspective or orthographic camera. */
  viewProjection: ViewProjection
  /** 3D Views mode: backdrop of the 3D scene. */
  viewBackdrop: 'dark' | 'light'
  /** 3D Views mode: draw shadows in the 3D scene. */
  viewShadows: boolean
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
  ortho: false,
  showGrid: true,
  uiHidden: false,
  renameRequestId: null,
  pinnedTape: null,
  wallViewMode: 'cutaway',
  viewProjection: 'perspective',
  viewBackdrop: 'dark',
  viewShadows: true,
  set: (patch) => set(patch),
}))

/** Pin a locked Tape measurement: it replaces the previous pinned one (only one at a time). */
export const pinTape = (a: TapeSnap, b: TapeSnap): void => useUi.getState().set({ pinnedTape: { a, b } })

/** Drop the pinned Tape measurement (its × button, or the first pointer down of a new measurement). */
export const clearPinnedTape = (): void => useUi.getState().set({ pinnedTape: null })

export type { Vec }
