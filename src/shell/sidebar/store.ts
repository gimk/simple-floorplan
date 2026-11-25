// Sidebar memory: the selected tab and the open/closed state of each collapsible section.
// Both live in localStorage, behind try/catch, so the sidebar still works when storage
// is unavailable (private mode, blocked cookies, server render in tests).
import { create } from 'zustand'

export type SidebarTab = 'inspect' | 'solve' | 'plan'

const TAB_KEY = 'sfp.sidebar.tab'
const SECTIONS_KEY = 'sfp.sidebar.sections'

const storage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

const readRaw = (key: string): string | null => {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

const writeRaw = (key: string, value: string) => {
  try {
    storage()?.setItem(key, value)
  } catch {
    /* storage full or blocked: the memory is just not persisted */
  }
}

/** Stored tab, 'inspect' when there is none or it is unknown (an old 'layers' value too). */
export const parseTab = (raw: string | null): SidebarTab =>
  raw === 'plan' ? 'plan' : raw === 'solve' ? 'solve' : 'inspect'

/** Stored section memory. Anything that is not `{ [id]: boolean }` is dropped. */
export const parseSections = (raw: string | null): Record<string, boolean> => {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

export const loadTab = (): SidebarTab => parseTab(readRaw(TAB_KEY))
export const loadSections = (): Record<string, boolean> => parseSections(readRaw(SECTIONS_KEY))

type SidebarState = {
  tab: SidebarTab
  sections: Record<string, boolean>
  setTab: (tab: SidebarTab) => void
  setSection: (id: string, open: boolean) => void
}

export const useSidebar = create<SidebarState>((set) => ({
  tab: loadTab(),
  sections: loadSections(),
  setTab: (tab) => {
    set({ tab })
    writeRaw(TAB_KEY, tab)
  },
  setSection: (id, open) =>
    set((s) => {
      const sections = { ...s.sections, [id]: open }
      writeRaw(SECTIONS_KEY, JSON.stringify(sections))
      return { sections }
    }),
}))

/** Open state of one collapsible section, remembered per viewer. */
export function useSectionOpen(id: string, fallback = true): [boolean, (open: boolean) => void] {
  const stored = useSidebar((s) => s.sections[id])
  const setSection = useSidebar((s) => s.setSection)
  return [stored ?? fallback, (open: boolean) => setSection(id, open)]
}
