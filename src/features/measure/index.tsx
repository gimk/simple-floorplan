// OWNER: measure agent. Contract: keep this export name.
import { useEffect, useState } from 'react'
import { ArrowDownCircle, Eye, Monitor, Sun } from 'lucide-react'
import { useDoc, useUi } from '../../model/store'
import { labelRoomCode } from '../../model/survey'
import { loadDemoApartment } from './demo'
import { allMeasureRows, docProgress, rowMeasured, measureRooms, nextUnmeasuredLabel, roomHasMissing, roomIsFlagged } from './logic'
import { jumpToMeasureField, startLabel, useLastFocusedLabel } from './focusField'
import { Overview } from './Overview'
import { FacadeSection } from './FacadeCard'
import { DeletedRoomsOldValues, RemovedWallsOldValues } from './OldValues'
import { RoomCard } from './RoomCard'
import { useWakeLock } from './useWakeLock'
import { FilterGroup, SyncLine, useNormalizeDoorHosts, useStoredFlag, type Filter } from './MeasureControls'

export { MeasurePanel } from './MeasurePanel'

/** Full-screen Measuring Mode (mobile-first). Rendered instead of the editor when ui.mode === 'measure'. */
export function MeasureMode() {
  const doc = useDoc((s) => s.doc)
  const allRooms = measureRooms(doc)
  const rows = allMeasureRows(doc)
  const labels = rows.map((s) => s.label)
  const { done, total } = docProgress(doc)
  const hasRooms = allRooms.length > 0

  const [filter, setFilter] = useState<Filter>('all')
  const [keepOn, setKeepOn] = useStoredFlag('measure-keep-screen-on', true)
  const [sunlight, setSunlight] = useStoredFlag('measure-sunlight', false)
  useWakeLock(keepOn)

  // Shared with the desktop panel: the jump continues after the field that had the focus last
  // (review finding 16).
  const lastFocused = useLastFocusedLabel()

  useNormalizeDoorHosts()

  // Open the room from the URL hash, if any.
  useEffect(() => {
    const m = /^#room-(.+)$/.exec(location.hash)
    if (m) document.getElementById(`room-${decodeURIComponent(m[1])}`)?.scrollIntoView({ block: 'start' })
  }, [hasRooms])

  const rooms = allRooms.filter((r) =>
    filter === 'all' ? true : filter === 'missing' ? roomHasMissing(doc, r) : roomIsFlagged(doc, r))

  /** Focus the next empty survey input after the currently focused one (wraps around). */
  const jumpNextUnmeasured = () => {
    const active = document.activeElement
    const current = startLabel(active instanceof HTMLElement ? active.id : undefined, lastFocused.current)
    const nx = nextUnmeasuredLabel(doc, labels, current, (l) => { const r = rows.find((x) => x.label === l); return r ? rowMeasured(doc, r) : doc.measurements[l] != null })
    if (!nx) return
    const code = labelRoomCode(nx)
    document.getElementById(`room-${code}`)?.scrollIntoView({ block: 'start' })
    jumpToMeasureField(nx, () => setFilter('all'))
  }

  return (
    <div className={`min-h-full bg-[#f6f7f5] text-[#1b2430] dark:bg-[#12161b] dark:text-[#e8ecef] ${sunlight ? 'sunlight' : ''}`}>
      {/* ONE compact sticky header for Measuring Mode (the app shell hides its own header in this mode). */}
      <header className="sticky top-0 z-10 border-b border-slate-300 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-[#1b2128]/95">
        <div className="mx-auto max-w-[560px] px-2.5 pb-2 pt-1.5 sm:px-4">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-bold">{doc.title || 'Untitled'}</h1>
            <span className="flex-none font-mono text-sm text-slate-500 dark:text-slate-400" aria-label="Measured of total">{done} / {total}</span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={jumpNextUnmeasured}
              aria-label="Next unmeasured field"
              title="Next unmeasured"
              className="flex min-h-11 min-w-11 flex-none items-center justify-center rounded-lg border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
            ><ArrowDownCircle size={17} /></button>
            <button
              type="button" onClick={() => useUi.getState().setMode('edit')}
              className="flex min-h-11 flex-none items-center gap-1.5 rounded-lg border border-orange-600 px-2.5 text-[13px] font-semibold text-orange-700 dark:border-orange-400 dark:text-orange-400"
            ><Monitor size={15} /> Edit Mode</button>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Measuring progress"
          >
            <div className="h-full bg-green-600 transition-[width] motion-reduce:transition-none dark:bg-green-400" style={{ width: `${total ? (100 * done) / total : 0}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1 sm:gap-2">
            <SyncLine />
            <FilterGroup filter={filter} onChange={setFilter} />
            <button
              type="button" onClick={() => setKeepOn(!keepOn)}
              aria-pressed={keepOn} aria-label="Keep screen on" title="Keep screen on"
              className={`flex min-h-11 min-w-11 flex-none items-center justify-center rounded-lg border ${keepOn ? 'border-green-700 text-green-700 dark:border-green-400 dark:text-green-400' : 'border-slate-300 text-slate-400 dark:border-slate-600'}`}
            ><Eye size={16} /></button>
            <button
              type="button" onClick={() => setSunlight(!sunlight)}
              aria-pressed={sunlight} aria-label="Sunlight high-contrast mode" title="Sunlight (high contrast)"
              className={`flex min-h-11 min-w-11 flex-none items-center justify-center rounded-lg border ${sunlight ? 'border-yellow-500 bg-yellow-300 text-black' : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'}`}
            ><Sun size={16} /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[560px] flex-col gap-5 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">
        {!hasRooms ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-300 bg-white p-5 dark:border-slate-700 dark:bg-[#1b2128]">
            <h2 className="text-lg font-semibold">No rooms to measure yet</h2>
            <p className="text-[15px] text-slate-600 dark:text-slate-300">
              Draw your rooms in Edit Mode first. Each room then gets measurement IDs here, such as SE-1, SE-2, SE-D and SE-H.
            </p>
            <button type="button" onClick={loadDemoApartment} className="min-h-11 rounded-lg border border-orange-600 px-4 text-sm font-semibold text-orange-700 dark:border-orange-400 dark:text-orange-400">
              Load demo apartment
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Type each length in cm. Tap a room on the plan to go to it. Tap a wall ID in a room drawing to fill it in. Every value saves when you type it.
            </p>
            <Overview doc={doc} rooms={allRooms} />
            {rooms.length === 0 && (
              <p role="status" className="rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-[#1b2128] dark:text-slate-400">
                {filter === 'missing' ? 'Every measurement is filled in.' : 'Nothing flagged: no discrepancy over 2 cm and no squareness warning.'}
              </p>
            )}
            {rooms.map((r) => <RoomCard key={r.id} doc={doc} room={r} allLabels={labels} />)}
            <FacadeSection doc={doc} />
            <RemovedWallsOldValues doc={doc} />
            <DeletedRoomsOldValues doc={doc} />
          </>
        )}
      </main>
    </div>
  )
}
