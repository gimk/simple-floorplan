// Right-panel Inspect card for SEVERAL selected furniture items in Design mode: size (Width × Depth
// or one Diameter for circles, plus Height), the furniture colour swatches and the flip buttons write
// to every selected item in one click and one undo step, and the Duplicate / Delete buttons act on the
// whole group (same behaviour as Cmd/Ctrl+D and Delete). Per-item things (name, shape, rotation, stack
// order, corner radius) have no meaning for a group, so this card does not show them.
// Styling, swatch row and buttons come from FurnitureInspect.tsx (single item card). Units: cm.
import { useId } from 'react'
import { Armchair, Copy, FlipHorizontal2, FlipVertical2, Group, Layers, Palette, Ruler, Ungroup } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { FurnitureItem } from '../../model/types'
import { BTN, ColorRow, DangerButton, FieldRow, LABEL, MUTED, NumberField, PanelSection } from '../../shell/panel'
import { toast } from '../toast'
import {
  deleteFurnitureGroup,
  duplicateFurnitureGroup,
  groupFurniture,
  ungroupFurniture,
  updateFurnitureMany,
} from './actions'
import { flipSelection } from './flip'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM } from './geometry'
import { hasAnyGroupedItem, isSingleWholeGroup } from './groups'
import { allCircles, commonSizeCm, isSizeValueValid, sizePatches, type SizeField } from './multiSize'
import { FURNITURE_COLORS } from './presets'

export type FurnitureMultiInspectProps = {
  /** Artboard that holds the items. */
  artboardId: string
  /** Selected items. Unknown ids are ignored; when none matches the card renders nothing. */
  furnitureIds: string[]
}

/** Furniture colour swatches for the shared ColorRow (same list as the single item card). */
const COLOR_VALUES = FURNITURE_COLORS.map((c) => c.color)

/** Lower-cased colour key, so '#FFF' and '#fff' are the same colour. */
const colorKey = (color: string): string => color.toLowerCase()

/**
 * Inspect card of several furniture items in Design mode. A swatch is active only when every item
 * shares that colour, a size field shows a value only when every item shares it. Renders nothing when
 * the artboard or every item id is unknown.
 */
