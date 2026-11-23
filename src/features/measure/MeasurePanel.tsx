// Measure panel: Measuring Mode on desktop. It replaces the right side panel only; the canvas
// stays the real one, so the user measures on the real plan. Phones keep the full-screen MeasureMode.
import { useEffect, useRef, useState } from 'react'
import { ArrowDownCircle, ChevronRight, Eye } from 'lucide-react'
import { useDoc, useUi } from '../../model/store'
import { allRequiredSurveyIds, labelRoomCode, roomsInWalkOrder } from '../../model/survey'
import type { Room } from '../../model/types'
import { docProgress, nextUnmeasuredLabel, roomHasMissing, roomIsFlagged, roomProgress } from './logic'
import { focusMeasureField, selectionRoomId } from './focusField'
import { FilterGroup, SyncLine, useNormalizeDoorHosts, useStoredFlag, type Filter } from './MeasureControls'
import { FacadeSection } from './FacadeCard'
import { DeletedRoomsOldValues, RemovedWallsOldValues } from './OldValues'
import { RoomCard } from './RoomCard'
import { useWakeLock } from './useWakeLock'

/**
 * The room that is open: the selected room on the canvas, else the last open one,
 * else the first room with missing values (else the first room). Pure.
 */
export function currentRoomId(
  rooms: Room[], selectedId: string | null, lastId: string | null, hasMissing: (r: Room) => boolean,
): string | null {
  const has = (id: string | null) => (id && rooms.some((r) => r.id === id) ? id : null)
  return has(selectedId) ?? has(lastId) ?? (rooms.find(hasMissing) ?? rooms[0])?.id ?? null
}

export function MeasurePanel() {
  const doc = useDoc((s) => s.doc)
  const selection = useUi((s) => s.selection)
  const allRooms = roomsInWalkOrder(doc)
  const labels = allRequiredSurveyIds(doc).map((s) => s.label)
  const { done, total } = docProgress(doc)

  const [filter, setFilter] = useState<Filter>('all')
  const [keepOn, setKeepOn] = useStoredFlag('measure-keep-screen-on', true)
  useWakeLock(keepOn)
  useNormalizeDoorHosts()

  // The last room that was open: kept when the selection is cleared.
  const selectedId = selectionRoomId(selection)
  const [lastId, setLastId] = useState<string | null>(null)
  useEffect(() => { if (selectedId) setLastId(selectedId) }, [selectedId])
  const currentId = currentRoomId(allRooms, selectedId, lastId, (r) => roomHasMissing(doc, r))

  // A room picked on the canvas: bring its card into view in the panel.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const room = allRooms.find((r) => r.id === selectedId)
    if (room) listRef.current?.querySelector(`#room-${room.code}`)?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const rooms = allRooms.filter((r) =>
    filter === 'all' ? true : filter === 'missing' ? roomHasMissing(doc, r) : roomIsFlagged(doc, r))

  /** Open the room of the next empty field and focus it (wraps around). */
  const jumpNextUnmeasured = () => {
    const active = document.activeElement
    const current = active instanceof HTMLElement && active.id.startsWith('m-') ? active.id.slice(2) : null
    const nx = nextUnmeasuredLabel(doc, labels, current)
    if (!nx) return
    const code = labelRoomCode(nx)
    const room = allRooms.find((r) => r.code === code)
    if (room) useUi.getState().select({ kind: 'room', roomId: room.id })
    focusMeasureField(nx)
  }

  return (
    <div className="flex flex-col gap-3" aria-label="Measure panel" data-measure-panel="">
      <div className="sticky -top-3 z-10 -mx-3 -mt-3 flex flex-col gap-1.5 border-b border-black/10 bg-white px-3 pb-2 pt-3 dark:border-white/10 dark:bg-[#1b2128]">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm font-semibold">Measuring</span>
          <span className="flex-none font-mono text-sm text-slate-500 dark:text-slate-400" aria-label="Measured of total">{done} / {total}</span>
          <button
            type="button" onMouseDown={(e) => e.preventDefault()} onClick={jumpNextUnmeasured}
            aria-label="Next unmeasured field" title="Next unmeasured"
            className="flex min-h-9 min-w-9 flex-none items-center justify-center rounded-lg border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
          ><ArrowDownCircle size={17} /></button>
          {/* Keep screen on still helps on a laptop or tablet. The sunlight mode is for phones outdoors, so it is not here. */}
          <button
            type="button" onClick={() => setKeepOn(!keepOn)}
            aria-pressed={keepOn} aria-label="Keep screen on" title="Keep screen on"
            className={`flex min-h-9 min-w-9 flex-none items-center justify-center rounded-lg border ${keepOn ? 'border-green-700 text-green-700 dark:border-green-400 dark:text-green-400' : 'border-slate-300 text-slate-400 dark:border-slate-600'}`}
          ><Eye size={16} /></button>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
          role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Measuring progress"
        >
          <div className="h-full bg-green-600 transition-[width] motion-reduce:transition-none dark:bg-green-400" style={{ width: `${total ? (100 * done) / total : 0}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <SyncLine />
          <FilterGroup filter={filter} onChange={setFilter} />
        </div>
      </div>

      {allRooms.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No rooms to measure yet. Use Exit Measuring Mode, then draw your rooms.
        </p>
      ) : (
        <div ref={listRef} className="flex flex-col gap-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Click a room or a wall on the plan to open its fields. Type each length in cm. Every value saves when you type it.
          </p>
          {rooms.length === 0 && (
            <p role="status" className="rounded-lg border border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {filter === 'missing' ? 'Every measurement is filled in.' : 'Nothing flagged: no discrepancy over 2 cm and no squareness warning.'}
            </p>
          )}
          {rooms.map((r) =>
            r.id === currentId ? (
              <RoomCard key={r.id} doc={doc} room={r} allLabels={labels} hideDrawing />
            ) : (
              <CollapsedRoom key={r.id} room={r} />
            ))}
        </div>
      )}
      <FacadeSection doc={doc} />
      <RemovedWallsOldValues doc={doc} />
      <DeletedRoomsOldValues doc={doc} />
    </div>
  )
}

/** Header of a collapsed room: a click selects the room on the canvas, and so opens its card. */
function CollapsedRoom({ room }: { room: Room }) {
  const doc = useDoc((s) => s.doc)
  const { done, total } = roomProgress(doc, room)
  return (
    <section id={`room-${room.code}`} aria-label={room.name} data-collapsed="">
      <button
        type="button" aria-expanded={false}
        onClick={() => useUi.getState().select({ kind: 'room', roomId: room.id })}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-left hover:bg-black/5 dark:border-slate-700 dark:bg-[#1b2128] dark:hover:bg-white/10"
      >
        <ChevronRight size={16} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{room.name}</span>
        <small className="font-mono text-[13px] text-slate-500 dark:text-slate-400">{room.code} · {done}/{total}</small>
      </button>
    </section>
  )
}
