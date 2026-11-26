// Right-panel Inspect card for one room in Design mode (docs/simple-floorplan-2.md §6, Phase 4):
// the name, the measured area and the floor colour of the room. The geometry of the room is
// read-only here: walls and dimensions belong to Plan mode.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm, m².
import { useId } from 'react'
import { PaintBucket, Square } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { Room } from '../../model/types'
import { EmptyHint, FieldRow, MUTED, PanelSection, TextField, formatM2 } from '../../shell/panel'
import { roomAreaM2 } from '../artboards/frame'
import { setRoomFill } from './actions'
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
    </>
  )
}