export function FurnitureMultiInspect({ artboardId, furnitureIds }: FurnitureMultiInspectProps) {
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
  const heightId = useId()
  const items: FurnitureItem[] = artboard ? artboard.furniture.filter((f) => furnitureIds.includes(f.id)) : []
  if (!artboard || items.length === 0) return null

  const ids = items.map((f) => f.id)
  const first = items[0]
  // A swatch is active only when every item shares that colour; otherwise the row shows no ring.
  const colorsMixed = items.some((f) => colorKey(f.color) !== colorKey(first.color))
  const color = colorsMixed ? undefined : first.color
  const currentLabel = colorsMixed
    ? 'Mixed colors'
    : (FURNITURE_COLORS.find((c) => colorKey(c.color) === colorKey(first.color))?.label ?? 'Custom color')

  // Size fields: null = the items differ, so the field is blank with a "Mixed" placeholder.
  const circles = allCircles(items)
  const widthCm = commonSizeCm(items, 'width')
  const depthCm = commonSizeCm(items, 'depth')
  const heightCm = commonSizeCm(items, 'height')
  // One Diameter edits both sides of a circle, so it is mixed as soon as one of them differs.
  const diameterCm = widthCm === null || depthCm === null ? null : widthCm
  const sizeMixed = circles ? diameterCm === null || heightCm === null : widthCm === null || depthCm === null || heightCm === null

  /**
   * One committed size field writes every selected item in the same update() call (one undo step), and
   * records nothing when no item changes (see sizePatches). false rejects the typed value, like the
   * single item card: a width or a depth is required, a height must be positive.
   */
  const commitSize = (field: SizeField) => (value: number | null): boolean | void => {
    if (!isSizeValueValid(field, value)) return false
    const patches = sizePatches(items, field, value)
    if (patches.size === 0) return
    useDoc.getState().update((d) => {
      const ab = d.artboards.find((a) => a.id === artboard.id)
      if (!ab) return
      for (const f of ab.furniture) {
        const patch = patches.get(f.id)
        if (patch) Object.assign(f, patch)
      }
    })
  }

  const remove = () => {
    deleteFurnitureGroup(artboard.id, ids)
    toast(`Deleted ${items.length} items`, {
      kind: 'info',
      actionLabel: 'Undo',
      onAction: () => useDoc.getState().undo(),
    })
  }

  return (
    <>
      <PanelSection title="Furniture" icon={<Armchair size={14} aria-hidden="true" />}>
        <p className="text-sm font-semibold text-slate-100">{`${items.length} items selected`}</p>
        <p className={MUTED}>Drag any of them to move the group. Shift-click adds or removes one item.</p>
      </PanelSection>

      <PanelSection title="Size" icon={<Ruler size={14} aria-hidden="true" />}>
        <div className="grid grid-cols-2 gap-2">
          {circles ? (
            <div className="flex min-w-0 flex-col gap-1">
              <span className={LABEL}>Diameter</span>
              <NumberField
                ariaLabel="Furniture diameter"
                unit="cm"
                min={MIN_FURNITURE_CM}
                max={MAX_FURNITURE_CM}
                placeholder={diameterCm === null ? 'Mixed' : undefined}
                value={diameterCm}
                onCommit={commitSize('width')}
              />
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-col gap-1">
                <span className={LABEL}>Width</span>
                <NumberField
                  ariaLabel="Furniture width"
                  unit="cm"
                  min={MIN_FURNITURE_CM}
                  max={MAX_FURNITURE_CM}
                  placeholder={widthCm === null ? 'Mixed' : undefined}
                  value={widthCm}
                  onCommit={commitSize('width')}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className={LABEL}>Depth</span>
                <NumberField
                  ariaLabel="Furniture depth"
                  unit="cm"
                  min={MIN_FURNITURE_CM}
                  max={MAX_FURNITURE_CM}
                  placeholder={depthCm === null ? 'Mixed' : undefined}
                  value={depthCm}
                  onCommit={commitSize('depth')}
                />
              </div>
            </>
          )}
        </div>

        <FieldRow label="Height" hint="for 3D" htmlFor={heightId}>
          <NumberField
            id={heightId}
            ariaLabel="Furniture height"
            unit="cm"
            min={1}
            placeholder={heightCm === null ? 'Mixed' : 'e.g. 80'}
            value={heightCm}
            onCommit={commitSize('height')}
          />
        </FieldRow>

        {sizeMixed && <p className={MUTED}>A blank field means the items have different values.</p>}
        {circles && <p className={MUTED}>A circle stays round: Diameter sets width and depth.</p>}
      </PanelSection>

      <PanelSection title="Appearance" icon={<Palette size={14} aria-hidden="true" />}>
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Color</span>
          <ColorRow
            label="Furniture color"
            colors={COLOR_VALUES}
            value={color}
            onChange={(next) => {
              if (!colorsMixed && next === first.color) return
              updateFurnitureMany(artboard.id, ids, { color: next })
            }}
          />
        </div>
        <p className={MUTED}>{currentLabel}</p>

        <div className="grid grid-cols-2 gap-1" role="group" aria-label="Flip">
          <button
            type="button"
            className={BTN}
            title="Flip horizontal (Shift+H)"
            aria-label="Flip horizontal"
            onClick={() => flipSelection('x')}
          >
            <FlipVertical2 size={14} aria-hidden="true" />
            Flip H
          </button>
          <button
            type="button"
            className={BTN}
            title="Flip vertical (Shift+V)"
            aria-label="Flip vertical"
            onClick={() => flipSelection('y')}
          >
            <FlipHorizontal2 size={14} aria-hidden="true" />
            Flip V
          </button>
        </div>
      </PanelSection>

      <PanelSection title="Arrange" icon={<Layers size={14} aria-hidden="true" />}>
        {!isSingleWholeGroup(artboard, ids) && (
          <button
            type="button"
            className={BTN}
            onClick={() => {
              groupFurniture(artboard.id, ids)
            }}
            title="Group selected items"
          >
            <Group size={14} aria-hidden="true" />
            Group
          </button>
        )}
        {hasAnyGroupedItem(artboard, ids) && (
          <button
            type="button"
            className={BTN}
            onClick={() => {
              ungroupFurniture(artboard.id, ids)
            }}
            title="Ungroup selected items"
          >
            <Ungroup size={14} aria-hidden="true" />
            Ungroup
          </button>
        )}
        <button
          type="button"
          className={BTN}
          onClick={() => {
            duplicateFurnitureGroup(artboard.id, ids)
          }}
          title="Duplicate these items (the copies move 20 cm)"
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
