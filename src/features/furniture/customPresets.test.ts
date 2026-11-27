import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_PRESETS_KEY, loadCustomPresets, saveCustomPresets, useCustomPresets } from './customPresets'

const base = { name: 'Chair', shape: 'rect' as const, widthCm: 50, depthCm: 50, color: '#fff', heightCm: 75 }

const store = new Map<string, string>()
const fake = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', fake)
  localStorage.clear()
  useCustomPresets.setState({ presets: [] })
})

describe('customPresets', () => {
  it('adds a preset with a custom- id and persists it', () => {
    const p = useCustomPresets.getState().addPreset(base)
    expect(p.id.startsWith('custom-')).toBe(true)
    expect(useCustomPresets.getState().presets).toEqual([p])
    expect(loadCustomPresets()).toEqual([p])
  })

  it('trims the name and defaults to Custom', () => {
    expect(useCustomPresets.getState().addPreset({ ...base, name: '  Stool ' }).name).toBe('Stool')
    expect(useCustomPresets.getState().addPreset({ ...base, name: '   ' }).name).toBe('Custom')
  })

  it('clamps sizes', () => {
    const p = useCustomPresets.getState().addPreset({ ...base, widthCm: 1, depthCm: 99999 })
    expect(p.widthCm).toBe(15)
    expect(p.depthCm).toBe(1000)
  })

  it('removes a preset and persists', () => {
    const a = useCustomPresets.getState().addPreset(base)
    const b = useCustomPresets.getState().addPreset({ ...base, name: 'B' })
    useCustomPresets.getState().removePreset(a.id)
    expect(useCustomPresets.getState().presets).toEqual([b])
    expect(loadCustomPresets()).toEqual([b])
  })

  it('returns [] for invalid JSON or invalid shapes', () => {
    localStorage.setItem(CUSTOM_PRESETS_KEY, '{bad')
    expect(loadCustomPresets()).toEqual([])
    localStorage.setItem(CUSTOM_PRESETS_KEY, '{"a":1}')
    expect(loadCustomPresets()).toEqual([])
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify([{ id: 'x' }, { ...base, id: 'custom-1' }]))
    expect(loadCustomPresets()).toHaveLength(1)
  })

  it('survives blocked storage', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { ...fake, getItem: blocked, setItem: blocked })
    expect(loadCustomPresets()).toEqual([])
    expect(() => saveCustomPresets([])).not.toThrow()
    expect(() => useCustomPresets.getState().addPreset(base)).not.toThrow()
  })
})
