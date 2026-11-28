// Right-panel Inspect card for a mixed multi-selection ('multi'): walls, doors and windows, rooms
// and furniture can be mixed freely inside one mode (Plan mode: walls, rooms and openings; Design
// mode: furniture and rooms). One card per kind present, in a fixed order, and every edit is ONE
// useDoc update, so it is one undo step.
// Visual style only, like the style clipboard: wall colour, opening colour, room floor (colour,
// pattern, angle) and furniture colour. No geometry field is shown: position, size, rotation and
// stack order have no meaning for a group.
// A control shows a value only when every selected object of that kind agrees; otherwise it is
// blank (or has no active swatch) and a "Mixed" line says why. A pick then sets them all.
// The header counts what the selection holds, for example "5 selected: 3 walls, 2 doors".
// Styling, swatch row and floor controls come from the single and multi cards
// (DesignRoomInspect.tsx, DesignRoomsInspect.tsx, FurnitureMultiInspect.tsx). Units: cm, degrees.
import { useId } from 'react'
import { Armchair, DoorOpen, Layers, Paintbrush, RotateCcw, Square } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { Artboard, FloorPattern, MultiTarget } from '../../model/types'
import { BTN, ColorRow, FieldRow, LABEL, MUTED, NumberField, PanelSection } from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { FloorSwatch } from '../furniture/DesignRoomInspect'
import { FLOOR_PATTERNS, FLOOR_SWATCHES, FURNITURE_COLORS, WALL_ACCENT_COLORS } from '../furniture/presets'
import { isPatterned } from '../rooms/floorPatterns'
import { applyStylePatch, multiStyleSummary } from './multiStyle'

/** Wall paint swatches, without the "Default" entry: the reset button clears the paint instead. */
const WALL_COLOR_VALUES: readonly string[] = WALL_ACCENT_COLORS.flatMap((swatch) =>
  swatch.color === undefined ? [] : [swatch.color],
)

/** Furniture body colours, the same list as the single and multi furniture cards. */
const FURNITURE_COLOR_VALUES: readonly string[] = FURNITURE_COLORS.map((c) => c.color)

/**
 * Curated door and window colours: the same list as OpeningInspect.tsx, which keeps it private.
 * They are light and dark frame colours, and the reset button goes back to the default ones.
 */
const OPENING_COLOR_VALUES: readonly string[] = [
  '#ffffff',
  '#f1ece1',
  '#c9a173',
  '#5c4033',
  '#383e42',
  '#1a1a1a',
  '#9caf88',
  '#708090',
]

/** Lower-cased colour key, so '#FFF' and '#fff' are the same colour. */
const colorKey = (color: string | undefined): string => (color === undefined ? '' : color.toLowerCase())

/** "1 wall" / "3 walls", for the header line. */
const countLabel = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** The shared floor pattern as the card stores it: 'solid' means "no pattern" (nothing stored). */
const storedPattern = (pattern: FloorPattern | undefined): FloorPattern | undefined =>
  pattern === undefined || pattern === 'solid' ? undefined : pattern

/**
 * Inspect card of a mixed multi-selection. Renders nothing when the selection is not a 'multi' one
 * or when the artboard is unknown, so the shell can mount it unconditionally.
 */
