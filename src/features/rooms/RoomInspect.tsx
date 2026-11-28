// Right-panel Inspect card for the selected room(s) (docs/simple-floorplan-2.md §2.6):
//   - one room: breadcrumb back to the artboard, editable name, area + perimeter, the wall list
//     with one exact-length field per wall, and Delete Room.
//   - two or more rooms: room count, combined area, Merge Rooms and Delete Selected.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm, m, m².
import { useId } from 'react'
import { Layers, Merge, Square } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { Artboard, Room } from '../../model/types'
import {
  BTN,
  BackLink,
  LABEL,
  DangerButton,
  EmptyHint,
  FieldRow,
  MUTED,
  NumberField,
  PanelSection,
  ROW,
  ROW_OFF,
  ROW_ON,
  StatGrid,
  TextField,
  formatDecimal,
  formatM2,
} from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { roomAreaM2 } from '../artboards/frame'
import { selectArtboard, selectRoom } from '../artboards/selection'
import { toast } from '../toast'
import { syncOpeningsForRoomChange } from '../openings/sync'
import { NumInput } from './NumInput'
import { deleteRooms, mergeArtboardRooms, renameRoom, setRoomWallLength } from './actions'
import { mergeRooms, roomWalls } from './ops'
import { wallThicknessOf, isFenceWall } from './walls'

export type RoomInspectProps = {
  /** Artboard that holds the selected rooms. */
  artboardId: string
  /** One room = Room card. Two or more = multi-selection card. Unknown ids are ignored. */
  roomIds: string[]
  className?: string
}

/** Select one wall of a room: the Inspect panel then shows the Wall card. */
function selectWall(artboardId: string, roomId: string, edgeIndex: number): void {
  useUi.getState().set({
    activeArtboardId: artboardId,
    selection: { kind: 'wall', artboardId, roomId, edgeIndex },
  })
}

/** Move a room by (dx, dy) cm. Openings on its walls follow (one undo step). */
function translateRoom(artboardId: string, roomId: string, dx: number, dy: number): void {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return
  useDoc.getState().update((d) => {
    const a = d.artboards.find((x) => x.id === artboardId)
    if (!a || !a.rooms.some((r) => r.id === roomId)) return
    const prev = a.rooms
    a.rooms = a.rooms.map((r) => (r.id === roomId ? { ...r, vertices: r.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) } : r))
    a.openings = syncOpeningsForRoomChange(a.openings, prev, a.rooms)
  })
}

/** Clear the selection after a delete, so the Inspect panel falls back to the artboard. */
function clearSelection(): void {
  useUi.getState().set({ selection: { kind: 'none' } })
}

/** Back link to the artboard card. */
function BackToArtboard({ artboard }: { artboard: Artboard }) {
  return (
    <BackLink
      name={artboard.name.trim() === '' ? 'Untitled artboard' : artboard.name}
      onClick={() => selectArtboard(artboard.id)}
    />
  )
}

/** Toast with an Undo button after a delete. */
function deletedToast(message: string): void {
  toast(message, { kind: 'info', actionLabel: 'Undo', onAction: () => useDoc.getState().undo() })
}

/** Subtle tag that marks a wall row as a fence (low railing) instead of a normal wall. */
function FenceBadge() {
  return (
    <span
      data-testid="wall-fence-badge"
      className="shrink-0 rounded-full border border-slate-400/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:border-slate-500/50 dark:text-slate-300"
    >
      Fence
    </span>
  )
}

