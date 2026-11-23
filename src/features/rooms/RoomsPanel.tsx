// Sidebar panel: properties of the selected room / wall / vertex, plus the walls and the
// elements of the room (docs/sidebar-plan.md phase 2, primitives in src/shell/panel).
// All lengths are cm. One undo step per edit, comma decimals.
import { useEffect, useMemo, useState } from 'react'
import { Check, DoorOpen, Lock, Ruler, Square, Trash2 } from 'lucide-react'
import { fmtCm, roomAreaM2, roomWalls } from '../../model/geometry'
import { selectedItems, type SelItem } from '../../model/selection'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, Selection, WallProps, WallStatus, WallType } from '../../model/types'
import { effectiveCeilingCm } from '../export/calc'
import {
  BTN,
  CheckboxRow,
  EmptyHint,
  FieldRow,
  IconButton,
  MUTED,
  NumberField,
  PanelSection,
  Segmented,
  StatGrid,
  SwitchRow,
  TextField,
  formatM2,
} from '../../shell/panel'
import { undoToast } from '../toast'
import { applyMeasured, applyMeasuredAll, describeReport, setVerifiedLocked, verifiedAllLocked, verifiedWalls } from './apply'
import { useActiveHole } from './holes'
import { deleteRoom, perimeter, setRoomCode } from './ops'
import { elementRows, wallElementRows, wallRows, WALL_TYPE_CHIP, type ElementRow } from './roomLists'
import { DEFAULT_THICKNESS, wallProps } from './walls'

const update = (fn: (d: PlanDoc) => PlanDoc) => useDoc.getState().update(fn)
const patchRoom = (id: string, patch: Partial<Room>) =>
  update((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))

const WALL_TYPES = [
  { value: 'bearing', label: 'Bearing' },
  { value: 'partition', label: 'Partition' },
  { value: 'exterior', label: 'Exterior' },
] as const

/** Renovation state of the selected wall (7.4). */
const WALL_STATUSES = [
  { value: 'existing', label: 'Existing' },
  { value: 'demolish', label: 'Demolish' },
  { value: 'new', label: 'New' },
] as const

/** Structural warning message: same text as the set_wall_props command warning. */
const structuralWarning = (type: WallType) => `STRUCTURAL: ${type} wall marked for demolition`

/** A wall, addressed by its room and start vertex. */
type WallRef = { roomId: string; wallStart: string }

/** Patch the props of one or more walls in one undo step. `patch` may depend on the current props. */
function patchWalls(refs: WallRef[], patch: (cur: WallProps) => Partial<WallProps>) {
  update((d) => ({
    ...d,
    rooms: d.rooms.map((r) => {
      const mine = refs.filter((w) => w.roomId === r.id)
      if (!mine.length) return r
      const walls = { ...r.walls }
      for (const w of mine) { const cur = wallProps(r, w.wallStart); walls[w.wallStart] = { ...cur, ...patch(cur) } }
      return { ...r, walls }
    }),
  }))
}

/** Change the type; each wall follows the new type's default thickness unless it was customised. */
function setWallTypes(refs: WallRef[], type: WallType) {
  patchWalls(refs, (cur) => ({ type, thicknessCm: cur.thicknessCm === DEFAULT_THICKNESS[cur.type] ? DEFAULT_THICKNESS[type] : cur.thicknessCm }))
}

/** Selected walls when two or more are selected, else null. */
function wallGroup(items: SelItem[]): WallRef[] | null {
  const walls = items.flatMap((s) => (s.kind === 'wall' ? [{ roomId: s.roomId, wallStart: s.wallStart }] : []))
  return walls.length > 1 ? walls : null
}

function setWallLength(roomId: string, startId: string, length: number) {
  update((d) => ({
    ...d,
    rooms: d.rooms.map((r) => {
      if (r.id !== roomId) return r
      const w = roomWalls(r).find((x) => x.start.id === startId)
      if (!w) return r
      const end = { x: w.start.x + w.dir.x * length, y: w.start.y + w.dir.y * length }
      return { ...r, vertices: r.vertices.map((v) => (v.id === w.end.id ? { ...v, ...end } : v)) }
    }),
  }))
}

/** One clickable row of an element list: kind + variant, then wall label (room list) or
 *  offset from the wall start (wall list), then width. */
function ElementList({ rows, onSelect, show = 'wall' }: { rows: ElementRow[]; onSelect: (id: string) => void; show?: 'wall' | 'offset' }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onSelect(row.id)}
            aria-label={`Select element ${row.kindLabel} ${row.wallLabel ?? ''}`.trim()}
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11"
          >
            <span className="min-w-0 flex-1 truncate">
              {row.kindLabel}
              {row.variantLabel && <span className={MUTED}> · {row.variantLabel}</span>}
            </span>
            {show === 'wall' ? (
              <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`}>{row.wallLabel ?? '—'}</span>
            ) : (
              <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`} title="Offset from the wall start">
                @{fmtCm(row.offsetCm)} cm
              </span>
            )}
            <span className="shrink-0 font-mono text-xs tabular-nums">{fmtCm(row.widthCm)}</span>
            <span className={`shrink-0 text-[11px] ${MUTED}`}>cm</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Selected hole (own store, see ./holes.ts). Passed down so the view stays pure. */
