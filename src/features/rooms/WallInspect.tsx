// Right-panel Inspect card for one selected wall (docs/simple-floorplan-2.md §2.6):
// back link to the room, "‹ Wall X of N ›" to cycle the walls, the exact length in cm, the openings
// hosted on the wall (click one to select it), Delete Wall, and a collapsed Geometry section.
// Wall N goes from vertex N-1 to vertex N of the room polygon. Dark UI, shared panel primitives.
import { useId, useState } from 'react'
import { ChevronLeft, ChevronRight, Compass, Ruler } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { Artboard, Opening, OpeningKind, Room } from '../../model/types'
import {
  BackLink,
  DangerButton,
  EmptyHint,
  FieldRow,
  BTN,
  IconButton,
  INPUT,
  LABEL,
  MUTED,
  NumberField,
  PanelSection,
  ROW,
  ROW_OFF,
  StatGrid,
  formatDecimal,
} from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { selectRoom } from '../artboards/selection'
import { addOpening } from '../openings/actions'
import { DEFAULT_OPENING_WIDTH_CM, MIN_OPENING_WIDTH_CM, MAX_OPENING_WIDTH_CM } from '../openings/geometry'
import { hostWallIn } from '../openings/sync'
import { newId } from '../../model/schema'
import { toast } from '../toast'
import { deleteRoomWall, setRoomWallLength } from './actions'
import { NumInput } from './NumInput'
import { roomWalls } from './ops'
import type { Wall } from './ops'

/**
 * Openings hosted by `wall`. The host is the same one the canvas uses (`hostWallIn`), so when two
 * rooms are flush a door that belongs to the other room is not listed on this wall too.
 */
