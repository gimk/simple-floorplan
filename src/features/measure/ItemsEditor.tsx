import { useEffect, useRef, useState } from 'react'
import { normalizeDoorHosts } from '../../core/doorHost'
import { fmtCm, roomWalls } from '../../model/geometry'
import { nowIso, uid, useDoc } from '../../model/store'
import type { ElementKind, PlanDoc, Room, WallElement } from '../../model/types'
import { KIND_FIELDS, KIND_LABEL, sizesForKind, wallRefLength } from './logic'
import { NumField } from './NumField'

const KINDS = Object.keys(KIND_LABEL) as ElementKind[]
const DOT: Record<ElementKind, string> = {
  window: 'bg-blue-600 dark:bg-blue-400', door: 'bg-violet-600 dark:bg-violet-400', opening: 'border-2 border-dashed border-slate-700 dark:border-slate-300',
  radiator: 'bg-red-600 dark:bg-red-400', other: 'bg-slate-500',
}

// Measurements and items are not undo steps in Measuring Mode.
// Every edit is ONE store update and ends with the door-host rule: a door that opens into a
// neighbouring room moves to that room. The returned name is that room, null when nothing moved.
type HostNote = string | null

function commit(next: (d: PlanDoc) => PlanDoc, id: string): HostNote {
  const cur = useDoc.getState().doc
  const { doc, moved } = normalizeDoorHosts(next(cur))
  useDoc.getState().updateSilent(() => doc)
  const hit = moved.find((m) => m.elementId === id)
  if (!hit) return null
  return doc.rooms.find((r) => r.id === hit.toRoomId)?.name ?? hit.toRoomId
}

/** Report a re-hosted door to the room card: "Door moved to <room name> (it opens into that room)". */
const report = (note: HostNote, onMoved: (note: string | null) => void) => onMoved(note)

const patchElement = (id: string, p: Partial<WallElement>): HostNote =>
  commit((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...p, updatedAt: nowIso() } : e)) }), id)

/** Remove keys instead of storing 0/undefined for an empty size (WallElement.widthCm is typed required but may be absent). */
const dropKeys = (e: WallElement, keys: string[]) => {
  const out = { ...e } as Record<string, unknown>
  for (const k of keys) delete out[k]
  return out as WallElement
}

function setField(id: string, key: string, n: number | null): HostNote {
  return commit(
    (d) => ({
      ...d,
      elements: d.elements.map((e) => {
        if (e.id !== id) return e
        const next = n == null && key !== 'offsetCm' ? dropKeys(e, [key]) : { ...e, [key]: n ?? 0 }
        return { ...next, updatedAt: nowIso() }
      }),
    }),
    id,
  )
}

/** Change the type and fill the sizes the user has not changed with the new type's defaults. */
function setKind(id: string, kind: ElementKind): HostNote {
  return commit(
    (d) => ({
      ...d,
      elements: d.elements.map((e) => {
        if (e.id !== id) return e
        const sizes = sizesForKind(e, e.kind, kind)
        return { ...dropKeys(e, ['widthCm', 'heightCm', 'sillCm', 'depthCm']), ...sizes, kind, updatedAt: nowIso() } as WallElement
      }),
    }),
    id,
  )
}

function addItem(room: Room) {
  const first = roomWalls(room)[0]
  if (!first) return
  const t = nowIso()
  const el: WallElement = { id: uid('e'), roomId: room.id, wallStart: first.start.id, kind: 'window', offsetCm: 0, ...sizesForKind({}, null, 'window'), createdAt: t, updatedAt: t } as WallElement
  useDoc.getState().updateSilent((d) => ({ ...d, elements: [...d.elements, el] }))
  return el.id
}

const sel = 'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-[15px] dark:border-slate-600 dark:bg-[#1b2128]'

