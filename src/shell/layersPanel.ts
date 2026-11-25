// Open/closed state of the Layers panel on the left of the canvas. Remembered per viewer in
// localStorage (behind try/catch). Without a stored value: open on desktop, closed on a phone.
import { create } from 'zustand'

const KEY = 'sfp.layersPanel.open'

const isWide = (): boolean => typeof window === 'undefined' || window.innerWidth >= 768

/** Stored value: 'true' / 'false', null when there is none or it is unknown. */
export const parseOpen = (raw: string | null): boolean | null => (raw === 'true' ? true : raw === 'false' ? false : null)

const readStored = (): boolean | null => {
  try {
    if (typeof window === 'undefined') return null
    return parseOpen(window.localStorage?.getItem(KEY) ?? null)
  } catch {
    return null
  }
}

const writeStored = (open: boolean) => {
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(KEY, String(open))
  } catch {
    /* storage full or blocked: the choice is just not remembered */
  }
}

type LayersPanelState = {
  open: boolean
  /** `remember` = false for automatic changes (the window crossing the phone limit). */
  setOpen: (open: boolean, remember?: boolean) => void
  toggle: () => void
}

export const useLayersPanel = create<LayersPanelState>((set, get) => ({
  // On a phone the panel is an overlay drawer: it always starts closed there.
  open: isWide() ? (readStored() ?? true) : false,
  setOpen: (open, remember = true) => {
    set({ open })
    if (remember) writeStored(open)
  },
  toggle: () => get().setOpen(!get().open),
}))
