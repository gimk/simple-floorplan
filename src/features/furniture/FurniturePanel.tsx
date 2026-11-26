// Left-panel content of Design mode (docs/simple-floorplan-2.md §6, Phase 4):
//   - "Custom shape": name, Rect / Circle, width cm, depth cm, colour swatch and Add shape.
//   - "Presets": the starter furniture list, one click to add an item.
// A new item lands at the centre of the active artboard: the centre of the rooms bounding box
// when the artboard has rooms, else the centre of its frame. Units: cm.
// Dark UI, built from the shared sidebar primitives in src/shell/panel.
import { useId, useState } from 'react'
import { Circle, LayoutGrid, Plus, Shapes, Square } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import {
  EmptyHint,
  FieldRow,
  MUTED,
  NumberField,
  PanelSection,
  ROW,
  ROW_OFF,
  Segmented,
  TextField,
} from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { artboardFrame } from '../artboards/frame'
import { addFurniture } from './actions'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM } from './geometry'
import { FURNITURE_COLORS, FURNITURE_PRESETS } from './presets'

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

/**
 * Artboard-local centre for a new item: the centre of the bounding box of every room vertex,
 * else the centre of the artboard frame (converted from world to artboard-local cm).
 */
function centerOfArtboard(artboard: Artboard): { xCm: number; yCm: number } {
  const pts = artboard.rooms.flatMap((r) => r.vertices)
  if (pts.length > 0) {
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    return {
      xCm: (Math.min(...xs) + Math.max(...xs)) / 2,
      yCm: (Math.min(...ys) + Math.max(...ys)) / 2,
    }
  }
  const frame = artboardFrame(artboard)
  return {
    xCm: frame.x + frame.width / 2 - artboard.xCm,
    yCm: frame.y + frame.height / 2 - artboard.yCm,
  }
}

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

/** One preset button: colour dot, shape icon, name and "W × D cm". */
function PresetButton({ item, onAdd }: { item: (typeof FURNITURE_PRESETS)[number]; onAdd: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-label={`Add ${item.name}`}
        title={`Add ${item.name} (${item.widthCm} × ${item.depthCm} cm)`}
        onClick={onAdd}
        className={`${ROW} ${ROW_OFF} flex min-h-9 w-full items-center gap-2 text-left hover:bg-black/5 pointer-coarse:min-h-11 dark:hover:bg-white/10`}
      >
        <span
          aria-hidden="true"
          style={{ backgroundColor: item.color }}
          className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/20 dark:border-white/25"
        />
        <span aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400">
          {item.shape === 'circle' ? <Circle size={12} /> : <Square size={12} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">
          {item.name}
        </span>
        <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`}>
          {`${item.widthCm} × ${item.depthCm} cm`}
        </span>
      </button>
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

  const artboard = artboards.find((a) => a.id === activeArtboardId) ?? artboards[0]

  /** Add one item at the centre of the active artboard and select it (addFurniture does both). */
  const place = (item: NewItem) => {
    if (!artboard) return
    const center = centerOfArtboard(artboard)
    addFurniture(artboard.id, { ...item, xCm: center.xCm, yCm: center.yCm, rotationDeg: 0 })
  }

  const addCustom = () => {
    const trimmed = name.trim()
    place({
      name: trimmed === '' ? DEFAULT_NAME : trimmed,
      shape,
      widthCm: clampCm(widthCm),
      depthCm: clampCm(depthCm),
      color,
    })
  }

  return (
    <>
      <PanelSection title="Custom shape" icon={<Shapes size={14} aria-hidden="true" />}>
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
          <ColorRow value={color} onPick={setColor} />
        </div>

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
      </PanelSection>

      <PanelSection title="Presets" icon={<LayoutGrid size={14} aria-hidden="true" />}>
        <ul className="flex flex-col gap-1" aria-label="Furniture presets">
          {FURNITURE_PRESETS.map((preset) => (
            <PresetButton
              key={preset.id}
              item={preset}
              onAdd={() =>
                place({
                  name: preset.name,
                  shape: preset.shape,
                  widthCm: preset.widthCm,
                  depthCm: preset.depthCm,
                  color: preset.color,
                  heightCm: preset.heightCm,
                })
              }
            />
          ))}
        </ul>
        <EmptyHint>New items land at the centre of the active artboard.</EmptyHint>
      </PanelSection>
    </>
  )
}
