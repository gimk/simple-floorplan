// OWNER: measure agent. Contract: keep this export name.
import { useEffect } from 'react'
import { useDoc } from '../../model/store'
import { allSurveyIds, roomsInWalkOrder } from '../../model/survey'
import { loadDemoApartment } from './demo'
import { docProgress } from './logic'
import { Overview } from './Overview'
import { RoomCard } from './RoomCard'
import { useSyncStatus } from './useSyncStatus'

/** Full-screen Measuring Mode (mobile-first). Rendered instead of the editor when ui.mode === 'measure'. */
export function MeasureMode() {
  const doc = useDoc((s) => s.doc)
  const status = useSyncStatus()
  const rooms = roomsInWalkOrder(doc)
  const labels = allSurveyIds(doc).map((s) => s.label)
  const { done, total } = docProgress(doc)
  const hasRooms = rooms.length > 0

  // Open the room from the URL hash, if any.
  useEffect(() => {
    const m = /^#room-(.+)$/.exec(location.hash)
    if (m) document.getElementById(`room-${decodeURIComponent(m[1])}`)?.scrollIntoView({ block: 'start' })
  }, [hasRooms])

  return (
    <div className="min-h-full bg-[#f6f7f5] text-[#1b2430] dark:bg-[#12161b] dark:text-[#e8ecef]">
      <header className="sticky top-0 z-10 border-b border-slate-300 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-[#1b2128]/95">
        <div className="mx-auto max-w-[560px] px-4 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="truncate text-base font-bold">{doc.title}</h1>
            <span className="font-mono text-sm text-slate-500 dark:text-slate-400" aria-label="Measured of total">{done} / {total}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full bg-green-600 transition-[width] motion-reduce:transition-none dark:bg-green-400" style={{ width: `${total ? (100 * done) / total : 0}%` }} />
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{status}</div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[560px] flex-col gap-5 px-4 pb-24 pt-4">
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
            <Overview doc={doc} rooms={rooms} />
            {rooms.map((r) => <RoomCard key={r.id} doc={doc} room={r} allLabels={labels} />)}
          </>
        )}
      </main>
    </div>
  )
}
