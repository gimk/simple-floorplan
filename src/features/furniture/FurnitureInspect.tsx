// Right-panel Inspect card for one selected furniture item in Design mode
// (docs/simple-floorplan-2.md §6, Phase 4): name, shape, width × depth, rotation (with quick
// quarter turns), optional height for the future 3D view, colour, Duplicate and Delete.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm and degrees.
import { useId } from 'react'
import { Armchair, Copy, RotateCw, Trash2 } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { FurnitureItem } from '../../model/types'
import {
  BTN,
  FieldRow,
  MUTED,
  NumberField,
  PanelSection,
  Segmented,
  TextField,
  formatCmInput,
} from '../../shell/panel'
import { deleteFurniture, duplicateFurniture, updateFurniture } from './actions'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM, normalizeAngle } from './geometry'
import { FURNITURE_COLORS } from './presets'

export type FurnitureInspectProps = {
  /** Artboard that holds the item. */
  artboardId: string
  /** Item to inspect. Unknown ids render nothing. */
  furnitureId: string
}

/** Shape choices of the segmented control. */
const SHAPE_OPTIONS = [
  { value: 'rect', label: 'Rect', title: 'Rectangle' },
  { value: 'circle', label: 'Circle', title: 'Circle or oval' },
] as const

/** Quick turns, in degrees. */
const TURNS: readonly { label: string; delta: number; title: string }[] = [
  { label: '-45°', delta: -45, title: 'Turn 45° counter-clockwise' },
  { label: '+45°', delta: 45, title: 'Turn 45° clockwise' },
  { label: '+90°', delta: 90, title: 'Turn 90° clockwise' },
]

const clampCm = (v: number): number => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))

/** One row of colour circles; the current colour gets an orange ring. */
function ColorRow({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const current = value.toLowerCase()
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Furniture color">
      {FURNITURE_COLORS.map((c) => {
        const on = c.color.toLowerCase() === current
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            aria-label={c.label}
            title={c.label}
            onClick={() => onPick(c.color)}
            style={{ backgroundColor: c.color }}
            className={`h-6 w-6 shrink-0 rounded-full border border-black/20 pointer-coarse:h-8 pointer-coarse:w-8 dark:border-white/25 ${
              on
                ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-white dark:ring-orange-400 dark:ring-offset-[#161b21]'
                : 'hover:opacity-80'
            }`}
          />
        )
      })}
    </div>
  )
}

/**
 * Inspect card of one furniture item. Renders nothing when the artboard or the item is unknown,
 * so the shell can mount it unconditionally.
 */
export function FurnitureInspect({ artboardId, furnitureId }: FurnitureInspectProps) {
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
  const item: FurnitureItem | undefined = artboard?.furniture.find((f) => f.id === furnitureId)
  const nameId = useId()
  const heightId = useId()
  if (!artboard || !item) return null

  const patch = (p: Partial<Omit<FurnitureItem, 'id'>>) => updateFurniture(artboard.id, item.id, p)

  const commitName = (value: string): boolean | void => {
    const name = value.trim()
    if (name === '') return false
    if (name === item.name) return
    patch({ name })
  }

  const commitWidth = (value: number | null): boolean | void => {
    if (value == null) return false
    const next = clampCm(value)
    if (next === item.widthCm) return
    patch({ widthCm: next })
  }

  const commitDepth = (value: number | null): boolean | void => {
    if (value == null) return false
    const next = clampCm(value)
    if (next === item.depthCm) return
    patch({ depthCm: next })
  }

  const commitRotation = (value: number | null): boolean | void => {
    if (value == null) return false
    const next = normalizeAngle(value)
    if (next === item.rotationDeg) return
    patch({ rotationDeg: next })
  }

  const turn = (delta: number) => {
    const next = normalizeAngle(item.rotationDeg + delta)
    if (next === item.rotationDeg) return
    patch({ rotationDeg: next })
  }

  const commitHeight = (value: number | null): boolean | void => {
    if (value == null) {
      if (item.heightCm !== undefined) patch({ heightCm: undefined })
      return
    }
    if (!(value > 0)) return false
    if (value === item.heightCm) return
    patch({ heightCm: value })
  }

  return (
    <PanelSection title="Furniture" icon={<Armchair size={14} aria-hidden="true" />}>
      <FieldRow label="Name" htmlFor={nameId}>
        <TextField
          id={nameId}
          ariaLabel="Furniture name"
          value={item.name}
          onCommit={commitName}
          invalidMessage="Type a name for the item."
        />
      </FieldRow>

      <FieldRow label="Shape" stacked>
        <Segmented
          ariaLabel="Furniture shape"
          options={SHAPE_OPTIONS}
          value={item.shape}
          onChange={(value) => {
            const shape = value === 'circle' ? 'circle' : 'rect'
            if (shape !== item.shape) patch({ shape })
          }}
        />
      </FieldRow>

      <FieldRow label="Width">
        <NumberField
          ariaLabel="Furniture width"
          unit="cm"
          min={MIN_FURNITURE_CM}
          max={MAX_FURNITURE_CM}
          value={item.widthCm}
          onCommit={commitWidth}
        />
      </FieldRow>

      <FieldRow label="Depth">
        <NumberField
          ariaLabel="Furniture depth"
          unit="cm"
          min={MIN_FURNITURE_CM}
          max={MAX_FURNITURE_CM}
          value={item.depthCm}
          onCommit={commitDepth}
        />
      </FieldRow>

      <FieldRow label="Rotation" hint="clockwise">
        <NumberField
          ariaLabel="Furniture rotation"
          unit="°"
          value={normalizeAngle(item.rotationDeg)}
          onCommit={commitRotation}
        />
      </FieldRow>

      <div className="grid grid-cols-3 gap-1" aria-label="Quick rotation">
        {TURNS.map((t) => (
          <button
            key={t.label}
            type="button"
            className={`${BTN} text-xs`}
            title={t.title}
            aria-label={`Rotate ${t.label}`}
            onClick={() => turn(t.delta)}
          >
            <RotateCw size={12} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      <FieldRow label="Height" hint="for 3D" htmlFor={heightId}>
        <NumberField
          id={heightId}
          ariaLabel="Furniture height"
          unit="cm"
          min={1}
          placeholder="80"
          value={item.heightCm ?? null}
          onCommit={commitHeight}
        />
      </FieldRow>

      <div className="flex flex-col gap-1">
        <span className={`text-xs ${MUTED}`}>Color</span>
        <ColorRow
          value={item.color}
          onPick={(color) => {
            if (color === item.color) return
            patch({ color })
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          className={BTN}
          onClick={() => {
            duplicateFurniture(artboard.id, item.id)
          }}
          title="Duplicate this item (the copy moves 20 cm)"
        >
          <Copy size={14} aria-hidden="true" />
          Duplicate
        </button>
        <button
          type="button"
          className={`${BTN} text-red-600 hover:bg-red-500/10 dark:text-red-400`}
          onClick={() => {
            deleteFurniture(artboard.id, item.id)
          }}
          title={`Delete ${item.name.trim() === '' ? 'this item' : item.name}`}
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete
        </button>
      </div>

      <p className={`text-xs tabular-nums ${MUTED}`}>
        {`${formatCmInput(item.widthCm)} × ${formatCmInput(item.depthCm)} cm`}
      </p>
    </PanelSection>
  )
}
