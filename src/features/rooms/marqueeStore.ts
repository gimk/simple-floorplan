// Tiny store for the live marquee box, so the marquee can be drawn on top of the rooms while the
// pointer handling lives in the background hit rect below them.
import { create } from 'zustand'
import type { Box } from './boxSelect'

export const useMarquee = create<{ box: Box | null; set: (box: Box | null) => void }>((set) => ({
  box: null,
  set: (box) => set({ box }),
}))
