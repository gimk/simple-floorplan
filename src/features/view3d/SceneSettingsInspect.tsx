// Right Inspect panel of Views mode: scene settings of the 3D view (walls, projection, backdrop, shadows).
import { Box } from 'lucide-react'
import { useDoc } from '../../model/store'
import { DEFAULT_CEILING_HEIGHT_CM } from '../../model/defaults'
import type { ViewProjection, WallViewMode } from '../../model/types'
import { PanelSection, Segmented, StatGrid, SwitchRow, formatDecimal } from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { wallThicknessOf } from '../rooms/walls'

const WALL_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'cutaway', label: 'Back only' },
  { value: 'on', label: 'On' },
] as const

const PROJECTION_OPTIONS = [
  { value: 'perspective', label: 'Perspective' },
  { value: 'ortho', label: 'Isometric' },
] as const

const BACKDROP_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const

export function SceneSettingsInspect() {
  const wallViewMode = useUi((s) => s.wallViewMode)
  const viewProjection = useUi((s) => s.viewProjection)
  const viewBackdrop = useUi((s) => s.viewBackdrop)
  const viewShadows = useUi((s) => s.viewShadows)
  const setUi = useUi((s) => s.set)
  const activeId = useUi((s) => s.activeArtboardId)
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === activeId) ?? s.doc.artboards[0])
  const ceiling = artboard?.ceilingHeightCm ?? DEFAULT_CEILING_HEIGHT_CM
  const thickness = artboard ? wallThicknessOf(artboard) : 0

  return (
    <PanelSection title="Scene" icon={<Box size={14} aria-hidden="true" />} description="3D settings">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Walls (W)</span>
          <Segmented options={WALL_OPTIONS} value={wallViewMode} ariaLabel="Walls" onChange={(v) => setUi({ wallViewMode: v as WallViewMode })} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Projection</span>
          <Segmented options={PROJECTION_OPTIONS} value={viewProjection} ariaLabel="Projection" onChange={(v) => setUi({ viewProjection: v as ViewProjection })} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Backdrop</span>
          <Segmented options={BACKDROP_OPTIONS} value={viewBackdrop} ariaLabel="Backdrop" onChange={(v) => setUi({ viewBackdrop: v as 'dark' | 'light' })} />
        </div>
        <SwitchRow label="Shadows" checked={viewShadows} onChange={(c) => setUi({ viewShadows: c })} />
        <StatGrid
          items={[
            { label: 'Ceiling height', value: `${formatDecimal(ceiling, 0)} cm` },
            { label: 'Wall thickness', value: thickness > 0 ? `${formatDecimal(thickness, 0)} cm` : 'Thin' },
          ]}
        />
      </div>
    </PanelSection>
  )
}
