// Right-panel Inspect card for SEVERAL rooms in Design mode: one floor card (colour, pattern and
// pattern angle) that writes to every selected room at once, so a multi-selection is styled in one
// click and one undo step. No name, no walls and no furniture list: those are per-room things.
// Styling, class names and the swatch button come from DesignRoomInspect.tsx (single room card).
// Units: cm, m².
import { PaintBucket, Square } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { Room } from '../../model/types'
import { FieldRow, MUTED, NumberField, PanelSection, formatM2 } from '../../shell/panel'
import { isPatterned } from '../rooms/floorPatterns'
import { roomAreaM2 } from '../artboards/frame'
import { setRoomsFill, setRoomsFloorPattern, setRoomsFloorPatternAngle } from './actions'
import { FloorSwatch } from './DesignRoomInspect'
import { FLOOR_PATTERNS, FLOOR_SWATCHES } from './presets'

export type DesignRoomsInspectProps = {
  /** Artboard that holds the rooms. */
  artboardId: string
  /** Selected rooms. Unknown ids are ignored; when none matches the card renders nothing. */
  roomIds: string[]
}

/** Lower-cased fill key, so '#FFF' and '#fff' are the same colour ('' stands for "no fill"). */
const fillKey = (fill: string | undefined): string => (fill === undefined ? '' : fill.toLowerCase())

/**
 * Inspect card of several rooms in Design mode: one floor card for all of them. A control is active
 * only when every room agrees on that value; otherwise the card shows "Mixed" and the next click
 * sets all of them. Renders nothing when the artboard or every room id is unknown.
 */
export function DesignRoomsInspect({ artboardId, roomIds }: DesignRoomsInspectProps) {
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
  const rooms: Room[] = artboard ? artboard.rooms.filter((r) => roomIds.includes(r.id)) : []
  if (!artboard || rooms.length === 0) return null

  const first = rooms[0]
  const totalAreaM2 = rooms.reduce((sum, r) => sum + roomAreaM2(r), 0)

  // Floor colour: a swatch is active only when all the rooms share that fill.
  const fill = first.fill
  const fillsMixed = rooms.some((r) => fillKey(r.fill) !== fillKey(fill))
  const currentLabel = fillsMixed
    ? 'Mixed'
    : fill === undefined
      ? 'Default (no fill)'
      : (FLOOR_SWATCHES.find((s) => s.color?.toLowerCase() === fill.toLowerCase())?.label ?? 'Custom color')

  // Floor pattern: 'solid' is the stored "no pattern" value.
  const pattern = first.floorPattern ?? 'solid'
  const patternsMixed = rooms.some((r) => (r.floorPattern ?? 'solid') !== pattern)

  // Pattern angle: shown when at least one room has a pattern, with the common angle (or none).
  const anyPatterned = rooms.some((r) => isPatterned(r.floorPattern))
  const angle = first.floorPatternAngleDeg ?? 0
  const anglesMixed = rooms.some((r) => (r.floorPatternAngleDeg ?? 0) !== angle)

  return (
    <>
      <PanelSection title="Rooms" icon={<Square size={14} aria-hidden="true" />}>
        <p className="text-sm font-semibold text-slate-100">{`${rooms.length} rooms selected`}</p>
        <FieldRow label="Total area">
          <span className="font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100">
            {`${formatM2(totalAreaM2)} m²`}
          </span>
        </FieldRow>
      </PanelSection>

      <PanelSection title="Floor color" icon={<PaintBucket size={14} aria-hidden="true" />}>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Floor color">
          {FLOOR_SWATCHES.map((swatch) => {
            const active =
              !fillsMixed &&
              (swatch.color === undefined
                ? fill === undefined
                : fill !== undefined && swatch.color.toLowerCase() === fill.toLowerCase())
            return (
              <FloorSwatch
                key={swatch.id}
                label={swatch.label}
                color={swatch.color}
                active={active}
                onPick={() => setRoomsFill(artboard.id, rooms.map((r) => r.id), swatch.color)}
              />
            )
          })}
        </div>
        <p className={MUTED}>{currentLabel}</p>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Floor pattern">
          {FLOOR_PATTERNS.map((p) => {
            const active = !patternsMixed && pattern === p.id
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => setRoomsFloorPattern(artboard.id, rooms.map((r) => r.id), p.id)}
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
        {anyPatterned && (
          <>
            <FieldRow label="Pattern angle" hint="degrees">
              <NumberField
                ariaLabel="Floor pattern angle"
                unit="°"
                min={0}
                max={359}
                value={anglesMixed ? null : angle}
                placeholder={anglesMixed ? 'Mixed' : undefined}
                onCommit={(v) => setRoomsFloorPatternAngle(artboard.id, rooms.map((r) => r.id), v ?? 0)}
              />
            </FieldRow>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label="Quick pattern angle">
              {[0, 45, 90, 135].map((a) => {
                const active = !anglesMixed && angle === a
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRoomsFloorPatternAngle(artboard.id, rooms.map((r) => r.id), a)}
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
    </>
  )
}
