// Left-panel content of Design mode (docs/simple-floorplan-2.md §6, Phase 4):
//   - "Custom shape": name, Rect / Circle, width cm, depth cm, colour swatch and Add shape.
//   - "Presets": the starter furniture list, grouped by category, one click to add an item.
//   - Custom presets saved by the user (localStorage) are listed first and can be deleted.
// A new item lands at the centre of the visible screen. Units: cm.
// Dark UI, built from the shared sidebar primitives in src/shell/panel.
import { useId, useRef, useState } from 'react'
import { BookmarkPlus, LayoutGrid, Plus, Search, Shapes, Trash2 } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { FurnitureItem } from '../../model/types'
import {
  BTN,
  ColorRow,
  EmptyHint,
  FieldRow,
  INPUT,
  MUTED,
  NumberField,
  PanelSection,
  Segmented,
  SwitchRow,
  TextField,
} from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { roundToPrecision } from '../rooms/ops'
import { canvasCenterWorld } from '../../shell/zoom'
import { toast } from '../toast'
import { addFurniture } from './actions'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM } from './geometry'
import { useCustomPresets } from './customPresets'
import { FURNITURE_CATEGORY_BY_ID, FURNITURE_COLORS, FURNITURE_PRESETS, type FurniturePreset } from './presets'

/** Shape of a new item. */
type Shape = FurnitureItem['shape']

/** The fields of a new item: its position comes from the active artboard. */
type NewItem = {
  name: string
  shape: Shape
  widthCm: number
  depthCm: number
  color: string
  heightCm?: number
  showDirection?: boolean
}

/** Defaults of the custom shape form. */
const DEFAULT_NAME = 'Custom'
const DEFAULT_WIDTH_CM = 120
const DEFAULT_DEPTH_CM = 60

const SHAPE_OPTIONS = [
  { value: 'rect', label: 'Rect', title: 'Rectangle' },
  { value: 'circle', label: 'Circle', title: 'Circle or oval' },
] as const

/** Full-width primary button of the board (orange, like the active segmented choice). */
const ADD_BTN =
  'inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md bg-orange-700 px-3 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 pointer-coarse:min-h-11'

const clampCm = (v: number): number => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))

const CUSTOM_CATEGORY = 'Custom'

const categoryOf = (preset: FurniturePreset): string =>
  preset.id.startsWith('custom-') ? CUSTOM_CATEGORY : (FURNITURE_CATEGORY_BY_ID[preset.id] ?? 'Other')

/** Category chips, in the order of the preset list (unique). */
const BUILT_IN_CATEGORIES: readonly string[] = [...new Set(FURNITURE_PRESETS.map(categoryOf))]

/** Distance between two items added one after the other, and how many steps before the cycle restarts. */
const CASCADE_STEP_CM = 20
const CASCADE_STEPS = 5

/** Furniture colour swatches for the shared ColorRow. */
const COLOR_VALUES = FURNITURE_COLORS.map((c) => c.color)

/** Side of the thumbnail box, in px. */
const THUMB = 32

/** Top-down thumbnail: the shape at its true aspect ratio, in the item colour. */
function PresetThumb({ item }: { item: FurniturePreset }) {
  const max = Math.max(item.widthCm, item.depthCm)
  const w = Math.max(4, (item.widthCm / max) * (THUMB - 4))
  const h = Math.max(4, (item.depthCm / max) * (THUMB - 4))
  const x = (THUMB - w) / 2
  const y = (THUMB - h) / 2
  const stroke = 'rgba(255,255,255,0.35)'
  return (
    <svg width={THUMB} height={THUMB} viewBox={`0 0 ${THUMB} ${THUMB}`} aria-hidden="true" className="shrink-0">
      {item.shape === 'circle' ? (
        <ellipse cx={THUMB / 2} cy={THUMB / 2} rx={w / 2} ry={h / 2} fill={item.color} stroke={stroke} />
      ) : (
        <rect x={x} y={y} width={w} height={h} rx={Math.min(3, w / 4, h / 4)} fill={item.color} stroke={stroke} />
      )}
    </svg>
  )
}

