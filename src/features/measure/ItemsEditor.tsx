import { useEffect, useRef, useState } from 'react'
import { roomWalls } from '../../model/geometry'
import { nowIso, uid, useDoc } from '../../model/store'
import type { ElementKind, PlanDoc, Room, WallElement } from '../../model/types'
import { KIND_FIELDS, KIND_LABEL, sizesForKind, wallRefLength } from './logic'
import { NumField } from './NumField'

const KINDS = Object.keys(KIND_LABEL) as ElementKind[]
const DOT: Record<ElementKind, string> = {
  window: 'bg-blue-600 dark:bg-blue-400', door: 'bg-violet-600 dark:bg-violet-400', opening: 'border-2 border-dashed border-slate-700 dark:border-slate-300',
  cupboard: 'border border-slate-700 bg-stone-300 dark:border-slate-300 dark:bg-stone-600', radiator: 'bg-red-600 dark:bg-red-400', other: 'bg-slate-500',
}

// Measurements and items are not undo steps in Measuring Mode.
const patchElement = (id: string, p: Partial<WallElement>) =>
  useDoc.getState().updateSilent((d: PlanDoc) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...p, updatedAt: nowIso() } : e)) }))

/** Remove keys instead of storing 0/undefined for an empty size (WallElement.widthCm is typed required but may be absent). */
const dropKeys = (e: WallElement, keys: string[]) => {
  const out = { ...e } as Record<string, unknown>
  for (const k of keys) delete out[k]
  return out as WallElement
}

function setField(id: string, key: string, n: number | null) {
  useDoc.getState().updateSilent((d: PlanDoc) => ({
    ...d,
    elements: d.elements.map((e) => {
      if (e.id !== id) return e
      const next = n == null && key !== 'offsetCm' ? dropKeys(e, [key]) : { ...e, [key]: n ?? 0 }
      return { ...next, updatedAt: nowIso() }
    }),
  }))
}

/** Change the type and fill the sizes the user has not changed with the new type's defaults. */
function setKind(id: string, kind: ElementKind) {
  useDoc.getState().updateSilent((d: PlanDoc) => ({
    ...d,
    elements: d.elements.map((e) => {
      if (e.id !== id) return e
      const sizes = sizesForKind(e, e.kind, kind)
      return { ...dropKeys(e, ['widthCm', 'heightCm', 'sillCm', 'depthCm']), ...sizes, kind, updatedAt: nowIso() } as WallElement
    }),
  }))
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

function Item({ room, el }: { room: Room; el: WallElement }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const doc = useDoc((s) => s.doc)
  const walls = roomWalls(room)
  const fields = KIND_FIELDS[el.kind]
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
        <select aria-label="Type" className={sel} value={el.kind} onChange={(e) => setKind(el.id, e.target.value as ElementKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select aria-label="Wall" className={sel} value={el.wallStart} onChange={(e) => patchElement(el.id, { wallStart: e.target.value })}>
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
              onValue={(n) => setField(el.id, key, n)}
            />
          </label>
        ))}
      </div>
      {over && wall && (
        <p role="alert" className="rounded-lg bg-orange-100 px-3 py-2 text-[13px] font-semibold text-orange-900 dark:bg-orange-950 dark:text-orange-200">
          This item does not fit: from start + width = {Math.round((el.offsetCm + (el.widthCm ?? 0)) * 10) / 10} cm, but wall {room.code}-{wall.index + 1} is {Math.round((ref ?? 0) * 10) / 10} cm ({doc.measurements[`${room.code}-${wall.index + 1}`] != null ? 'measured' : 'planned'}).
        </p>
      )}
      <input
        aria-label="Note" autoComplete="off" placeholder="Note (opening side, handle…)" value={el.note ?? ''}
        onChange={(e) => patchElement(el.id, { note: e.target.value || undefined })}
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] dark:border-slate-600 dark:bg-[#1b2128]"
      />
    </div>
  )
}

export function ItemsEditor({ room, elements }: { room: Room; elements: WallElement[] }) {
  const mine = elements.filter((e) => e.roomId === room.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  /** Add an item and focus its first numeric field ("From start") once it is rendered. */
  const onAdd = () => {
    const id = addItem(room)
    if (id) requestAnimationFrame(() => (document.getElementById(`item-${id}-offsetCm`) as HTMLInputElement | null)?.focus())
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm">Doors, windows &amp; cupboards</b>
        <button type="button" onClick={onAdd} className="min-h-11 rounded-lg border border-orange-600 px-3 text-sm font-semibold text-orange-700 dark:border-orange-400 dark:text-orange-400">+ Add item</button>
      </div>
      <p className="text-[13px] text-slate-500 dark:text-slate-400">
        “From start” is measured along the wall from the corner where its arrow starts, to the near edge of the item. Enter each door in the room it opens into: it also shows, dashed, in the room on the other side. For a passage with no door, use “Opening (no door)”, in either room.
      </p>
      {mine.map((el) => <Item key={el.id} room={room} el={el} />)}
    </div>
  )
}