function Item({ room, el, onMoved }: { room: Room; el: WallElement; onMoved: (note: string | null) => void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const doc = useDoc((s) => s.doc)
  const walls = roomWalls(room)
  const fields = KIND_FIELDS[el.kind]
  // One patch = one store update; a re-hosted door is reported to the room card.
  const push = (p: Partial<WallElement>) => report(patchElement(el.id, p), onMoved)
  const pushField = (key: string, n: number | null) => report(setField(el.id, key, n), onMoved)
  const pushKind = (kind: ElementKind) => report(setKind(el.id, kind), onMoved)
  // Overflow warning: the item must fit on its wall (measured length when known, else planned).
  const wall = walls.find((w) => w.start.id === el.wallStart)
  const ref = wall ? wallRefLength(doc, room, wall) : null
  const over = ref != null && ref > 0 && el.offsetCm + (el.widthCm ?? 0) > ref + 1e-6
  const onDelete = () => {
    if (!armed) { setArmed(true); timer.current = window.setTimeout(() => setArmed(false), 3000); return }
    window.clearTimeout(timer.current)
    useDoc.getState().updateSilent((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== el.id) }))
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-slate-300 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-[#12161b]" data-item={el.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className={`size-3 flex-none rounded-[3px] ${DOT[el.kind]}`} />
        <select name="itemKind" aria-label="Type" className={sel} value={el.kind} onChange={(e) => pushKind(e.target.value as ElementKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select name="itemWall" aria-label="Wall" className={sel} value={el.wallStart} onChange={(e) => push({ wallStart: e.target.value })}>
          {walls.map((w) => <option key={w.start.id} value={w.start.id}>on {room.code}-{w.index + 1}</option>)}
        </select>
        <span className="flex-1" />
        <button
          type="button" onClick={onDelete}
          className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${armed ? 'border-orange-600 bg-orange-600 text-white' : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'}`}
        >
          {armed ? 'Tap to confirm' : 'Delete'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {fields.map(([key, label], i) => (
          <label key={key} className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
            <NumField
              id={i === 0 ? `item-${el.id}-${key}` : undefined}
              value={el[key]} allowZero hideZero={key === 'widthCm'} ariaLabel={label}
              onValue={(n) => pushField(key, n)}
            />
          </label>
        ))}
      </div>
      {over && wall && (
        <p role="alert" className="rounded-lg bg-orange-100 px-3 py-2 text-[13px] font-semibold text-orange-900 dark:bg-orange-950 dark:text-orange-200">
          This item does not fit: from start + width = {fmtCm(el.offsetCm + (el.widthCm ?? 0))} cm, but wall {room.code}-{wall.index + 1} is {fmtCm(ref ?? 0)} cm ({doc.measurements[`${room.code}-${wall.index + 1}`] != null ? 'measured' : 'planned'}).
        </p>
      )}
      <input
        name="itemNote" aria-label="Note" autoComplete="off" placeholder="Note (opening side, handle…)" value={el.note ?? ''}
        onChange={(e) => push({ note: e.target.value || undefined })}
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] dark:border-slate-600 dark:bg-[#1b2128]"
      />
    </div>
  )
}

export function ItemsEditor({ room, elements }: { room: Room; elements: WallElement[] }) {
  const mine = elements.filter((e) => e.roomId === room.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  // A door that was just re-hosted leaves this room: say where it went, in this card.
  const [movedTo, setMovedTo] = useState<string | null>(null)
  const onMoved = (name: string | null) => setMovedTo(name)
  /** Add an item and focus its first numeric field ("From start") once it is rendered. */
  const onAdd = () => {
    const id = addItem(room)
    if (id) requestAnimationFrame(() => (document.getElementById(`item-${id}-offsetCm`) as HTMLInputElement | null)?.focus())
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm">Doors &amp; windows</b>
        <button type="button" onClick={onAdd} className="min-h-11 rounded-lg border border-orange-600 px-3 text-sm font-semibold text-orange-700 dark:border-orange-400 dark:text-orange-400">+ Add item</button>
      </div>
      <p className="text-[13px] text-slate-500 dark:text-slate-400">
        “From start” is measured along the wall from the corner where its arrow starts, to the near edge of the item. Enter each door in the room it opens into: it also shows, dashed, in the room on the other side. For a passage with no door, use “Opening (no door)”, in either room.
      </p>
      {movedTo && (
        <p role="status" className="rounded-lg bg-violet-100 px-3 py-2 text-[13px] font-semibold text-violet-900 dark:bg-violet-950 dark:text-violet-200">
          Door moved to {movedTo} (it opens into that room)
        </p>
      )}
      {mine.map((el) => <Item key={el.id} room={room} el={el} onMoved={onMoved} />)}
    </div>
  )
}
