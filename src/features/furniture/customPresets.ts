// User-made furniture presets, kept in localStorage. Corrupt or blocked storage degrades to [].
import { create } from 'zustand'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM } from './geometry'
import type { FurniturePreset } from './presets'

export const CUSTOM_PRESETS_KEY = 'simple-floorplan2:furniture-presets'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isPreset(v: unknown): v is FurniturePreset {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    (p.shape === 'rect' || p.shape === 'circle') &&
    isNum(p.widthCm) &&
    isNum(p.depthCm) &&
    typeof p.color === 'string' &&
    isNum(p.heightCm) &&
    (p.showDirection === undefined || typeof p.showDirection === 'boolean') &&
    (p.layer === undefined || p.layer === 'top' || p.layer === 'bottom')
  )
}

/** Read the saved presets. Any error or invalid data gives []. */
export function loadCustomPresets(): FurniturePreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY)
    if (!raw) return []
    const data: unknown = JSON.parse(raw)
    return Array.isArray(data) ? data.filter(isPreset) : []
  } catch {
    return []
  }
}

/** Write the presets. Errors (blocked or full storage) are ignored. */
export function saveCustomPresets(presets: FurniturePreset[]): void {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets))
  } catch {
    // storage blocked: presets stay in memory only
  }
}

const clampCm = (v: number): number => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))

type CustomPresetsState = {
  presets: FurniturePreset[]
  addPreset: (preset: Omit<FurniturePreset, 'id'>) => FurniturePreset
  removePreset: (id: string) => void
}

export const useCustomPresets = create<CustomPresetsState>((set, get) => ({
  presets: loadCustomPresets(),
  addPreset: (preset) => {
    const trimmed = preset.name.trim()
    const created: FurniturePreset = {
      ...preset,
      id: `custom-${crypto.randomUUID()}`,
      name: trimmed === '' ? 'Custom' : trimmed,
      widthCm: clampCm(preset.widthCm),
      depthCm: clampCm(preset.depthCm),
    }
    const presets = [created, ...get().presets]
    set({ presets })
    saveCustomPresets(presets)
    return created
  },
  removePreset: (id) => {
    const presets = get().presets.filter((p) => p.id !== id)
    set({ presets })
    saveCustomPresets(presets)
  },
}))
