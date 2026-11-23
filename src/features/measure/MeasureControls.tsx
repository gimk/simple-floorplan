// Pieces shared by the full-screen Measuring Mode (phones) and the desktop measure panel.
import { useEffect, useState } from 'react'
import { Cloud, CloudOff, KeyRound } from 'lucide-react'
import { normalizeDoorHosts } from '../../core/doorHost'
import { useDoc } from '../../model/store'
import { getSyncState, setPasscode, useSyncState, useSyncStatusText } from '../../sync/sync'

export type Filter = 'all' | 'missing' | 'flagged'
export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'missing', label: 'Missing' },
  { id: 'flagged', label: 'Flagged' },
]

export const readFlag = (key: string, def: boolean) => {
  try {
    if (typeof localStorage === 'undefined') return def
    const v = localStorage.getItem(key)
    return v == null ? def : v === '1'
  } catch { return def }
}

/** A boolean setting that is saved in localStorage. */
export function useStoredFlag(key: string, def: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => readFlag(key, def))
  const set = (v: boolean) => {
    setValue(v)
    try { localStorage.setItem(key, v ? '1' : '0') } catch { /* private mode */ }
  }
  return [value, set]
}

/**
 * Canonical door hosts: old plans may hold a door that opens out of its own room. Fix them once,
 * as ONE undoable update, when Measuring Mode opens (the rule is idempotent, so a second run is a no-op).
 */
export function useNormalizeDoorHosts() {
  useEffect(() => {
    const { doc: fixed, moved } = normalizeDoorHosts(useDoc.getState().doc)
    if (moved.length) useDoc.getState().update(() => fixed)
  }, [])
}

/** Sync status line, or the passcode form when the sync is locked. */
export function SyncLine() {
  const { text: status, warn: statusWarn } = useSyncStatusText()
  const sync = useSyncState()
  const [unlocking, setUnlocking] = useState(false)
  const [passErr, setPassErr] = useState('')
  useEffect(() => {
    if (sync.conn !== 'locked') { setPassErr(''); setUnlocking(false) }
  }, [sync.conn])

  if (sync.conn === 'locked') {
    return (
      <form
        className="relative flex min-w-0 flex-1 items-center gap-1"
        onSubmit={async (e) => {
          e.preventDefault()
          const v = new FormData(e.currentTarget).get('p')
          if (!v || unlocking) return
          setPassErr('')
          setUnlocking(true)
          await setPasscode(String(v))
          setUnlocking(false)
          if (getSyncState().conn === 'locked') setPassErr('Passcode rejected')
        }}
      >
        <KeyRound size={15} className="shrink-0 text-orange-700 dark:text-orange-400" />
        <input
          name="p" type="password" placeholder="Passcode" autoComplete="current-password" aria-label="Sync passcode"
          className="min-h-11 w-24 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-[#12161b]"
        />
        <button type="submit" disabled={unlocking} className="min-h-11 rounded-lg bg-orange-700 px-2.5 text-xs font-semibold text-white hover:bg-orange-800 disabled:opacity-50">
          {unlocking ? '…' : 'Unlock'}
        </button>
        {passErr && (
          <span role="alert" className="absolute left-0 top-full z-20 mt-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800 shadow dark:bg-red-900/60 dark:text-red-200">
            {passErr}
          </span>
        )}
      </form>
    )
  }
  return (
    <span
      className={`flex min-w-0 flex-1 items-center gap-1 text-xs ${statusWarn ? 'text-orange-700 dark:text-orange-400' : 'text-emerald-700 dark:text-emerald-400'}`}
      aria-label={status}
      title={status}
    >
      {statusWarn ? <CloudOff size={16} className="shrink-0" /> : <Cloud size={16} className="shrink-0" />}
      <span className="hidden truncate text-slate-500 sm:inline dark:text-slate-400">{status}</span>
    </span>
  )
}

/** The All | Missing | Flagged switch. */
export function FilterGroup({ filter, onChange }: { filter: Filter; onChange: (f: Filter) => void }) {
  return (
    <span role="group" aria-label="Filter rooms" className="flex flex-none overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
      {FILTERS.map((f) => (
        <button
          key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => onChange(f.id)}
          className={`min-h-11 px-2 text-xs font-semibold sm:px-2.5 ${filter === f.id ? 'bg-orange-700 text-white' : 'bg-white text-slate-600 dark:bg-[#12161b] dark:text-slate-300'}`}
        >{f.label}</button>
      ))}
    </span>
  )
}