export type ActiveHole = { roomId: string; holeIndex: number } | null

/** Sidebar panel: properties of the selected room / wall / vertex. */
export function RoomsPanel() {
  const doc = useDoc((s) => s.doc)
  const selection = useUi((s) => s.selection)
  const multi = useUi((s) => s.multi)
  const items = useMemo(() => selectedItems({ selection, multi }), [selection, multi])
  const activeHole = useActiveHole()

  // 'b' toggles the selected wall(s) between bearing and partition (the primary wall decides).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      const ui = useUi.getState()
      if (ui.mode !== 'edit' || ui.selection?.kind !== 'wall') return
      const sel = ui.selection
      const r = useDoc.getState().doc.rooms.find((x) => x.id === sel.roomId)
      if (!r) return
      const refs = wallGroup(selectedItems(ui)) ?? [{ roomId: sel.roomId, wallStart: sel.wallStart }]
      setWallTypes(refs, wallProps(r, sel.wallStart).type === 'bearing' ? 'partition' : 'bearing')
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  return <RoomsPanelView doc={doc} selection={selection} items={items} activeHole={activeHole} />
}

/** Same panel from plain data, so it can be rendered without the stores (tests, SSR). */
export function RoomsPanelView({ doc, selection, items = selection ? [selection] : [], activeHole }: {
  doc: PlanDoc; selection: Selection; items?: SelItem[]; activeHole: ActiveHole
}) {
  const roomId = selection && selection.kind !== 'element' ? selection.roomId : null
  const room = doc.rooms.find((r) => r.id === roomId)
  const apartmentCeilingCm = doc.apartment?.defaultCeilingCm ?? null
  // The apply note belongs to the room it was run for, so it vanishes on a room change
  // without an effect (derive during render instead of resetting in an effect).
  const [note, setNote] = useState<{ roomId: string; text: string } | null>(null)

  if (!room || !selection || selection.kind === 'element') return null
  const walls = roomWalls(room)
  const wall = selection.kind === 'wall' ? walls.find((w) => w.start.id === selection.wallStart) : undefined
  const props = wall ? wallProps(room, wall.start.id) : undefined
  const outlineVertex = selection.kind === 'vertex' ? room.vertices.find((v) => v.id === selection.vertexId) : undefined
  const holeVertex = selection.kind === 'vertex' && !outlineVertex ? room.holes.flat().find((v) => v.id === selection.vertexId) : undefined
  const vertex = outlineVertex ?? holeVertex
  const holeRing = holeVertex ? room.holes.find((h) => h.some((v) => v.id === holeVertex.id)) : undefined
  const verified = verifiedWalls({ measurements: doc.measurements }, room)
  const allLocked = verifiedAllLocked({ measurements: doc.measurements }, room)
  // Same rule as hasOwnCeiling(): a room height of 0 does not count as its own.
  const ownCeiling = room.ceilingCm !== undefined && room.ceilingCm > 0
  const ceiling = effectiveCeilingCm(doc, room)
  const areaM2 = roomAreaM2(room)
  const select = useUi.getState().select
  // Shift + click group: the wall controls change every selected wall (values shown are the primary wall's).
  const group = wallGroup(items)
  const targets: WallRef[] = group ?? (wall ? [{ roomId: room.id, wallStart: wall.start.id }] : [])
  const wallLabel = (w: WallRef) => {
    const r = doc.rooms.find((x) => x.id === w.roomId)
    const i = r ? r.vertices.findIndex((v) => v.id === w.wallStart) : -1
    return r && i >= 0 ? `${r.code}-${i + 1}` : '?'
  }
  const groupKind = items.length > 1 ? items[0].kind : null

  const runApply = (all: boolean) => {
    const current = useDoc.getState().doc
    const r = all ? applyMeasuredAll(current) : (() => { const x = applyMeasured(current, room.id); return { doc: x.doc, reports: [x.report] } })()
    if (r.doc !== current) update(() => r.doc)
    const done = r.reports.filter((x) => x.mode !== 'none')
    setNote({ roomId: room.id, text: all
      ? done.length ? `Applied to ${done.length} room${done.length === 1 ? '' : 's'}. ${done.map(describeReport).join(' ')}` : 'No room has verified wall lengths.'
      : describeReport(r.reports[0]) })
  }

  return (
    <>
      {(groupKind === 'room' || groupKind === 'vertex') && (
        <PanelSection title={`${items.length} ${groupKind === 'room' ? 'rooms' : 'points'} selected`}>
          <EmptyHint>Drag one of them to move all. Delete removes all. Shift + click adds or removes one.</EmptyHint>
        </PanelSection>
      )}
      {wall && props && (
        <PanelSection title={group ? `${group.length} walls` : `Wall ${room.code}-${wall.index + 1}`}>
          {group && <EmptyHint>{group.map(wallLabel).join(', ')}. Changes apply to all of them.</EmptyHint>}
          <FieldRow label="Type">
            <Segmented ariaLabel="Wall type" options={WALL_TYPES} value={props.type} onChange={(t) => setWallTypes(targets, t as WallType)} />
          </FieldRow>
          <FieldRow label="Renovation">
            <Segmented
              ariaLabel="Wall status"
              options={WALL_STATUSES}
              value={props.status ?? 'existing'}
              onChange={(st) => patchWalls(targets, () => ({ status: st as WallStatus }))}
            />
          </FieldRow>
          {props.status === 'demolish' && (props.type === 'bearing' || props.type === 'exterior') && (
            <p role="alert" className="rounded border border-red-600/50 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-700 dark:border-red-400/50 dark:bg-red-500/15 dark:text-red-300">
              {structuralWarning(props.type)}
            </p>
          )}
          <FieldRow label="Thickness" htmlFor="wall-thickness">
            <NumberField
              id="wall-thickness"
              name="thickness"
              unit="cm"
              value={props.thicknessCm}
              min={1}
              max={200}
              onCommit={(v) => {
                if (v === null || v < 1 || v > 200) return false
                patchWalls(targets, () => ({ thicknessCm: v }))
              }}
            />
          </FieldRow>
          {!group && <FieldRow label="Length" htmlFor="wall-length">
            <NumberField
              id="wall-length"
              name="length"
              unit="cm"
              value={wall.length}
              min={1}
              disabled={!!props.locked}
              onCommit={(v) => {
                if (v === null || v < 1) return false
                setWallLength(room.id, wall.start.id, v)
              }}
            />
          </FieldRow>}
          <SwitchRow
            name="wallLocked"
            label="Locked (cannot be resized)"
            checked={!!props.locked}
            onChange={(checked) => patchWalls(targets, () => ({ locked: checked }))}
          />
          <EmptyHint>Key B: bearing / partition. Length moves the end vertex.</EmptyHint>
        </PanelSection>
      )}

      {wall && (
        <PanelSection id="wall-elements" title="On this wall" collapsible>
          {(() => {
            const rows = wallElementRows(doc, room, wall.start.id)
            return rows.length
              ? <ElementList rows={rows} show="offset" onSelect={(id) => select({ kind: 'element', elementId: id })} />
              : <EmptyHint>No door, window or fixture on this wall.</EmptyHint>
          })()}
        </PanelSection>
      )}

      {vertex && (
        <PanelSection title={holeVertex ? 'Hole vertex' : 'Vertex'}>
          <p className={MUTED}>
            {holeVertex ? 'Hole vertex' : 'Vertex'} at {fmtCm(vertex.x)} / {fmtCm(vertex.y)} cm. Press Delete to remove it
            {holeVertex ? ((holeRing?.length ?? 0) <= 3 ? ' (a hole needs 3 vertices)' : '') : (room.vertices.length <= 3 ? ' (a room needs 3 vertices)' : '')}.
          </p>
        </PanelSection>
      )}

      {activeHole && (
        <PanelSection title="Hole">
          <p className={MUTED}>Hole selected. Drag its handles to reshape it. Press Delete to remove the whole hole.</p>
        </PanelSection>
      )}

      <PanelSection
        title="Room"
        icon={<Square size={16} />}
        actions={
          <IconButton
            label={`Delete room ${room.name}`}
            icon={<Trash2 size={16} />}
            variant="danger"
            onClick={() => {
              update((d) => deleteRoom(d, room.id))
              useUi.getState().select(null)
              undoToast('Room deleted', () => useDoc.temporal.getState().undo())
            }}
          />
        }
      >
        <FieldRow label="Name" htmlFor="room-name">
          <TextField
            id="room-name"
            name="name"
            value={room.name}
            onCommit={(v) => {
              if (!v.trim()) return false
              patchRoom(room.id, { name: v.trim() })
            }}
          />
        </FieldRow>
        <FieldRow label="Code" htmlFor="room-code" hint="unique">
          <TextField
            id="room-code"
            name="code-unique-"
            value={room.code}
            invalidMessage="Code already used"
            onCommit={(v) => {
              const c = v.trim()
              if (!c || doc.rooms.some((r) => r.id !== room.id && r.code === c)) return false
              update((d) => setRoomCode(d, room.id, c))
            }}
          />
        </FieldRow>
        <FieldRow label="Walk order" htmlFor="room-walk-order">
          <NumberField
            id="room-walk-order"
            name="walk-order"
            value={room.walkOrder}
            onCommit={(v) => {
              if (v === null) return false
              patchRoom(room.id, { walkOrder: v })
            }}
          />
        </FieldRow>
        <FieldRow
          label="Ceiling"
          htmlFor="room-ceiling"
          hint={!ownCeiling && apartmentCeilingCm !== null && apartmentCeilingCm > 0 ? `Apartment default: ${fmtCm(apartmentCeilingCm)} cm` : undefined}
        >
          <NumberField
            id="room-ceiling"
            name="ceiling-height"
            unit="cm"
            value={room.ceilingCm ?? null}
            placeholder={!ownCeiling && apartmentCeilingCm !== null && apartmentCeilingCm > 0 ? fmtCm(apartmentCeilingCm) : undefined}
            onCommit={(v) => {
              if (v === null) { patchRoom(room.id, { ceilingCm: undefined }); return }
              if (v <= 0) return false
              patchRoom(room.id, { ceilingCm: v })
            }}
          />
        </FieldRow>
        <SwitchRow
          name="roomOutdoor"
          label="Outdoor (balcony, terrace)"
          checked={!!room.outdoor}
          onChange={(checked) => patchRoom(room.id, { outdoor: checked })}
        />
        <StatGrid
          items={[
            { label: 'Area', value: `${formatM2(areaM2)} m²` },
            { label: 'Perimeter', value: `${fmtCm(perimeter(room.vertices))} cm` },
            { label: 'Volume', value: ceiling === null ? '—' : `${formatM2((areaM2 * ceiling) / 100)} m³` },
            {
              label: 'Ceiling',
              value: ceiling === null ? '—' : `${fmtCm(ceiling)} cm`,
              hint: ceiling !== null && !ownCeiling ? '(apartment default)' : undefined,
            },
          ]}
        />
      </PanelSection>

      <PanelSection id="room-walls" title="Walls" icon={<Ruler size={16} />} collapsible>
        {(() => {
          const rows = wallRows(doc, room)
          if (!rows.length) return <EmptyHint>This room has no wall yet.</EmptyHint>
          return (
            <ul className="flex flex-col gap-0.5">
              {rows.map((row) => {
                const selected = selection.kind === 'wall' && selection.wallStart === row.wallStart
                return (
                  <li key={row.wallStart}>
                    <button
                      type="button"
                      aria-label={`Select wall ${row.label}`}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => select({ kind: 'wall', roomId: room.id, wallStart: row.wallStart })}
                      className={`flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm pointer-coarse:min-h-11 ${
                        selected ? 'bg-orange-700/10' : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <span className="w-10 shrink-0 font-mono text-xs">{row.label}</span>
                      <span className={`shrink-0 rounded px-1 text-[11px] ${WALL_TYPE_CHIP[row.type]}`}>{row.typeLabel}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
                        {row.verifiedCm === null ? (
                          <span className={MUTED}>{fmtCm(row.lengthCm)}</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {fmtCm(row.verifiedCm)}
                            <Check size={11} role="img" aria-label="verified" className="ml-0.5 inline align-[-1px]" />
                          </span>
                        )}
                        <span className={`text-[11px] ${MUTED}`}>cm</span>
                      </span>
                      {row.locked && <Lock size={12} role="img" aria-label="locked" className="shrink-0 text-slate-500 dark:text-slate-400" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        })()}
      </PanelSection>

      <PanelSection id="room-elements" title="Elements" icon={<DoorOpen size={16} />} collapsible>
        {(() => {
          const rows = elementRows(doc, room)
          return rows.length
            ? <ElementList rows={rows} onSelect={(id) => select({ kind: 'element', elementId: id })} />
            : <EmptyHint>No door, window or fixture in this room yet.</EmptyHint>
        })()}
      </PanelSection>

      <PanelSection id="room-measured" title="Measured lengths" collapsible>
        <button className={BTN} disabled={!verified.length} onClick={() => runApply(false)}>Apply measured lengths</button>
        <button className={BTN} disabled={!doc.rooms.some((r) => verifiedWalls({ measurements: doc.measurements }, r).length)} onClick={() => runApply(true)}>
          Apply to all rooms
        </button>
        <CheckboxRow
          name="lockVerifiedWalls"
          label="Lock verified walls"
          disabled={!verified.length}
          checked={allLocked}
          onChange={(checked) => update((d) => setVerifiedLocked(d, room.id, checked))}
        />
        {!verified.length && <EmptyHint>No verified wall lengths yet. Measure this room in Measuring Mode.</EmptyHint>}
        {note && note.roomId === room.id && <p className="text-xs text-slate-700 dark:text-slate-200">{note.text}</p>}
      </PanelSection>
    </>
  )
}