function openingsOnWall(artboard: Artboard, room: Room, wall: Wall): Opening[] {
  return artboard.openings.filter((o) => {
    const host = hostWallIn(artboard.rooms, o)
    return !!host && host.room.id === room.id && host.edgeIndex === wall.index
  })
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

const OPENING_LABEL = { door: 'Door', window: 'Window', opening: 'Opening' } as const

/** Select another wall of the same room. */
function selectWall(artboardId: string, roomId: string, edgeIndex: number): void {
  useUi.getState().set({ activeArtboardId: artboardId, selection: { kind: 'wall', artboardId, roomId, edgeIndex } })
}

/** Select one opening of the artboard. */
function selectOpening(artboardId: string, openingId: string): void {
  useUi.getState().set({ activeArtboardId: artboardId, selection: { kind: 'opening', artboardId, openingId } })
}

/** Form: add a door / window / opening on this wall at a typed width and offset from the wall start. */
function AddOpeningForm({ artboardId, room, wall }: { artboardId: string; room: Room; wall: Wall }) {
  const [kind, setKind] = useState<OpeningKind>('door')
  const [width, setWidth] = useState<number | null>(null)
  const [offset, setOffset] = useState<number | null>(null)
  const w = width ?? DEFAULT_OPENING_WIDTH_CM[kind]
  const off = offset ?? wall.lengthCm / 2
  const kindId = useId()

  const submit = () => {
    const widthCm = Math.min(w, Math.max(MIN_OPENING_WIDTH_CM, wall.lengthCm))
    const t = Math.min(wall.lengthCm, Math.max(0, off)) / (wall.lengthCm || 1)
    const op: Opening = {
      id: newId(),
      kind,
      roomId: room.id,
      xCm: wall.a.x + (wall.b.x - wall.a.x) * t,
      yCm: wall.a.y + (wall.b.y - wall.a.y) * t,
      angleDeg: wall.angleDeg,
      widthCm,
    }
    if (kind === 'door') { op.hinge = 'left'; op.swing = 'in' }
    addOpening(artboardId, op)
    selectOpening(artboardId, op.id)
  }

  return (
    <form
      data-testid="wall-add-opening-form"
      className="flex flex-col gap-2"
      aria-label="Add opening on wall"
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <h3 className={`font-medium ${MUTED}`}>Add opening on wall</h3>
      <label className="flex flex-col gap-1" htmlFor={kindId}>
        <span className={LABEL}>Kind</span>
        <select
          id={kindId}
          data-testid="wall-add-opening-kind"
          className={INPUT}
          value={kind}
          onChange={(e) => { setKind(e.target.value as OpeningKind); setWidth(null) }}
        >
          <option value="door">Door</option>
          <option value="window">Window</option>
          <option value="opening">Opening</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Width (cm)</span>
          <NumInput
            testId="wall-add-opening-width" ariaLabel="Opening width (cm)" value={w}
            min={MIN_OPENING_WIDTH_CM}
            onCommit={(v) => { if (v > MAX_OPENING_WIDTH_CM) return false; setWidth(v) }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Offset (cm)</span>
          <NumInput
            testId="wall-add-opening-offset" ariaLabel="Offset from wall start (cm)" value={off}
            min={0}
            onCommit={(v) => { if (v > wall.lengthCm) return false; setOffset(v) }}
          />
        </label>
      </div>
      <button type="submit" data-testid="wall-add-opening-submit" className={BTN}>Add</button>
    </form>
  )
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

  const openings = openingsOnWall(artboard, room, wall)
  const roomLabel = room.name.trim() === '' ? 'Untitled room' : room.name
  const count = room.vertices.length
  const prev = (edgeIndex - 1 + count) % count
  const next = (edgeIndex + 1) % count

  const remove = () => {
    if (!deleteRoomWall(artboard.id, room.id, edgeIndex)) return
    selectRoom(artboard.id, room.id)
    toast(`Deleted wall ${edgeIndex + 1}`, {
      kind: 'info',
      actionLabel: 'Undo',
      onAction: () => useDoc.getState().undo(),
    })
  }

  return (
    <>
      <PanelSection title={`Wall ${edgeIndex + 1}`} icon={<Ruler size={14} aria-hidden="true" />} className={className}>
        <BackLink label="Room" name={roomLabel} onClick={() => selectRoom(artboard.id, room.id)} />

        <div className="flex items-center justify-between gap-1" role="group" aria-label="Walls of the room">
          <IconButton
            label="Previous wall"
            icon={<ChevronLeft size={16} aria-hidden="true" />}
            onClick={() => selectWall(artboard.id, room.id, prev)}
          />
          <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{`Wall ${edgeIndex + 1} of ${count}`}</span>
          <IconButton
            label="Next wall"
            icon={<ChevronRight size={16} aria-hidden="true" />}
            onClick={() => selectWall(artboard.id, room.id, next)}
          />
        </div>

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
          <h3 className={`font-medium ${MUTED}`}>Openings</h3>
          {openings.length === 0 ? (
            <EmptyHint>No door or window on this wall.</EmptyHint>
          ) : (
            <>
              <ul className="flex flex-col gap-1" aria-label="Openings on this wall">
                {openings.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      title={`Select this ${o.kind}`}
                      onClick={() => selectOpening(artboard.id, o.id)}
                      className={`${ROW} ${ROW_OFF} flex min-h-9 w-full items-center justify-between gap-2 text-left hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11`}
                    >
                      <span className="truncate text-sm text-slate-800 dark:text-slate-100">{OPENING_LABEL[o.kind]}</span>
                      <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`}>{formatDecimal(o.widthCm, 0)} cm</span>
                    </button>
                  </li>
                ))}
              </ul>
              <EmptyHint>{openingsHint(openings)}</EmptyHint>
            </>
          )}
        </div>

        <AddOpeningForm key={`${room.id}:${edgeIndex}`} artboardId={artboard.id} room={room} wall={wall} />

        <DangerButton onClick={remove} disabled={room.vertices.length <= 3} shortcut="Del">
          Delete Wall
        </DangerButton>
        {room.vertices.length <= 3 && <EmptyHint>A room needs at least 3 walls.</EmptyHint>}
      </PanelSection>

      <PanelSection title="Geometry" icon={<Compass size={14} aria-hidden="true" />} collapsible defaultOpen={false}>
        <StatGrid
          items={[
            { label: 'Start (x · y)', value: fmtPoint(wall.a) },
            { label: 'End (x · y)', value: fmtPoint(wall.b) },
            { label: 'Angle', value: `${formatDecimal(wall.angleDeg, 1)}°` },
            { label: 'Openings', value: String(openings.length) },
          ]}
        />
      </PanelSection>
    </>
  )
}
