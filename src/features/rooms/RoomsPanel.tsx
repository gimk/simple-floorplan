import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { fmtCm, roomAreaM2, roomWalls } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, WallProps, WallType } from '../../model/types'
import { undoToast } from '../toast'
import { applyMeasured, applyMeasuredAll, describeReport, setVerifiedLocked, verifiedAllLocked, verifiedWalls } from './apply'
import { useActiveHole } from './holes'
import { deleteRoom, perimeter, setRoomCode } from './ops'
import { DEFAULT_THICKNESS, wallProps } from './walls'

const input = 'h-9 w-full rounded-md border border-black/15 bg-white px-2 text-sm dark:border-white/15 dark:bg-[#12161b]'
const label = 'flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400'

const update = (fn: (d: PlanDoc) => PlanDoc) => useDoc.getState().update(fn)
const patchRoom = (id: string, patch: Partial<Room>) =>
  update((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))

/** Text/number field that commits on blur or Enter (one undo step per edit). */
function Field({ title, value, onCommit, type = 'text', errorText, disabled, suffix }: {
  title: string; value: string; onCommit: (v: string) => boolean | void; type?: 'text' | 'number'; errorText?: string; disabled?: boolean; suffix?: string
}) {
  const [text, setText] = useState(value)
  const [bad, setBad] = useState(false)
  useEffect(() => { setText(value); setBad(false) }, [value])
  const commit = () => {
    if (text === value) return
    if (onCommit(text) === false) { setBad(true); setText(value) } else setBad(false)
  }
  return (
    <label className={label}>
      <span>{title}{suffix ? ` (${suffix})` : ''}</span>
      <input
        className={`${input} ${bad ? 'border-red-500' : ''}`}
        type="text"
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      {bad && <span className="text-red-600">{errorText ?? 'Invalid value'}</span>}
    </label>
  )
}

const num = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : null }

function setWall(roomId: string, startId: string, patch: Partial<WallProps>) {
  update((d) => ({
    ...d,
    rooms: d.rooms.map((r) => r.id !== roomId ? r : { ...r, walls: { ...r.walls, [startId]: { ...wallProps(r, startId), ...patch } } }),
  }))
}

