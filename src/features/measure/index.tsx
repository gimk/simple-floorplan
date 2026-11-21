// OWNER: measure agent. Contract: keep this export name.
import { useEffect, useState } from 'react'
import { ArrowDownCircle, Monitor, Sun } from 'lucide-react'
import { useDoc, useUi } from '../../model/store'
import { allSurveyIds, roomsInWalkOrder } from '../../model/survey'
import { loadDemoApartment } from './demo'
import { docProgress, nextUnmeasuredLabel, roomHasMissing, roomIsFlagged } from './logic'
import { inputId } from './actions'
import { Overview } from './Overview'
import { RoomCard } from './RoomCard'
import { useSyncStatus } from './useSyncStatus'
import { useWakeLock } from './useWakeLock'
import { VoiceButton } from './VoiceButton'

type Filter = 'all' | 'missing' | 'flagged'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'missing', label: 'Missing' },
  { id: 'flagged', label: 'Flagged' },
]

const readFlag = (key: string, def: boolean) => {
  try {
    if (typeof localStorage === 'undefined') return def
    const v = localStorage.getItem(key)
    return v == null ? def : v === '1'
  } catch { return def }
}

/** Full-screen Measuring Mode (mobile-first). Rendered instead of the editor when ui.mode === 'measure'. */
export function MeasureMode() {
  const doc = useDoc((s) => s.doc)
  const status = useSyncStatus()
  const allRooms = roomsInWalkOrder(doc)
  const labels = allSurveyIds(doc).map((s) => s.label)
  const { done, total } = docProgress(doc)
  const hasRooms = allRooms.length > 0

  const [filter, setFilter] = useState<Filter>('all')
  const [keepOn, setKeepOn] = useState(() => readFlag('measure-keep-screen-on', true))
  const [sunlight, setSunlight] = useState(() => readFlag('measure-sunlight', false))
  useWakeLock(keepOn)

  const toggle = (key: string, set: (v: boolean) => void) => (v: boolean) => {
    set(v)
    try { localStorage.setItem(key, v ? '1' : '0') } catch { /* private mode */ }
  }

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
    const current = active instanceof HTMLElement && active.id.startsWith('m-') ? active.id.slice(2) : null
    const nx = nextUnmeasuredLabel(doc, labels, current)
    if (!nx) return
    const code = nx.slice(0, nx.lastIndexOf('-'))
    document.getElementById(`room-${code}`)?.scrollIntoView({ block: 'start' })
    const el = document.getElementById(inputId(nx)) as HTMLInputElement | null
    if (el) { el.focus(); el.select(); el.scrollIntoView({ block: 'center' }) }
  }

  return (
    <div className={`min-h-full bg-[#f6f7f5] text-[#1b2430] dark:bg-[#12161b] dark:text-[#e8ecef] ${sunlight ? 'sunlight' : ''}`}>
      {/* ONE compact sticky header for Measuring Mode (the app shell hides its own header in this mode). */}
      <header className="sticky top-0 z-10 border-b border-slate-300 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-[#1b2128]/95">
        <div className="mx-auto max-w-[560px] px-4 pb-2 pt-1.5">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-bold">{doc.title}</h1>
            <span className="flex-none font-mono text-sm text-slate-500 dark:text-slate-400" aria-label="Measured of total">{done} / {total}</span>
            <VoiceButton labels={labels} />
            <button
              type="button" onClick={jumpNextUnmeasured} aria-label="Next unmeasured field"
              title="Next unmeasured"
              className="flex h-9 min-w-9 flex-none items-center justify-center rounded-lg border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
            ><ArrowDownCircle size={17} /></button>
            <button
              type="button" onClick={() => useUi.getState().setMode('edit')}
              className="flex h-9 flex-none items-center gap-1.5 rounded-lg border border-orange-600 px-2.5 text-[13px] font-semibold text-orange-700 dark:border-orange-400 dark:text-orange-400"
            ><Monitor size={15} /> Edit Mode</button>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Measuring progress"
          >
            <div className="h-full bg-green-600 transition-[width] motion-reduce:transition-none dark:bg-green-400" style={{ width: `${total ? (100 * done) / total : 0}%` }} />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">{status}</span>
            <span role="group" aria-label="Filter rooms" className="flex flex-none overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
              {FILTERS.map((f) => (
                <button
                  key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                  className={`min-h-9 px-2 text-xs font-semibold ${filter === f.id ? 'bg-orange-600 text-white' : 'bg-white text-slate-600 dark:bg-[#12161b] dark:text-slate-300'}`}
                >{f.label}</button>
              ))}
            </span>
            <button
              type="button" onClick={() => toggle('measure-keep-screen-on', setKeepOn)(!keepOn)}
              aria-pressed={keepOn} title="Keep screen on"
              className={`flex h-9 min-w-9 flex-none items-center justify-center rounded-lg border ${keepOn ? 'border-green-700 text-green-700 dark:border-green-400 dark:text-green-400' : 'border-slate-300 text-slate-400 dark:border-slate-600'}`}
            >🔒</button>
            <button
              type="button" onClick={() => toggle('measure-sunlight', setSunlight)(!sunlight)}
              aria-pressed={sunlight} aria-label="Sunlight high-contrast mode" title="Sunlight (high contrast)"
              className={`flex h-9 min-w-9 flex-none items-center justify-center rounded-lg border ${sunlight ? 'border-yellow-500 bg-yellow-300 text-black' : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'}`}
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
          </>
        )}
      </main>
    </div>
  )
}