export function MultiInspect() {
  const selection = useUi((s) => s.selection)
  const artboardId = selection.kind === 'multi' ? selection.artboardId : null
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
  const angleId = useId()
  if (selection.kind !== 'multi' || !artboard) return null

  const items = selection.items
  const summary = multiStyleSummary(artboard, items)
  const { walls, openings, rooms, furniture } = summary

  /**
   * Run one style write on the document draft: ONE useDoc update, so the whole edit is one undo
   * step. `write` names the patch (see applyStylePatch); a missing artboard writes nothing.
   */
  const commitStyle = (write: (draft: Artboard, targets: readonly MultiTarget[]) => void) => {
    useDoc.getState().update((d) => {
      const draft = d.artboards.find((a) => a.id === artboard.id)
      if (draft) write(draft, items)
    })
  }

  // Header: what the selection holds, kind by kind.
  const parts: string[] = []
  if (walls) parts.push(countLabel(walls.count, 'wall', 'walls'))
  if (openings) {
    const kinds = openings.kinds
    if (kinds.door) parts.push(countLabel(kinds.door, 'door', 'doors'))
    if (kinds.window) parts.push(countLabel(kinds.window, 'window', 'windows'))
    if (kinds.opening) parts.push(countLabel(kinds.opening, 'opening', 'openings'))
  }
  if (rooms) parts.push(countLabel(rooms.count, 'room', 'rooms'))
  if (furniture) parts.push(countLabel(furniture.count, 'item', 'items'))
  const total = (walls?.count ?? 0) + (openings?.count ?? 0) + (rooms?.count ?? 0) + (furniture?.count ?? 0)

  // Wall colour: a swatch is active only when every selected wall has that paint.
  const wallColor = walls ? (walls.color.mixed ? undefined : walls.color.value) : undefined
  const noWallPaint = !!walls && !walls.color.mixed && walls.color.value === undefined
  const wallColorLabel = !walls
    ? ''
    : walls.color.mixed
      ? 'Mixed'
      : wallColor === undefined
        ? 'Default'
        : (WALL_ACCENT_COLORS.find((s) => colorKey(s.color) === colorKey(wallColor))?.label ?? 'Custom colour')

  // Opening colour, same rule.
  const openingColor = openings ? (openings.color.mixed ? undefined : openings.color.value) : undefined
  const noOpeningColor = !!openings && !openings.color.mixed && openings.color.value === undefined

  // Floor of the rooms: colour, pattern ('solid' = no pattern) and pattern angle.
  const fillLabel = !rooms
    ? ''
    : rooms.fill.mixed
      ? 'Mixed'
      : (FLOOR_SWATCHES.find((s) => colorKey(s.color) === colorKey(rooms.fill.value))?.label ?? 'Custom colour')
  const pattern = rooms ? (rooms.floorPattern.mixed ? undefined : rooms.floorPattern.value) : undefined
  const anyPatterned = !!rooms && (rooms.floorPattern.mixed || isPatterned(rooms.floorPattern.value))
  const angle = rooms ? (rooms.floorPatternAngleDeg.mixed ? null : (rooms.floorPatternAngleDeg.value ?? 0)) : null

  // Furniture colour.
  const furnitureColor = furniture ? (furniture.color.mixed ? undefined : furniture.color.value) : undefined
  const furnitureColorLabel = !furniture
    ? ''
    : furniture.color.mixed
      ? 'Mixed'
      : (FURNITURE_COLORS.find((c) => colorKey(c.color) === colorKey(furnitureColor))?.label ?? 'Custom colour')

  return (
    <>
      <PanelSection title="Selection" icon={<Layers size={14} aria-hidden="true" />}>
        <p className="text-sm font-semibold text-slate-100">{`${total} selected: ${parts.join(', ')}`}</p>
        <p className={MUTED}>Shift-click adds or removes one object. A mixed value shows as Mixed, and picking sets them all.</p>
      </PanelSection>

      {walls && (
        <PanelSection title="Walls" icon={<Paintbrush size={14} aria-hidden="true" />}>
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Wall colour</span>
            <ColorRow
              label="Wall colour"
              colors={WALL_COLOR_VALUES}
              value={wallColor}
              onChange={(color) => {
                if (!walls.color.mixed && colorKey(color) === colorKey(walls.color.value)) return
                commitStyle((draft, targets) => applyStylePatch(draft, targets, 'wall', { color }))
              }}
            />
          </div>
          <p className={MUTED}>{wallColorLabel}</p>
          <button
            type="button"
            className={BTN}
            disabled={noWallPaint}
            onClick={() => commitStyle((draft, targets) => applyStylePatch(draft, targets, 'wall', { color: undefined }))}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reset to default
          </button>
        </PanelSection>
      )}

      {openings && (
        <PanelSection title="Doors and windows" icon={<DoorOpen size={14} aria-hidden="true" />}>
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Colour</span>
            <ColorRow
              label="Door and window colour"
              colors={OPENING_COLOR_VALUES}
              value={openingColor}
              onChange={(color) => {
                if (!openings.color.mixed && colorKey(color) === colorKey(openings.color.value)) return
                commitStyle((draft, targets) => applyStylePatch(draft, targets, 'opening', { color }))
              }}
            />
          </div>
          <p className={MUTED}>
            {openings.color.mixed
              ? 'Mixed'
              : openingColor === undefined
                ? 'Default (the built-in door and window colours)'
                : 'Custom colour (the colour of the door or window in 3D)'}
          </p>
          <button
            type="button"
            className={BTN}
            disabled={noOpeningColor}
            onClick={() =>
              commitStyle((draft, targets) => applyStylePatch(draft, targets, 'opening', { color: undefined }))
            }
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reset to default
          </button>
        </PanelSection>
      )}

      {rooms && (
        <PanelSection title="Rooms" icon={<Square size={14} aria-hidden="true" />}>
          <div className="grid grid-cols-5 gap-2" role="group" aria-label="Floor colour">
            {FLOOR_SWATCHES.map((swatch) => {
              const active = !rooms.fill.mixed && colorKey(swatch.color) === colorKey(rooms.fill.value)
              return (
                <FloorSwatch
                  key={swatch.id}
                  label={swatch.label}
                  color={swatch.color}
                  active={active}
                  onPick={() => {
                    if (active) return
                    commitStyle((draft, targets) => applyStylePatch(draft, targets, 'room', { fill: swatch.color }))
                  }}
                />
              )
            })}
          </div>
          <p className={MUTED}>{fillLabel}</p>

          <div className="grid grid-cols-3 gap-1" role="group" aria-label="Floor pattern">
            {FLOOR_PATTERNS.map((p) => {
              const active = !rooms.floorPattern.mixed && pattern === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (active) return
                    commitStyle((draft, targets) =>
                      applyStylePatch(draft, targets, 'room', { floorPattern: storedPattern(p.id) }),
                    )
                  }}
                  className={`min-h-7 rounded-full border px-2 text-xs font-medium pointer-coarse:min-h-10 ${
                    active
                      ? 'border-orange-500 bg-orange-500/15 text-orange-600 dark:text-orange-300'
                      : 'border-black/15 text-slate-700 hover:bg-black/5 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
          {rooms.floorPattern.mixed && <p className={MUTED}>Mixed</p>}

          {anyPatterned && (
            <>
              <FieldRow label="Pattern angle" hint="degrees" htmlFor={angleId}>
                <NumberField
                  id={angleId}
                  ariaLabel="Floor pattern angle"
                  unit="°"
                  min={0}
                  max={359}
                  value={angle}
                  placeholder={angle === null ? 'Mixed' : undefined}
                  onCommit={(v) => {
                    const deg = v ?? 0
                    if (angle !== null && deg === angle) return
                    commitStyle((draft, targets) =>
                      applyStylePatch(draft, targets, 'room', { floorPatternAngleDeg: deg === 0 ? undefined : deg }),
                    )
                  }}
                />
              </FieldRow>
              <div className="grid grid-cols-4 gap-1" role="group" aria-label="Quick pattern angle">
                {[0, 45, 90, 135].map((a) => {
                  const active = angle !== null && angle === a
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        if (active) return
                        commitStyle((draft, targets) =>
                          applyStylePatch(draft, targets, 'room', { floorPatternAngleDeg: a === 0 ? undefined : a }),
                        )
                      }}
                      className={`min-h-7 rounded-full border px-1 text-xs font-medium pointer-coarse:min-h-10 ${
                        active
                          ? 'border-orange-500 bg-orange-500/15 text-orange-600 dark:text-orange-300'
                          : 'border-black/15 text-slate-700 hover:bg-black/5 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/10'
                      }`}
                    >
                      {`${a}°`}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </PanelSection>
      )}

      {furniture && (
        <PanelSection title="Furniture" icon={<Armchair size={14} aria-hidden="true" />}>
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Colour</span>
            <ColorRow
              label="Furniture colour"
              colors={FURNITURE_COLOR_VALUES}
              value={furnitureColor}
              onChange={(color) => {
                if (!furniture.color.mixed && colorKey(color) === colorKey(furniture.color.value)) return
                commitStyle((draft, targets) => applyStylePatch(draft, targets, 'furniture', { color }))
              }}
            />
          </div>
          <p className={MUTED}>{furnitureColorLabel}</p>
        </PanelSection>
      )}
    </>
  )
}