/** One preset button: top-down thumbnail, the name over the size, and an always visible plus. */
function PresetButton({
  item,
  onAdd,
  onDelete,
  disabled,
}: {
  item: FurniturePreset
  onAdd: () => void
  onDelete?: () => void
  disabled: boolean
}) {
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Add ${item.name}`}
        title={disabled ? 'Add an artboard first' : `Add ${item.name} (${item.widthCm} × ${item.depthCm} cm)`}
        disabled={disabled}
        onClick={onAdd}
        className="group flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
      >
        <PresetThumb item={item} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium leading-tight text-slate-800 dark:text-slate-100">
            {item.name}
          </span>
          <span className="mt-0.5 font-mono text-[11px] leading-tight tabular-nums text-slate-500 dark:text-slate-400">
            {`${item.widthCm} × ${item.depthCm} cm`}
          </span>
        </span>
        <Plus size={16} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" />
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete preset ${item.name}`}
          title="Delete preset"
          onClick={onDelete}
          className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-red-500/10 hover:text-red-400 pointer-coarse:min-h-11 pointer-coarse:min-w-11 dark:text-slate-400"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  )
}

/** Left panel of Design mode: the custom shape form and the preset list. */
export function FurniturePanel() {
  const artboards = useDoc((s) => s.doc.artboards)
  const activeArtboardId = useUi((s) => s.activeArtboardId)
  const nameId = useId()

  const [name, setName] = useState(DEFAULT_NAME)
  const [shape, setShape] = useState<Shape>('rect')
  const [widthCm, setWidthCm] = useState(DEFAULT_WIDTH_CM)
  const [depthCm, setDepthCm] = useState(DEFAULT_DEPTH_CM)
  const [color, setColor] = useState(FURNITURE_COLORS[0].color)
  const [showDirection, setShowDirection] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  // Number of items added by this panel: each new item is shifted a little, so repeated adds do not stack.
  const addCount = useRef(0)
  const searchId = useId()
  const customPresets = useCustomPresets((s) => s.presets)
  const addPreset = useCustomPresets((s) => s.addPreset)
  const removePreset = useCustomPresets((s) => s.removePreset)
  // Screen centre of the previous spawn: the cascade restarts when it changes (pan or zoom).
  const lastCenter = useRef<string | null>(null)

  const artboard = artboards.find((a) => a.id === activeArtboardId) ?? artboards[0]

  /**
   * Add one item at the centre of the visible screen and select it (addFurniture does both).
   * `position` 'bottom' puts a rug under the items that are already there.
   */
  const place = (item: NewItem, position?: 'top' | 'bottom') => {
    if (!artboard) return
    const world = canvasCenterWorld()
    if (!world) return // no 2D canvas on screen (Views mode): nothing to place onto
    const key = `${Math.round(world.x)},${Math.round(world.y)}`
    if (key !== lastCenter.current) addCount.current = 0
    lastCenter.current = key
    const shift = (addCount.current % CASCADE_STEPS) * CASCADE_STEP_CM
    addCount.current += 1
    const p = artboard.precisionCm
    addFurniture(
      artboard.id,
      {
        ...item,
        xCm: roundToPrecision(world.x - artboard.xCm, p) + shift,
        yCm: roundToPrecision(world.y - artboard.yCm, p) + shift,
        rotationDeg: 0,
      },
      { position },
    )
  }

  const addCustom = () => {
    const trimmed = name.trim()
    place({
      name: trimmed === '' ? DEFAULT_NAME : trimmed,
      shape,
      widthCm: clampCm(widthCm),
      depthCm: clampCm(depthCm),
      color,
      showDirection,
    })
  }

  const saveCustom = () => {
    const saved = addPreset({
      name: name.trim() === '' ? DEFAULT_NAME : name.trim(),
      shape,
      widthCm: clampCm(widthCm),
      depthCm: clampCm(depthCm),
      color,
      heightCm: 75,
      showDirection,
    })
    toast(`Saved preset "${saved.name}"`, { kind: 'info' })
  }

  const allPresets = [...customPresets, ...FURNITURE_PRESETS]
  const categories = customPresets.length > 0 ? [CUSTOM_CATEGORY, ...BUILT_IN_CATEGORIES] : BUILT_IN_CATEGORIES
  const needle = query.trim().toLowerCase()
  const shown = allPresets.filter(
    (p) => (category === null || categoryOf(p) === category) && (needle === '' || p.name.toLowerCase().includes(needle)),
  )

  return (
    <>
      <PanelSection title="Custom shape" icon={<Shapes size={14} aria-hidden="true" />} collapsible defaultOpen={false}>
        <FieldRow label="Name" htmlFor={nameId}>
          <TextField
            id={nameId}
            ariaLabel="Custom shape name"
            value={name}
            placeholder={DEFAULT_NAME}
            onCommit={setName}
          />
        </FieldRow>

        <FieldRow label="Shape" stacked>
          <Segmented
            ariaLabel="Shape"
            options={SHAPE_OPTIONS}
            value={shape}
            onChange={(v) => setShape(v === 'circle' ? 'circle' : 'rect')}
          />
        </FieldRow>

        <FieldRow label="Width">
          <NumberField
            ariaLabel="Custom shape width"
            unit="cm"
            min={MIN_FURNITURE_CM}
            max={MAX_FURNITURE_CM}
            value={widthCm}
            onCommit={(v) => {
              if (v == null) return false
              setWidthCm(clampCm(v))
            }}
          />
        </FieldRow>

        <FieldRow label="Depth">
          <NumberField
            ariaLabel="Custom shape depth"
            unit="cm"
            min={MIN_FURNITURE_CM}
            max={MAX_FURNITURE_CM}
            value={depthCm}
            onCommit={(v) => {
              if (v == null) return false
              setDepthCm(clampCm(v))
            }}
          />
        </FieldRow>

        <div className="flex flex-col gap-1">
          <span className={`text-xs ${MUTED}`}>Color</span>
          <ColorRow label="Furniture color" colors={COLOR_VALUES} value={color} onChange={setColor} />
        </div>

        <SwitchRow label="Direction arrow" checked={showDirection} onChange={setShowDirection} />

        <button
          type="button"
          className={ADD_BTN}
          onClick={addCustom}
          disabled={!artboard}
          title="Add this shape at the centre of the plan"
        >
          <Plus size={14} aria-hidden="true" />
          Add shape
        </button>
        <button
          type="button"
          className={`${BTN} w-full`}
          onClick={saveCustom}
          title="Save this shape as a custom preset"
        >
          <BookmarkPlus size={14} aria-hidden="true" />
          Save as preset
        </button>
      </PanelSection>

      <PanelSection title="Presets" icon={<LayoutGrid size={14} aria-hidden="true" />}>
        <div className="relative">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
          />
          <input
            id={searchId}
            type="search"
            aria-label="Search furniture presets"
            placeholder="Search furniture"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${INPUT} pl-8`}
          />
        </div>
        <div role="group" aria-label="Preset categories" className="flex flex-wrap gap-1">
          {[null, ...categories].map((c) => {
            const active = category === c
            return (
              <button
                key={c ?? 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(c)}
                className={`min-h-7 rounded-full border px-2.5 text-xs font-medium pointer-coarse:min-h-10 ${
                  active
                    ? 'border-orange-500 bg-orange-500/15 text-orange-700 dark:text-orange-300'
                    : 'border-black/15 text-slate-700 hover:bg-black/5 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/10'
                }`}
              >
                {c ?? 'All'}
              </button>
            )
          })}
        </div>
        {shown.length === 0 ? (
          <EmptyHint>No preset matches your search.</EmptyHint>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Furniture presets">
            {shown.map((preset) => (
              <PresetButton
                key={preset.id}
                item={preset}
                disabled={!artboard}
                onDelete={preset.id.startsWith('custom-') ? () => removePreset(preset.id) : undefined}
                onAdd={() =>
                  place(
                    {
                      name: preset.name,
                      shape: preset.shape,
                      widthCm: preset.widthCm,
                      depthCm: preset.depthCm,
                      color: preset.color,
                      heightCm: preset.heightCm,
                      showDirection: preset.showDirection,
                    },
                    preset.layer,
                  )
                }
              />
            ))}
          </ul>
        )}
        <EmptyHint>
          {artboard ? 'New items land at the centre of the screen.' : 'Add an artboard in Plan mode to place furniture.'}
        </EmptyHint>
      </PanelSection>
    </>
  )
}
