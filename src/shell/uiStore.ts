// Minimal UI store for the v2 shell: viewport, active tool and Plan | Design mode.
import { create } from 'zustand'
import type { Vec } from '../model/geometry'

export type View = { x: number; y: number; zoom: number }
export type Mode = 'plan' | 'design'
export type Tool = 'select' | 'pan'

type UiState = {
  /** World point at the screen origin (cm) + screen px per cm. */
  view: View
  tool: Tool
  mode: Mode
  set: (patch: Partial<Pick<UiState, 'view' | 'tool' | 'mode'>>) => void
}

export const useUi = create<UiState>((set) => ({
  view: { x: -100, y: -100, zoom: 1 },
  tool: 'select',
  mode: 'plan',
  set: (patch) => set(patch),
}))

export type { Vec }
