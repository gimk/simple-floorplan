// Own selection store: the shared Selection type has no tape/pin kinds (other features switch on it).
import { create } from 'zustand'
import { useUi } from '../../model/store'

export type AnnotSel = { kind: 'tape' | 'pin'; id: string } | null

export const useAnnotSel = create<{ sel: AnnotSel; set: (s: AnnotSel) => void }>((set) => ({
  sel: null,
  set: (sel) => set({ sel }),
}))

/** Select a tape/pin and clear the shared selection. */
export const selectAnnot = (sel: AnnotSel) => {
  if (sel) useUi.getState().select(null)
  useAnnotSel.getState().set(sel)
}

// Selecting something else (room, element, Esc) clears ours. Leaving Edit Mode too.
useUi.subscribe((s, prev) => {
  if (useAnnotSel.getState().sel && ((s.selection && s.selection !== prev.selection) || s.mode !== prev.mode)) useAnnotSel.getState().set(null)
})
