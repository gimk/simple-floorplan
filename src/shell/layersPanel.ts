// Open/closed state and width of the Layers panel on the left of the canvas. Remembered per viewer
// in localStorage (behind try/catch). Without a stored value: open on desktop, closed on a phone,
// and the width every new viewer starts with (260 px).
import { create } from 'zustand'

const KEY = 'sfp.layersPanel.open'
const WIDTH_KEY = 'sfp.layersPanel.width'

const isWide = (): boolean => typeof window === 'undefined' || window.innerWidth >= 768

/** Stored value: 'true' / 'false', null when there is none or it is unknown. */
export const parseOpen = (raw: string | null): boolean | null => (raw === 'true' ? true : raw === 'false' ? false : null)

/** The width the panel starts with, and what a double-click on the handle gives back. */
export const LAYERS_DEFAULT_W = 260
/** The drag stops here: a narrower panel cuts the labels, a wider one eats the canvas. */
export const LAYERS_MIN_W = 200
export const LAYERS_MAX_W = 480

/** A panel width in px, inside [200, 480]; a missing or unreadable value gives the default. */
export const clampWidth = (px: number): number =>
  !Number.isFinite(px) ? LAYERS_DEFAULT_W : Math.min(LAYERS_MAX_W, Math.max(LAYERS_MIN_W, Math.round(px)))

/** Stored width: a number in range, or null when there is none or it is unknown. */
export const parseWidth = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) ? clampWidth(v) : null
}

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

const readStoredWidth = (): number => {
  try {
    if (typeof window === 'undefined') return LAYERS_DEFAULT_W
    return parseWidth(window.localStorage?.getItem(WIDTH_KEY) ?? null) ?? LAYERS_DEFAULT_W
  } catch {
    return LAYERS_DEFAULT_W
  }
}

const writeStoredWidth = (width: number) => {
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(WIDTH_KEY, String(width))
  } catch {
    /* storage full or blocked: the width is just not remembered */
  }
}

type LayersPanelState = {
  open: boolean
  /** Width of the panel in px, always inside [200, 480]. */
  width: number
  /** `remember` = false for automatic changes (the window crossing the phone limit). */
  setOpen: (open: boolean, remember?: boolean) => void
  toggle: () => void
  /** `remember` = false while dragging, so the storage is written once, on release. */
  setWidth: (width: number, remember?: boolean) => void
  resetWidth: () => void
}

export const useLayersPanel = create<LayersPanelState>((set, get) => ({
  // On a phone the panel is an overlay drawer: it always starts closed there.
  open: isWide() ? (readStored() ?? true) : false,
  width: readStoredWidth(),
  setOpen: (open, remember = true) => {
    set({ open })
    if (remember) writeStored(open)
  },
  toggle: () => get().setOpen(!get().open),
  setWidth: (width, remember = true) => {
    const w = clampWidth(width)
    set({ width: w })
    if (remember) writeStoredWidth(w)
  },
  resetWidth: () => get().setWidth(LAYERS_DEFAULT_W),
}))
