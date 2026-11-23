// Old values: measured values that left the plan (wall split or removed, room deleted).
// They stay in `doc.oldMeasurements` until the user deletes one (one undo step).
import { Trash2 } from 'lucide-react'
import { fmtCm } from '../../model/geometry'
import { removeOld, REASON_WORDS } from '../../model/oldMeasurements'
import { useDoc } from '../../model/store'
import type { OldMeasurement, PlanDoc, Room } from '../../model/types'

const day = (iso: string) => iso.slice(0, 10)

/** Old values of rooms that are not in the plan any more. */
export const oldOfDeletedRooms = (doc: PlanDoc): OldMeasurement[] => {
  const codes = new Set(doc.rooms.map((r) => r.code))
  return (doc.oldMeasurements ?? []).filter((e) => !codes.has(e.roomCode))
}

function Entry({ e }: { e: OldMeasurement }) {
  const del = () => useDoc.getState().update((d) => ({ ...d, oldMeasurements: removeOld(d.oldMeasurements, e) }))
  return (
    <li className="flex items-center gap-2 text-[13px]">
      <span className="font-mono font-semibold">{e.label}</span>
      <span className="font-mono">{fmtCm(e.actualCm)}</span>
      <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">{REASON_WORDS[e.reason]} · {day(e.droppedAt)}</span>
      <button
        type="button" onClick={del} aria-label={`Delete old value ${e.label}`} title="Delete this old value"
        className="flex min-h-9 min-w-9 flex-none items-center justify-center rounded-lg border border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400"
      ><Trash2 size={14} /></button>
    </li>
  )
}

/** Collapsible "Old values (n)" of one room card. Nothing when the room has none. */
export function RoomOldValues({ doc, room }: { doc: PlanDoc; room: Room }) {
  const list = (doc.oldMeasurements ?? []).filter((e) => e.roomCode === room.code)
  if (!list.length) return null
  return (
    <details className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <summary className="cursor-pointer text-[13px] font-semibold text-slate-600 dark:text-slate-300">Old values ({list.length})</summary>
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Values that left this room when a wall changed. They are kept until you delete them.</p>
      <ul className="mt-2 flex flex-col gap-1.5">{list.map((e, i) => <Entry key={`${e.label}-${e.updatedAt}-${i}`} e={e} />)}</ul>
    </details>
  )
}

/** "Old values of deleted rooms" of the Measuring Mode panel. Nothing when there are none. */
export function DeletedRoomsOldValues({ doc }: { doc: PlanDoc }) {
  const list = oldOfDeletedRooms(doc)
  if (!list.length) return null
  return (
    <details className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-[#1b2128]">
      <summary className="cursor-pointer text-[13px] font-semibold text-slate-600 dark:text-slate-300">Old values of deleted rooms ({list.length})</summary>
      <ul className="mt-2 flex flex-col gap-1.5">{list.map((e, i) => <Entry key={`${e.label}-${e.updatedAt}-${i}`} e={e} />)}</ul>
    </details>
  )
}