function setWallType(roomId: string, startId: string, type: WallType) {
  const r = useDoc.getState().doc.rooms.find((x) => x.id === roomId)
  if (!r) return
  const cur = wallProps(r, startId)
  // Follow the new type's default thickness unless the user customised it.
  const thick = cur.thicknessCm === DEFAULT_THICKNESS[cur.type] ? DEFAULT_THICKNESS[type] : cur.thicknessCm
  setWall(roomId, startId, { type, thicknessCm: thick })
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

/** Sidebar panel: properties of the selected room / wall / vertex. */
export function RoomsPanel() {
  const selection = useUi((s) => s.selection)
  const roomId = selection && selection.kind !== 'element' ? selection.roomId : null
  const room = useDoc((s) => s.doc.rooms.find((r) => r.id === roomId))
  const allRooms = useDoc((s) => s.doc.rooms)
  const measurements = useDoc((s) => s.doc.measurements)
  const activeHole = useActiveHole()
  const [applyNote, setApplyNote] = useState<string | null>(null)
  useEffect(() => setApplyNote(null), [roomId])

  // 'b' toggles the selected wall between bearing and partition.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      const ui = useUi.getState()
      if (ui.mode !== 'edit' || ui.selection?.kind !== 'wall') return
      const sel = ui.selection
      const r = useDoc.getState().doc.rooms.find((x) => x.id === sel.roomId)
      if (!r) return
      setWallType(sel.roomId, sel.wallStart, wallProps(r, sel.wallStart).type === 'bearing' ? 'partition' : 'bearing')
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  if (!room || !selection || selection.kind === 'element') return null
  const walls = roomWalls(room)
  const wall = selection.kind === 'wall' ? walls.find((w) => w.start.id === selection.wallStart) : undefined
  const props = wall ? wallProps(room, wall.start.id) : undefined
  const outlineVertex = selection.kind === 'vertex' ? room.vertices.find((v) => v.id === selection.vertexId) : undefined
  const holeVertex = selection.kind === 'vertex' && !outlineVertex ? room.holes.flat().find((v) => v.id === selection.vertexId) : undefined
  const vertex = outlineVertex ?? holeVertex
  const holeRing = holeVertex ? room.holes.find((h) => h.some((v) => v.id === holeVertex.id)) : undefined
  const verified = verifiedWalls({ measurements }, room)
  const allLocked = verifiedAllLocked({ measurements }, room)
  const runApply = (all: boolean) => {
    const doc = useDoc.getState().doc
    const r = all ? applyMeasuredAll(doc) : (() => { const x = applyMeasured(doc, room.id); return { doc: x.doc, reports: [x.report] } })()
    if (r.doc !== doc) update(() => r.doc)
    const done = r.reports.filter((x) => x.mode !== 'none')
    setApplyNote(all
      ? done.length ? `Applied to ${done.length} room${done.length === 1 ? '' : 's'}. ${done.map(describeReport).join(' ')}` : 'No room has verified wall lengths.'
      : describeReport(r.reports[0]))
  }
  const box = 'rounded-lg border border-black/10 p-2 text-sm dark:border-white/10'
  const typeBtn = (t: WallType, text: string) => (
    <button
      key={t}
      className={`h-9 flex-1 rounded-md border text-xs ${props?.type === t ? 'border-orange-600 bg-orange-600 text-white' : 'border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10'}`}
      onClick={() => wall && setWallType(room.id, wall.start.id, t)}
    >{text}</button>
  )

  return (
    <div className="flex flex-col gap-3">
      {wall && props && (
        <section className={`${box} flex flex-col gap-2`}>
          <h2 className="font-semibold">Wall {room.code}-{wall.index + 1}</h2>
          <div className="flex gap-1">{typeBtn('bearing', 'Bearing')}{typeBtn('partition', 'Partition')}{typeBtn('exterior', 'Exterior')}</div>
          <Field title="Thickness" suffix="cm" type="number" value={fmtCm(props.thicknessCm)}
            onCommit={(v) => { const n = num(v); if (n === null || n < 1 || n > 200) return false; setWall(room.id, wall.start.id, { thicknessCm: n }) }} />
          <Field title="Length" suffix="cm" type="number" value={fmtCm(wall.length)} disabled={!!props.locked}
            onCommit={(v) => { const n = num(v); if (n === null || n < 1) return false; setWallLength(room.id, wall.start.id, n) }} />
          <label className="flex min-h-9 items-center gap-2">
            <input type="checkbox" checked={!!props.locked} onChange={(e) => setWall(room.id, wall.start.id, { locked: e.target.checked })} />
            Locked (cannot be resized)
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">Key B: bearing / partition. Length moves the end vertex.</p>
        </section>
      )}
      {vertex && (
        <section className={`${box} text-xs text-slate-500 dark:text-slate-400`}>
          {holeVertex ? 'Hole vertex' : 'Vertex'} at {fmtCm(vertex.x)} / {fmtCm(vertex.y)} cm. Press Delete to remove it
          {holeVertex ? ((holeRing?.length ?? 0) <= 3 ? ' (a hole needs 3 vertices)' : '') : (room.vertices.length <= 3 ? ' (a room needs 3 vertices)' : '')}.
        </section>
      )}
      {activeHole && (
        <section className={`${box} text-xs text-slate-500 dark:text-slate-400`}>
          Hole selected. Drag its handles to reshape it. Press Delete to remove the whole hole.
        </section>
      )}
      <section className={`${box} flex flex-col gap-2`}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Room</h2>
          <button className="flex h-9 w-9 items-center justify-center rounded-md text-red-600 hover:bg-red-500/10" title="Delete room" aria-label={`Delete room ${room.name}`}
            onClick={() => {
              update((d) => deleteRoom(d, room.id))
              useUi.getState().select(null)
              undoToast('Room deleted', () => useDoc.temporal.getState().undo())
            }}>
            <Trash2 size={16} />
          </button>
        </div>
        <Field title="Name" value={room.name} onCommit={(v) => { if (!v.trim()) return false; patchRoom(room.id, { name: v.trim() }) }} />
        <Field title="Code (unique)" value={room.code} errorText="Code already used"
          onCommit={(v) => {
            const c = v.trim()
            if (!c || allRooms.some((r) => r.id !== room.id && r.code === c)) return false
            update((d) => setRoomCode(d, room.id, c))
          }} />
        <Field title="Walk order" type="number" value={String(room.walkOrder)}
          onCommit={(v) => { const n = num(v); if (n === null) return false; patchRoom(room.id, { walkOrder: n }) }} />
        <Field title="Ceiling height" suffix="cm" type="number" value={room.ceilingCm === undefined ? '' : fmtCm(room.ceilingCm)}
          onCommit={(v) => {
            if (!v.trim()) { patchRoom(room.id, { ceilingCm: undefined }); return }
            const n = num(v); if (n === null || n <= 0) return false; patchRoom(room.id, { ceilingCm: n })
          }} />
        <label className="flex min-h-9 items-center gap-2">
          <input type="checkbox" checked={!!room.outdoor} onChange={(e) => patchRoom(room.id, { outdoor: e.target.checked })} />
          Outdoor (balcony, terrace)
        </label>
        <div className="flex flex-col gap-1.5 border-t border-black/10 pt-2 dark:border-white/10">
          <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Measured lengths</h3>
          <button disabled={!verified.length}
            className="min-h-9 rounded-md border border-black/15 px-2 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
            onClick={() => runApply(false)}>Apply measured lengths</button>
          <button disabled={!allRooms.some((r) => verifiedWalls({ measurements }, r).length)}
            className="min-h-9 rounded-md border border-black/15 px-2 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
            onClick={() => runApply(true)}>Apply to all rooms</button>
          <label className="flex min-h-9 items-center gap-2">
            <input type="checkbox" disabled={!verified.length} checked={allLocked}
              onChange={(e) => update((d) => setVerifiedLocked(d, room.id, e.target.checked))} />
            Lock verified walls
          </label>
          {!verified.length && <p className="text-xs text-slate-500 dark:text-slate-400">No verified wall lengths yet. Measure this room in Measuring Mode.</p>}
          {applyNote && <p className="text-xs text-slate-700 dark:text-slate-200">{applyNote}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-2 text-xs text-slate-500 dark:text-slate-400">
          <dt>Area</dt><dd className="text-right text-slate-800 dark:text-slate-100">{roomAreaM2(room).toFixed(2).replace('.', ',')} m²</dd>
          <dt>Perimeter</dt><dd className="text-right text-slate-800 dark:text-slate-100">{fmtCm(perimeter(room.vertices))} cm</dd>
        </dl>
      </section>
    </div>
  )
}
