// Right-panel Inspect card for one room in Design mode (docs/simple-floorplan-2.md §6, Phase 4):
// the name, the measured area, the floor colour of the room, and the furniture that sits in it
// (front-most first, with the two stack steps). The geometry of the room is read-only here: walls
// and dimensions belong to Plan mode.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm, m².
import { useId } from 'react'
import { Armchair, ChevronDown, ChevronUp, PaintBucket, Square } from 'lucide-react'
import { pointInPolygon } from '../../model/geometry'
import { useDoc } from '../../model/store'
import type { FurnitureItem, Room } from '../../model/types'
import { EmptyHint, FieldRow, IconButton, MUTED, PanelSection, TextField, formatM2 } from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { roomAreaM2 } from '../artboards/frame'
import { reorderFurniture, setRoomFill } from './actions'
import { FLOOR_SWATCHES } from './presets'

export type DesignRoomInspectProps = {
  /** Artboard that holds the room. */
  artboardId: string
  /** Room to inspect. Unknown ids render nothing. */
  roomId: string
}

/** One floor swatch: the colour circle, or a diagonal slash when the room has no fill. */
function FloorSwatch({
  label,
  color,
  active,
  onPick,
}: {
  label: string
  color: string | undefined
  active: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={color ? label : `${label} (no fill)`}
      title={color ? label : `${label} — no fill`}
      onClick={onPick}
      style={color ? { backgroundColor: color } : undefined}
      className={`relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-black/20 pointer-coarse:h-10 pointer-coarse:w-10 dark:border-white/25 ${
        color ? '' : 'bg-slate-200 dark:bg-slate-800'
      } ${
        active
          ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-white dark:ring-orange-400 dark:ring-offset-[#161b21]'
          : 'hover:opacity-80'
      }`}
    >
      {!color && (
        <svg viewBox="0 0 32 32" aria-hidden="true" className="h-full w-full text-slate-500 dark:text-slate-400">
          <line x1="6" y1="26" x2="26" y2="6" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
    </button>
  )
}

/**
 * Inspect card of one room in Design mode: name, area and floor colour. Renders nothing when the
 * artboard or the room is unknown, so the shell can mount it unconditionally.
 */
export function DesignRoomInspect({ artboardId, roomId }: DesignRoomInspectProps) {
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
  const room: Room | undefined = artboard?.rooms.find((r) => r.id === roomId)
  const nameId = useId()
  if (!artboard || !room) return null

  const fill = room.fill
  const currentLabel =
    fill === undefined
      ? 'Default (no fill)'
      : (FLOOR_SWATCHES.find((s) => s.color?.toLowerCase() === fill.toLowerCase())?.label ?? 'Custom color')

  const commitName = (value: string): boolean | void => {
    const name = value.trim()
    if (name === '') return false
    if (name === room.name) return
    useDoc.getState().update((d) => {
      const target = d.artboards.find((a) => a.id === artboard.id)?.rooms.find((r) => r.id === room.id)
      if (target) target.name = name
    })
  }

  /** Select one furniture item (the Inspect card then shows its own fields). */
  const selectItem = (item: FurnitureItem) => {
    useUi.getState().set({
      activeArtboardId: artboard.id,
      selection: { kind: 'furniture', artboardId: artboard.id, furnitureId: item.id },
    })
  }

  // Items whose centre is inside the room; the list runs front-most (top of the stack) first.
  const inRoom = artboard.furniture.filter((f) => pointInPolygon({ x: f.xCm, y: f.yCm }, room.vertices))
  const listed = [...inRoom].reverse()
  const topIndex = artboard.furniture.length - 1

  return (
    <>
      <PanelSection title="Room" icon={<Square size={14} aria-hidden="true" />}>
        <FieldRow label="Name" htmlFor={nameId}>
          <TextField
            id={nameId}
            ariaLabel="Room name"
            value={room.name}
            onCommit={commitName}
            invalidMessage="Type a name for the room."
          />
        </FieldRow>

        <FieldRow label="Area">
          <span className="font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100">
            {`${formatM2(roomAreaM2(room))} m²`}
          </span>
        </FieldRow>

        <EmptyHint>Switch to Plan mode to edit walls and dimensions.</EmptyHint>
      </PanelSection>

      <PanelSection title="Floor color" icon={<PaintBucket size={14} aria-hidden="true" />}>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Floor color">
          {FLOOR_SWATCHES.map((swatch) => {
            const active =
              swatch.color === undefined
                ? fill === undefined
                : fill !== undefined && swatch.color.toLowerCase() === fill.toLowerCase()
            return (
              <FloorSwatch
                key={swatch.id}
                label={swatch.label}
                color={swatch.color}
                active={active}
                onPick={() => setRoomFill(artboard.id, room.id, swatch.color)}
              />
            )
          })}
        </div>
        <p className={MUTED}>{currentLabel}</p>
      </PanelSection>

      <PanelSection title="Furniture" icon={<Armchair size={14} aria-hidden="true" />}>
        {listed.length === 0 ? (
          <EmptyHint>No furniture in this room yet.</EmptyHint>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Furniture in this room">
            {listed.map((item) => {
              const index = artboard.furniture.findIndex((f) => f.id === item.id)
              return (
                <li key={item.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Select ${item.name}`}
                    title={`Select ${item.name}`}
                    onClick={() => selectItem(item)}
                    className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left transition-colors hover:bg-black/5 pointer-coarse:min-h-11 dark:hover:bg-white/10"
                  >
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: item.color }}
                      className={`h-4 w-4 shrink-0 border border-white/25 ${
                        item.shape === 'circle' ? 'rounded-full' : 'rounded-[4px]'
                      }`}
                    />
                    <span className="truncate text-sm font-medium leading-tight text-slate-800 dark:text-slate-100">
                      {item.name}
                    </span>
                  </button>
                  <IconButton
                    label={`Bring ${item.name} forward`}
                    icon={<ChevronUp size={14} aria-hidden="true" />}
                    disabled={index === topIndex}
                    onClick={() => reorderFurniture(artboard.id, item.id, 'forward')}
                  />
                  <IconButton
                    label={`Send ${item.name} backward`}
                    icon={<ChevronDown size={14} aria-hidden="true" />}
                    disabled={index <= 0}
                    onClick={() => reorderFurniture(artboard.id, item.id, 'backward')}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </PanelSection>
    </>
  )
}
