import { create } from 'zustand'
import type { SnapGuide } from './snap'

/** Snap guides currently shown by any rooms tool / drag. Cleared when the interaction ends. */
export const useGuides = create<{ guides: SnapGuide[]; set: (g: SnapGuide[]) => void }>()((set) => ({
  guides: [],
  set: (guides) => set({ guides }),
}))
