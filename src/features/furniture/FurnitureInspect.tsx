// Right-panel Inspect card for one selected furniture item in Design mode
// (docs/simple-floorplan-2.md §6, Phase 4): name, shape, stack order, width × depth, rotation (with
// quick quarter turns), optional height for the future 3D view, colour, Duplicate and Delete.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm and degrees.
import { useId } from 'react'
import { Armchair, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Copy, Move, Palette, RotateCcw, RotateCw, Ruler, Layers } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { FurnitureItem } from '../../model/types'
import {
  BTN,
  BackLink,
  ColorRow,
  DangerButton,
  FieldRow,
  LABEL,
  MUTED,
  NumberField,
  PanelSection,
  Segmented,
  SwitchRow,
  TextField,
} from '../../shell/panel'
import { selectArtboard } from '../artboards/selection'
import { toast } from '../toast'
import { deleteFurniture, duplicateFurniture, reorderFurniture, updateFurniture, type StackOp } from './actions'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM, normalizeAngle } from './geometry'
import { FURNITURE_COLORS } from './presets'

export type FurnitureInspectProps = {
  /** Artboard that holds the item. */
  artboardId: string
  /** Item to inspect. Unknown ids render nothing. */
  furnitureId: string
}

/** The 4 stack moves, in the order of the Order row (icons and shortcuts). */
const STACK_BUTTONS: readonly { op: StackOp; label: string; title: string; Icon: typeof ArrowDown }[] = [
  { op: 'back', label: 'Send to back', title: 'Send to back (Cmd+[)', Icon: ArrowDownToLine },
  { op: 'backward', label: 'Send backward', title: 'Send backward ([)', Icon: ArrowDown },
  { op: 'forward', label: 'Bring forward', title: 'Bring forward (])', Icon: ArrowUp },
  { op: 'front', label: 'Bring to front', title: 'Bring to front (Cmd+])', Icon: ArrowUpToLine },
]

/** Shape choices of the segmented control. */
const SHAPE_OPTIONS = [
  { value: 'rect', label: 'Rect', title: 'Rectangle' },
  { value: 'circle', label: 'Circle', title: 'Circle or oval' },
] as const

/** Quick turns, in degrees (symmetric). */
const TURNS: readonly { label: string; delta: number; title: string }[] = [
  { label: '-90°', delta: -90, title: 'Turn 90° counter-clockwise' },
  { label: '-45°', delta: -45, title: 'Turn 45° counter-clockwise' },
  { label: '+45°', delta: 45, title: 'Turn 45° clockwise' },
  { label: '+90°', delta: 90, title: 'Turn 90° clockwise' },
]

/** Furniture colour swatches for the shared ColorRow. */
const COLOR_VALUES = FURNITURE_COLORS.map((c) => c.color)

