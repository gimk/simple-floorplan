// Right-panel Inspect card for one selected furniture item in Design mode
// (docs/simple-floorplan-2.md §6, Phase 4): name, shape, stack order, width × depth, rotation (with
// quick quarter turns), optional height for the future 3D view, colour, Duplicate and Delete.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm and degrees.
import { useEffect, useId, useState } from 'react'
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Armchair, CornerUpLeft, ArrowDown, BookmarkPlus, ArrowDownToLine, ArrowUp, ArrowUpToLine, Copy, FlipHorizontal2, FlipVertical2, Move, Palette, RotateCcw, RotateCw, Ruler, Layers, Maximize } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import {
  BTN,
  BackLink,
  ColorRow,
  DangerButton,
  FieldRow,
  IconButton,
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
import { alignFurnitureInRoom, findFurnitureRoom, type FurnitureAlignment } from './align'
import { deleteFurniture, duplicateFurniture, reorderFurniture, updateFurniture, type StackOp } from './actions'
import { flipSelection } from './flip'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM, cornerRadiiPatch, furnitureCornerRadiiCm, normalizeAngle } from './geometry'
import type { CornerRadii } from './geometry'
import { useCustomPresets } from './customPresets'
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

/**
 * The 4 per-corner fields, in the 2x2 order of the panel (top-left, top-right, bottom-left,
 * bottom-right). `index` is the place of that corner in `cornerRadiiCm`.
 */
const CORNER_FIELDS: readonly { label: string; ariaLabel: string; index: number }[] = [
  { label: 'TL', ariaLabel: 'Top-left radius', index: 0 },
  { label: 'TR', ariaLabel: 'Top-right radius', index: 1 },
  { label: 'BL', ariaLabel: 'Bottom-left radius', index: 3 },
  { label: 'BR', ariaLabel: 'Bottom-right radius', index: 2 },
]

