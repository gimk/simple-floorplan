// Camera presets and the handle contract of the 3D view. Pure: no Three.js, no React, no DOM.
// Space is the scene space of buildScene (cm, X right = east, Y up, Z = plan y = south).
import type { SavedView, ViewProjection, WallViewMode } from '../../model/types'
import type { SceneBounds } from './buildScene'

export type CameraPreset = 'top' | 'iso-ne' | 'iso-nw' | 'iso-se' | 'iso-sw' | 'fit'

/** Camera state of the live 3D view, in the same shape a SavedView stores it. */
export type CameraSnapshot = {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
  projection: ViewProjection
  wallMode: WallViewMode
}

/** What ViewsPanel and the shortcuts can ask of the (lazy) 3D view. */
export type View3DHandle = {
  getSnapshot: () => CameraSnapshot | null
  flyTo: (view: Pick<SavedView, 'position' | 'target' | 'fov' | 'projection' | 'wallMode'>) => void
  applyPreset: (preset: CameraPreset) => void
  capturePngBlob: (opts?: { width?: number; height?: number; view?: CameraSnapshot | SavedView }) => Promise<Blob | null>
  /**
   * Render a small preview of `snapshot` offscreen and return a blob URL (null when the view is not ready).
   * The live camera and canvas are restored before returning. The caller must revoke the URL.
   */
  captureThumbnail: (snapshot: CameraSnapshot, width?: number, height?: number) => Promise<string | null>
}

/** Vertical field of view of the 3D camera, in degrees. */
export const PRESET_FOV = 45
/** Elevation of the default ('fit') camera, in degrees above the floor. */
export const FIT_ELEV_DEG = 48
/** Azimuth of the default ('fit') camera, in radians (towards +X, +Z). */
export const FIT_AZIMUTH = 0.55
/** Elevation of the four isometric presets, in degrees. */
export const ISO_ELEV_DEG = 35
/** Top view: the camera sits this far (as a share of the distance) towards +Z, so the up vector stays defined. */
export const TOP_Z_SHARE = 0.02

const RAD = Math.PI / 180

/** Distance that frames the whole scene with the default field of view. */
export function presetDistance(bounds: SceneBounds): number {
  const R = Math.max(Math.hypot(bounds.sizeX, bounds.sizeZ) / 2, 100)
  return (R / Math.sin((PRESET_FOV * RAD) / 2)) * 0.9
}

/** Camera position and look-at point of a preset. The look-at point is the scene centre on the floor. */
export function computePresetPose(
  bounds: SceneBounds,
  preset: CameraPreset,
): { position: [number, number, number]; target: [number, number, number] } {
  const target: [number, number, number] = [bounds.centerX, 0, bounds.centerZ]
  const dist = presetDistance(bounds)
  const around = (elevRad: number, azimuthRad: number): [number, number, number] => [
    target[0] + dist * Math.cos(elevRad) * Math.sin(azimuthRad),
    target[1] + dist * Math.sin(elevRad),
    target[2] + dist * Math.cos(elevRad) * Math.cos(azimuthRad),
  ]
  switch (preset) {
    case 'top':
      return { position: [target[0], dist, target[2] + dist * TOP_Z_SHARE], target }
    case 'fit':
      return { position: around(FIT_ELEV_DEG * RAD, FIT_AZIMUTH), target }
    // Azimuth is measured from +Z (south) towards +X (east): SE = 45 deg, SW = -45 deg, NE = 135 deg, NW = -135 deg.
    case 'iso-se':
      return { position: around(ISO_ELEV_DEG * RAD, 45 * RAD), target }
    case 'iso-sw':
      return { position: around(ISO_ELEV_DEG * RAD, -45 * RAD), target }
    case 'iso-ne':
      return { position: around(ISO_ELEV_DEG * RAD, 135 * RAD), target }
    case 'iso-nw':
      return { position: around(ISO_ELEV_DEG * RAD, -135 * RAD), target }
  }
}