const clampCm = (v: number): number => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))

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

  // Stack place of the item: index 0 is the bottom of the pile, the last index is the top.
  const index = artboard.furniture.findIndex((f) => f.id === item.id)
  const isBottom = index <= 0
  const isTop = index === artboard.furniture.length - 1

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

  /** Largest radius that still looks like a rounded rectangle. */
  const maxRadiusCm = Math.floor(Math.min(item.widthCm, item.depthCm) / 2)

  const commitRadius = (value: number | null): boolean | void => {
    if (value == null) return false
    const next = Math.max(0, Math.min(value, maxRadiusCm))
    if (next === (item.cornerRadiusCm ?? 4)) return
    patch({ cornerRadiusCm: next })
  }

  const commitX = (value: number | null): boolean | void => {
    if (value == null) return false
    if (value === item.xCm) return
    patch({ xCm: value })
  }

  const commitY = (value: number | null): boolean | void => {
    if (value == null) return false
    if (value === item.yCm) return
    patch({ yCm: value })
  }

  const remove = () => {
    const label = item.name.trim() === '' ? 'furniture' : item.name
    deleteFurniture(artboard.id, item.id)
    toast(`Deleted ${label}`, {
      kind: 'info',
      actionLabel: 'Undo',
      onAction: () => useDoc.getState().undo(),
    })
  }

  // Every inspector label of this card: 12 px medium slate-300 (L2/L3 of the design audit).
  const label = LABEL

  return (
    <>
      <PanelSection title="Furniture" icon={<Armchair size={14} aria-hidden="true" />}>
        <BackLink name={artboard.name.trim() === '' ? 'Untitled artboard' : artboard.name} onClick={() => selectArtboard(artboard.id)} />

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
      </PanelSection>

      <PanelSection title="Size" icon={<Ruler size={14} aria-hidden="true" />}>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className={label}>Width</span>
            <NumberField
              ariaLabel="Furniture width"
              unit="cm"
              min={MIN_FURNITURE_CM}
              max={MAX_FURNITURE_CM}
              value={item.widthCm}
              onCommit={commitWidth}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={label}>Depth</span>
            <NumberField
              ariaLabel="Furniture depth"
              unit="cm"
              min={MIN_FURNITURE_CM}
              max={MAX_FURNITURE_CM}
              value={item.depthCm}
              onCommit={commitDepth}
            />
          </div>
        </div>

        {item.shape === 'rect' && (
          <FieldRow label="Corner radius" hint="rounded corners">
            <NumberField
              ariaLabel="Furniture corner radius"
              unit="cm"
              min={0}
              max={maxRadiusCm}
              value={item.cornerRadiusCm ?? 4}
              onCommit={commitRadius}
            />
          </FieldRow>
        )}

        <FieldRow label="Height" hint="for 3D" htmlFor={heightId}>
          <NumberField
            id={heightId}
            ariaLabel="Furniture height"
            unit="cm"
            min={1}
            placeholder="e.g. 80"
            value={item.heightCm ?? null}
            onCommit={commitHeight}
          />
        </FieldRow>
      </PanelSection>

      <PanelSection title="Position & Rotation" icon={<Move size={14} aria-hidden="true" />}>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className={label}>X</span>
            <NumberField ariaLabel="Furniture X position" unit="cm" value={item.xCm} onCommit={commitX} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={label}>Y</span>
            <NumberField ariaLabel="Furniture Y position" unit="cm" value={item.yCm} onCommit={commitY} />
          </div>
        </div>
        <p className={MUTED}>Centre of the item, from the artboard origin.</p>

        <FieldRow label="Rotation" hint="clockwise">
          <NumberField
            ariaLabel="Furniture rotation"
            unit="°"
            value={normalizeAngle(item.rotationDeg)}
            onCommit={commitRotation}
          />
        </FieldRow>

        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Quick rotation">
          {TURNS.map((t) => (
            <button
              key={t.label}
              type="button"
              className={`${BTN} px-1 text-xs`}
              title={t.title}
              aria-label={`Rotate ${t.label}`}
              onClick={() => turn(t.delta)}
            >
              {t.delta < 0 ? <RotateCcw size={12} aria-hidden="true" /> : <RotateCw size={12} aria-hidden="true" />}
              {t.label}
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Appearance" icon={<Palette size={14} aria-hidden="true" />}>
        <div className="flex flex-col gap-1">
          <span className={label}>Color</span>
          <ColorRow
            label="Furniture color"
            colors={COLOR_VALUES}
            value={item.color}
            onChange={(color) => {
              if (color === item.color) return
              patch({ color })
            }}
          />
        </div>
        <SwitchRow
          label="Direction arrow"
          name="furniture-direction"
          checked={!!item.showDirection}
          onChange={(next) => patch({ showDirection: next })}
        />
      </PanelSection>

      <PanelSection title="Arrange" icon={<Layers size={14} aria-hidden="true" />}>
        <FieldRow label="Order" hint="stack place" stacked>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label="Stack order">
            {STACK_BUTTONS.map(({ op, label: opLabel, title, Icon }) => {
              const disabled = op === 'back' || op === 'backward' ? isBottom : isTop
              return (
                <button
                  key={op}
                  type="button"
                  className={BTN}
                  title={title}
                  aria-label={opLabel}
                  disabled={disabled}
                  onClick={() => {
                    reorderFurniture(artboard.id, item.id, op)
                  }}
                >
                  <Icon size={14} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </FieldRow>

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
        <DangerButton onClick={remove} shortcut="Del">
          Delete
        </DangerButton>
      </PanelSection>
    </>
  )
}
