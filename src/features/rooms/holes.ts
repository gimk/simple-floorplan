// Local selection of a hole (cutout) of a room. Vertex selection of hole vertices uses the shared Selection.
import { create } from 'zustand'
import { useDoc, useUi } from '../../model/store'

export type HoleSel = { roomId: string; holeIndex: number } | null

export const useHoleSel = create<{ sel: HoleSel; set: (s: HoleSel) => void }>()((set) => ({
  sel: null,
  set: (sel) => set({ sel }),
}))

/** Select a hole: selects its room globally, then remembers the hole. */
export function selectHole(roomId: string, holeIndex: number) {
  useUi.getState().select({ kind: 'room', roomId })
  useHoleSel.getState().set({ roomId, holeIndex })
}

export const clearHoleSel = () => { if (useHoleSel.getState().sel) useHoleSel.getState().set(null) }

// A hole stays selected only while its room is the selected room.
useUi.subscribe((s) => {
  const h = useHoleSel.getState().sel
  if (h && !(s.selection?.kind === 'room' && s.selection.roomId === h.roomId)) useHoleSel.getState().set(null)
})

const valid = (h: HoleSel): h is NonNullable<HoleSel> => {
  if (!h) return false
  const room = useDoc.getState().doc.rooms.find((r) => r.id === h.roomId)
  return !!room && h.holeIndex >= 0 && h.holeIndex < room.holes.length
}

/** Currently selected hole, if it still exists. */
export const getActiveHole = (): NonNullable<HoleSel> | null => {
  const h = useHoleSel.getState().sel
  return valid(h) ? h : null
}

/** Hook version of getActiveHole. */
export function useActiveHole(): NonNullable<HoleSel> | null {
  const h = useHoleSel((s) => s.sel)
  const rooms = useDoc((s) => s.doc.rooms)
  if (!h) return null
  const room = rooms.find((r) => r.id === h.roomId)
  return room && h.holeIndex >= 0 && h.holeIndex < room.holes.length ? h : null
}
