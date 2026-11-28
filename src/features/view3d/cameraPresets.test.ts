import { describe, expect, it } from 'vitest'
import type { SceneBounds } from './buildScene'
import { computePresetPose, presetDistance } from './cameraPresets'
import type { CameraPreset } from './cameraPresets'

const bounds = (p: Partial<SceneBounds> = {}): SceneBounds => ({
  minX: 100, maxX: 500, minZ: 200, maxZ: 800, centerX: 300, centerZ: 500, sizeX: 400, sizeZ: 600, maxY: 250, ...p,
})
const EMPTY: SceneBounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200, centerX: 0, centerZ: 0, sizeX: 400, sizeZ: 400, maxY: 250 }
const PRESETS: CameraPreset[] = ['top', 'fit', 'iso-ne', 'iso-nw', 'iso-se', 'iso-sw']
const offset = (b: SceneBounds, p: CameraPreset) => {
  const { position, target } = computePresetPose(b, p)
  return { dx: position[0] - target[0], dy: position[1] - target[1], dz: position[2] - target[2], target, position }
}

describe('computePresetPose', () => {
  it('always looks at the scene centre on the floor', () => {
    for (const p of PRESETS) expect(computePresetPose(bounds(), p).target).toEqual([300, 0, 500])
  })

  it('keeps every preset at the same distance from the target (except top, which is above)', () => {
    const d = presetDistance(bounds())
    for (const p of PRESETS) {
      const o = offset(bounds(), p)
      expect(Math.hypot(o.dx, o.dy, o.dz)).toBeGreaterThan(d * 0.99)
      expect(Math.hypot(o.dx, o.dy, o.dz)).toBeLessThan(d * 1.03)
    }
  })

  it('top is almost straight above the centre', () => {
    const o = offset(bounds(), 'top')
    expect(o.dx).toBeCloseTo(0)
    expect(o.dy).toBeCloseTo(presetDistance(bounds()))
    expect(Math.abs(o.dz)).toBeLessThan(o.dy * 0.05)
    expect(o.dz).toBeGreaterThan(0)
  })

  it('fit matches the default 48 degree camera and is above the floor', () => {
    const o = offset(bounds(), 'fit')
    const elev = Math.asin(o.dy / Math.hypot(o.dx, o.dy, o.dz))
    expect(elev).toBeCloseTo((48 * Math.PI) / 180)
    expect(o.dx).toBeGreaterThan(0)
    expect(o.dz).toBeGreaterThan(0)
  })

  it('iso presets sit in the right quadrants (X east, Z south)', () => {
    const q = (p: CameraPreset) => { const o = offset(bounds(), p); return [Math.sign(o.dx), Math.sign(o.dz)] }
    expect(q('iso-ne')).toEqual([1, -1])
    expect(q('iso-nw')).toEqual([-1, -1])
    expect(q('iso-se')).toEqual([1, 1])
    expect(q('iso-sw')).toEqual([-1, 1])
  })

  it('iso presets are at 45 degrees azimuth and 35 degrees elevation', () => {
    for (const p of ['iso-ne', 'iso-nw', 'iso-se', 'iso-sw'] as const) {
      const o = offset(bounds(), p)
      expect(Math.abs(o.dx)).toBeCloseTo(Math.abs(o.dz))
      expect(Math.asin(o.dy / Math.hypot(o.dx, o.dy, o.dz))).toBeCloseTo((35 * Math.PI) / 180)
    }
  })

  it('a larger scene puts the camera further away', () => {
    const big = bounds({ sizeX: 2000, sizeZ: 3000 })
    expect(presetDistance(big)).toBeGreaterThan(presetDistance(bounds()))
  })

  it('works on the default bounds of an empty scene', () => {
    for (const p of PRESETS) {
      const { position, target } = computePresetPose(EMPTY, p)
      expect(target).toEqual([0, 0, 0])
      expect(position.every(Number.isFinite)).toBe(true)
      expect(position[1]).toBeGreaterThan(0)
    }
  })

  it('never goes below the minimum radius for a tiny scene', () => {
    const tiny = bounds({ sizeX: 1, sizeZ: 1 })
    expect(presetDistance(tiny)).toBeGreaterThan(100)
  })
})
