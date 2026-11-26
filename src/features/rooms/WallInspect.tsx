// Right-panel Inspect card for one selected wall (docs/simple-floorplan-2.md §2.6):
// breadcrumb back to the room, the heading "Wall N", the exact length in cm, and a read-only
// summary of the wall geometry with the number of openings hosted on it.
// Wall N goes from vertex N-1 to vertex N of the room polygon. Dark UI, shared panel primitives.
import { useId } from 'react'
import { ChevronLeft, Ruler } from 'lucide-react'
import { projectOnSegment } from '../../model/geometry'
import { useDoc } from '../../model/store'
import type { Artboard, Opening, Room } from '../../model/types'
import {
  EmptyHint,
  FieldRow,
  MUTED,
  NumberField,
  PanelSection,
  StatGrid,
  formatDecimal,
} from '../../shell/panel'
import { selectRoom } from '../artboards/selection'
import { deleteRoomWall, setRoomWallLength } from './actions'
import { roomWalls } from './ops'
import type { Wall } from './ops'

/** An opening is on the wall when its centre is within 1 cm of the wall segment. */
const CENTRE_TOLERANCE_CM = 1

function openingsOnWall(artboard: Artboard, wall: Wall): Opening[] {
  return artboard.openings.filter(
    (o) => projectOnSegment({ x: o.xCm, y: o.yCm }, wall.a, wall.b).distance <= CENTRE_TOLERANCE_CM,
  )
}

/** Endpoint "x · y" in cm, 1 decimal, French comma (matches the other numbers of the panel). */
const fmtPoint = (p: { x: number; y: number }): string =>
  `${formatDecimal(p.x, 1)} · ${formatDecimal(p.y, 1)}`

/** "1 opening on this wall (door)" or "2 openings on this wall (door, window)". */
function openingsHint(openings: Opening[]): string {
  const count = openings.length === 1 ? '1 opening' : `${openings.length} openings`
  const kinds = [...new Set(openings.map((o) => o.kind))].join(', ')
  return `${count} on this wall (${kinds})`
}

export type WallInspectProps = {
  /** Artboard that holds the room. */
  artboardId: string
  /** Room that owns the wall. */
  roomId: string
  /** 0-based wall index of the room polygon (wall `edgeIndex` goes to vertex `edgeIndex + 1`). */
  edgeIndex: number
  className?: string
}

/**
 * Inspect card of one wall. Renders nothing when the artboard, the room or the wall index is
 * unknown, so the shell can mount it unconditionally.
 */
export function WallInspect({ artboardId, roomId, edgeIndex, className }: WallInspectProps) {
  const lengthId = useId()
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
  if (!artboard) return null
  const room: Room | undefined = artboard.rooms.find((r) => r.id === roomId)
  if (!room) return null
  const wall = Number.isInteger(edgeIndex) ? roomWalls(room)[edgeIndex] : undefined
  if (!wall) return null

  const openings = openingsOnWall(artboard, wall)
  const roomLabel = room.name.trim() === '' ? 'Untitled room' : room.name

  return (
    <PanelSection
      title={`Wall ${edgeIndex + 1}`}
      icon={<Ruler size={14} aria-hidden="true" />}
      className={className}
    >
      <button
        type="button"
        aria-label="Back to room"
        title="Back to room"
        onClick={() => selectRoom(artboard.id, room.id)}
        className={`flex min-h-9 w-fit max-w-full items-center gap-1 rounded-md px-1 hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11 ${MUTED}`}
      >
        <ChevronLeft size={12} aria-hidden="true" />
        <span className="truncate">{roomLabel}</span>
      </button>

      <FieldRow label="Length" htmlFor={lengthId} hint="vertex to vertex">
        <NumberField
          id={lengthId}
          ariaLabel="Wall length"
          unit="cm"
          min={1}
          value={wall.lengthCm}
          onCommit={(value) => {
            if (value == null || !(value > 0)) return false
            return setRoomWallLength(artboard.id, room.id, edgeIndex, value) ? undefined : false
          }}
        />
      </FieldRow>

      <div className="flex flex-col gap-1">
        <h3 className={`font-medium ${MUTED}`}>Geometry</h3>
        <StatGrid
          items={[
            { label: 'Start (x · y)', value: fmtPoint(wall.a) },
            { label: 'End (x · y)', value: fmtPoint(wall.b) },
            { label: 'Angle', value: `${formatDecimal(wall.angleDeg, 1)}°` },
            { label: 'Openings', value: String(openings.length) },
          ]}
        />
        {openings.length > 0 && <EmptyHint>{openingsHint(openings)}</EmptyHint>}
      </div>

      <button
        type="button"
        disabled={room.vertices.length <= 3}
        title={room.vertices.length <= 3 ? 'A room needs at least 3 walls' : 'Delete this wall'}
        onClick={() => { if (deleteRoomWall(artboard.id, room.id, edgeIndex)) selectRoom(artboard.id, room.id) }}
        className="min-h-9 rounded-md border border-black/10 px-3 text-red-500 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10 pointer-coarse:min-h-11"
      >
        Delete Wall
      </button>
    </PanelSection>
  )
}
