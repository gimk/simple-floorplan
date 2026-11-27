// Right-panel Inspect card for SEVERAL selected furniture items in Design mode: the furniture colour
// swatches write to every selected item in one click and one undo step, and the Duplicate / Delete
// buttons act on the whole group (same behaviour as Cmd/Ctrl+D and Delete). Per-item things (name,
// shape, size, rotation, stack order) have no meaning for a group, so this card does not show them.
// Styling, swatch row and buttons come from FurnitureInspect.tsx (single item card). Units: cm.
import { Armchair, Copy, Group, Layers, Palette, Ungroup } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { FurnitureItem } from '../../model/types'
import { BTN, ColorRow, DangerButton, LABEL, MUTED, PanelSection } from '../../shell/panel'
import { toast } from '../toast'
import {
  deleteFurnitureGroup,
  duplicateFurnitureGroup,
  groupFurniture,
  ungroupFurniture,
  updateFurnitureMany,
} from './actions'
import { hasAnyGroupedItem, isSingleWholeGroup } from './groups'
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
 * shares that colour. Renders nothing when the artboard or every item id is unknown.
 */
export function FurnitureMultiInspect({ artboardId, furnitureIds }: FurnitureMultiInspectProps) {
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
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