/** Room alignment buttons: two rows of 3 (horizontal, then vertical) and one centre button. */
const ALIGN_BUTTONS: readonly { op: FurnitureAlignment; label: string; Icon: typeof ArrowDown }[] = [
  { op: 'left', label: 'Align left', Icon: AlignStartVertical },
  { op: 'center-x', label: 'Center horizontally', Icon: AlignCenterVertical },
  { op: 'right', label: 'Align right', Icon: AlignEndVertical },
  { op: 'top', label: 'Align top', Icon: AlignStartHorizontal },
  { op: 'center-y', label: 'Center vertically', Icon: AlignCenterHorizontal },
  { op: 'bottom', label: 'Align bottom', Icon: AlignEndHorizontal },
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
  const renameRequestId = useUi((s) => s.renameRequestId)
  const nameId = useId()
  const heightId = useId()
  // The 4 corner fields are open by default when the radii already differ; the toggle forces a view.
  const [cornersOpen, setCornersOpen] = useState<boolean | null>(null)

  // Rename (Cmd/Ctrl+R): the shortcut only asks for the field, the card focuses and selects it.
  useEffect(() => {
    if (!item || renameRequestId !== item.id) return
    const el = document.getElementById(nameId)
    useUi.getState().set({ renameRequestId: null })
    if (el instanceof HTMLInputElement) {
      el.focus()
      el.select()
    }
  }, [renameRequestId, item, nameId])

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

  // Effective radii, in the order top-left, top-right, bottom-right, bottom-left.
  const radii = furnitureCornerRadiiCm(item)
  const mixedRadii = radii.some((r) => r !== radii[0])
  const independent = cornersOpen ?? mixedRadii

  /** One radius for all 4 corners: clears any per-corner radius. */
  const commitRadius = (value: number | null): boolean | void => {
    if (value == null) return false
    const next = Math.max(0, Math.min(value, maxRadiusCm))
    if (!mixedRadii && next === radii[0]) return
    patch({ cornerRadiusCm: next, cornerRadiiCm: undefined })
  }

  /** Radius of one corner only (Alt-handle equivalent). 4 equal values fall back to the single field. */
  const commitCornerRadius = (index: number) => (value: number | null): boolean | void => {
    if (value == null) return false
    const next = Math.max(0, Math.min(value, maxRadiusCm))
    if (next === radii[index]) return
    const all: CornerRadii = [radii[0], radii[1], radii[2], radii[3]]
    all[index] = next
    // 4 equal radii fall back to the single field, with no per-corner radius left behind.
    const written = cornerRadiiPatch(item.shape, all)
    if (written && 'cornerRadiusCm' in written) patch({ cornerRadiusCm: written.cornerRadiusCm, cornerRadiiCm: undefined })
    else patch({ cornerRadiiCm: all })
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

  const alignRoom = findFurnitureRoom(item, artboard.rooms)
  const alignHint = 'Place item inside a room to align'
  const alignTo = (op: FurnitureAlignment) => {
    const next = alignFurnitureInRoom(item, artboard.rooms, op, artboard.precisionCm)
    if (!next || (next.xCm === item.xCm && next.yCm === item.yCm)) return
    patch(next) // one updateFurniture call = one undo step
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

  const saveAsPreset = () => {
    const saved = useCustomPresets.getState().addPreset({
      name: item.name,
      shape: item.shape,
      widthCm: item.widthCm,
      depthCm: item.depthCm,
      color: item.color,
      heightCm: item.heightCm ?? 75,
      showDirection: !!item.showDirection,
    })
    toast(`Saved preset "${saved.name}"`, { kind: 'info' })
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
          <>
            <FieldRow label="Corner radius" hint="rounded corners">
              <div className="flex items-center gap-1">
                <NumberField
                  ariaLabel="Furniture corner radius"
                  unit="cm"
                  min={0}
                  max={maxRadiusCm}
                  placeholder={mixedRadii ? 'Mixed' : undefined}
                  value={mixedRadii ? null : radii[0]}
                  onCommit={commitRadius}
                />
                <IconButton
                  label="Independent corners"
                  icon={<CornerUpLeft size={16} aria-hidden="true" />}
                  pressed={independent}
                  onClick={() => setCornersOpen(!independent)}
                />
              </div>
            </FieldRow>

            {independent && (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Corner radii">
                {CORNER_FIELDS.map((f) => (
                  <div key={f.label} className="flex min-w-0 flex-col gap-1">
                    <span className={label}>{f.label}</span>
                    <NumberField
                      ariaLabel={f.ariaLabel}
                      unit="cm"
                      min={0}
                      max={maxRadiusCm}
                      value={radii[f.index]}
                      onCommit={commitCornerRadius(f.index)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
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

        <FieldRow label="Flip" hint="mirror the item" stacked>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label="Flip">
            <button
              type="button"
              className={BTN}
              title="Flip horizontal (Shift+H)"
              aria-label="Flip horizontal"
              aria-pressed={!!item.flipX}
              onClick={() => flipSelection('x')}
            >
              <FlipHorizontal2 size={14} aria-hidden="true" />
              Flip H
            </button>
            <button
              type="button"
              className={BTN}
              title="Flip vertical (Shift+V)"
              aria-label="Flip vertical"
              aria-pressed={!!item.flipY}
              onClick={() => flipSelection('y')}
            >
              <FlipVertical2 size={14} aria-hidden="true" />
              Flip V
            </button>
          </div>
        </FieldRow>

        <FieldRow label={alignRoom ? `Align in ${alignRoom.name.trim() === '' ? 'room' : alignRoom.name}` : 'Align in room'} stacked>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label="Align in room">
            {ALIGN_BUTTONS.map(({ op, label: opLabel, Icon }) => (
              <button
                key={op}
                type="button"
                className={BTN}
                title={alignRoom ? opLabel : alignHint}
                aria-label={opLabel}
                disabled={!alignRoom}
                onClick={() => alignTo(op)}
              >
                <Icon size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        </FieldRow>
        <button
          type="button"
          className={BTN}
          title={alignRoom ? 'Center in room (both axes)' : alignHint}
          aria-label="Center in room"
          disabled={!alignRoom}
          onClick={() => alignTo('center')}
        >
          <Maximize size={14} aria-hidden="true" />
          Center in room
        </button>
        {!alignRoom && <p className={MUTED}>{alignHint}.</p>}
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
        <button type="button" className={BTN} onClick={saveAsPreset} title="Save this item as a custom preset">
          <BookmarkPlus size={14} aria-hidden="true" />
          Save as preset
        </button>
        <DangerButton onClick={remove} shortcut="Del">
          Delete
        </DangerButton>
      </PanelSection>
    </>
  )
}