/** One room selected: name, area, perimeter, walls with an exact length field, Delete Room. */
function SingleRoomCard({ artboard, room, className }: { artboard: Artboard; room: Room; className?: string }) {
  const nameId = useId()
  const selection = useUi((s) => s.selection)
  const walls = roomWalls(room)
  const minX = Math.min(...room.vertices.map((v) => v.x))
  const minY = Math.min(...room.vertices.map((v) => v.y))
  const perimeterM = walls.reduce((sum, w) => sum + w.lengthCm, 0) / 100
  const activeWall =
    selection.kind === 'wall' && selection.artboardId === artboard.id && selection.roomId === room.id
      ? selection.edgeIndex
      : -1

  const commitName = (value: string): boolean | void => {
    const name = value.trim()
    if (name === '') return false
    if (name === room.name) return
    renameRoom(artboard.id, room.id, name)
  }

  const remove = () => {
    deleteRooms(artboard.id, [room.id])
    clearSelection()
    deletedToast(`Deleted ${room.name.trim() === '' ? 'room' : room.name}`)
  }

  return (
    <PanelSection
      title="Room"
      icon={<Square size={14} aria-hidden="true" />}
      className={className}
    >
      <BackToArtboard artboard={artboard} />

      <FieldRow label="Name" htmlFor={nameId}>
        <TextField
          id={nameId}
          ariaLabel="Room name"
          value={room.name}
          onCommit={commitName}
          invalidMessage="Type a name for the room."
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Room position">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>X (cm)</span>
          <NumInput
            testId="room-x-input" ariaLabel="Room X (cm)" value={minX}
            onCommit={(v) => { translateRoom(artboard.id, room.id, v - minX, 0) }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Y (cm)</span>
          <NumInput
            testId="room-y-input" ariaLabel="Room Y (cm)" value={minY}
            onCommit={(v) => { translateRoom(artboard.id, room.id, 0, v - minY) }}
          />
        </label>
      </div>

      <StatGrid
        items={[
          { label: 'Area', value: `${formatM2(roomAreaM2(room))} m²` },
          { label: 'Perimeter', value: `${formatDecimal(perimeterM, 2)} m` },
        ]}
      />

      <div className="flex flex-col gap-1">
        <h3 className={`font-medium ${MUTED}`}>Walls</h3>
        {walls.length === 0 ? (
          <EmptyHint>This room has no wall yet.</EmptyHint>
        ) : (
          <>
            <ul className="flex flex-col gap-0.5" aria-label="Walls of the room">
              {walls.map((wall) => {
                const on = wall.index === activeWall
                return (
                  <li key={wall.index} className={`flex items-center gap-2 rounded-md border px-1 py-0.5 ${on ? ROW_ON : ROW_OFF}`}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`Select wall ${wall.index + 1}`}
                      onClick={() => selectWall(artboard.id, room.id, wall.index)}
                      className="flex min-h-9 w-14 shrink-0 items-center rounded-md px-1 text-left text-sm text-slate-800 hover:bg-black/5 dark:text-slate-100 dark:hover:bg-white/10 pointer-coarse:min-h-11"
                    >
                      Wall {wall.index + 1}
                    </button>
                    {isFenceWall(room, wall.index) && <FenceBadge />}
                    <NumberField
                      ariaLabel={`Length of wall ${wall.index + 1}`}
                      unit="cm"
                      min={1}
                      value={wall.lengthCm}
                      className="min-w-0 flex-1"
                      onCommit={(value) => {
                        if (value == null || !(value > 0)) return false
                        return setRoomWallLength(artboard.id, room.id, wall.index, value) ? undefined : false
                      }}
                    />
                  </li>
                )
              })}
            </ul>
            <EmptyHint>
              Wall N runs from corner N to corner N + 1. A new length moves the end corner (corner N + 1); in a plain
              rectangle the opposite wall moves too.
            </EmptyHint>
          </>
        )}
      </div>

      <DangerButton onClick={remove} shortcut="Del">
        Delete Room
      </DangerButton>
    </PanelSection>
  )
}

/** Two or more rooms selected: count, combined area, Merge Rooms, Delete Selected. */
function MultiRoomCard({
  artboard,
  rooms,
  className,
}: {
  artboard: Artboard
  rooms: Room[]
  className?: string
}) {
  const totalM2 = rooms.reduce((sum, r) => sum + roomAreaM2(r), 0)
  const ids = rooms.map((r) => r.id)

  // Rooms can be merged only when their union is one outline (they touch or overlap).
  const canMerge = mergeRooms(rooms, wallThicknessOf(artboard)) !== null
  const mergeHint = 'Rooms must touch, overlap or share a wall to be merged. Move them next to each other first.'

  const merge = () => {
    const merged = mergeArtboardRooms(artboard.id, ids)
    if (!merged) {
      toast('Rooms do not touch, so they cannot be merged.', { kind: 'error' })
      return
    }
    selectRoom(artboard.id, merged.id)
  }

  const removeSelected = () => {
    deleteRooms(artboard.id, ids)
    clearSelection()
    deletedToast(`Deleted ${ids.length} rooms`)
  }

  return (
    <PanelSection
      title="Rooms"
      icon={<Layers size={14} aria-hidden="true" />}
      className={className}
    >
      <BackToArtboard artboard={artboard} />

      <StatGrid
        items={[
          { label: rooms.length === 1 ? 'Room' : 'Rooms', value: String(rooms.length) },
          { label: 'Combined area', value: `${formatM2(totalM2)} m²` },
        ]}
      />

      <ul className="flex flex-col gap-1" aria-label="Selected rooms">
        {rooms.map((room) => (
          <li key={room.id}>
            <button
              type="button"
              title="Select only this room"
              onClick={() => selectRoom(artboard.id, room.id)}
              className={`${ROW} ${ROW_OFF} flex min-h-9 w-full items-center justify-between gap-2 text-left hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11`}
            >
              <span className="truncate text-sm text-slate-800 dark:text-slate-100">
                {room.name.trim() === '' ? 'Untitled room' : room.name}
              </span>
              <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`}>
                {formatM2(roomAreaM2(room))} m²
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={BTN}
        onClick={merge}
        disabled={!canMerge}
        title={canMerge ? 'Merge the selected rooms into one' : mergeHint}
      >
        <Merge size={14} aria-hidden="true" />
        Merge Rooms
      </button>
      {!canMerge && <EmptyHint>{mergeHint}</EmptyHint>}

      <DangerButton onClick={removeSelected} shortcut="Del">
        Delete Selected
      </DangerButton>
    </PanelSection>
  )
}

/**
 * Inspect card of the room selection. Renders nothing when the artboard or every room id is
 * unknown, so the shell can mount it unconditionally.
 */
export function RoomInspect({ artboardId, roomIds, className }: RoomInspectProps) {
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
  if (!artboard) return null

  const wanted = new Set(roomIds)
  const rooms = artboard.rooms.filter((room) => wanted.has(room.id))
  if (rooms.length === 0) return null
  if (rooms.length === 1) return <SingleRoomCard artboard={artboard} room={rooms[0]} className={className} />
  return <MultiRoomCard artboard={artboard} rooms={rooms} className={className} />
}
