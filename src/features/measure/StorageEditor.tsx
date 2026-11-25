import { useState } from 'react'
import { useDoc } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { readStorageParams, type StorageDoor, type StorageParams } from '../storage/geometry'
import {
  DEFAULT_STORAGE_DOOR, DEFAULT_STORAGE_PARAMS, STORAGE_DOOR_OPTIONS, findFirstValidHostWall, moveStorageToWall,
  parentWallRuns, readStorageDoor, storageHostWallStart,
} from '../storage/ui'
import { NumField } from './NumField'

const sel = 'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-[15px] dark:border-slate-600 dark:bg-[#1b2128]'
const errCls = 'rounded-lg bg-orange-100 px-3 py-2 text-[13px] font-semibold text-orange-900 dark:bg-orange-950 dark:text-orange-200'

type ParamKey = keyof StorageParams
const PARAM_FIELDS: [ParamKey, string][] = [
  ['offsetCm', 'From start'],
  ['widthCm', 'Width'],
  ['depthCm', 'Depth'],
  ['sideCm', 'Side wall'],
  ['backCm', 'Back wall'],
]

function StorageRow({ doc, parent, storage }: { doc: PlanDoc; parent: Room; storage: Room }) {
  const [error, setError] = useState<string | null>(null)
  const wallRuns = parentWallRuns(parent)
  const params = readStorageParams(doc, storage)
  const door = readStorageDoor(doc, storage)
  const hostWallStart = storageHostWallStart(doc, storage)

  if (!params) return null

  const applyParams = (nextParams: StorageParams, nextDoor: StorageDoor = door) => {
    const res = useDoc.getState().updateStorage(storage.id, nextParams, nextDoor)
    setError(res.error ?? (res.warning ? `Warning: ${res.warning}` : null))
  }

  const onWallChange = (newWallStart: string) => {
    const res = moveStorageToWall(useDoc.getState().doc, storage, newWallStart, params, door)
    if ('error' in res) {
      setError(res.error)
      return
    }
    useDoc.getState().update(() => res.doc)
    setError(res.warning ? `Warning: ${res.warning}` : null)
  }

  return (
    <div
      className="flex flex-col gap-2.5 rounded-lg border border-slate-300 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-[#12161b]"
      data-storage-id={storage.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="storageWall"
          aria-label="Wall"
          className={sel}
          value={hostWallStart ?? ''}
          onChange={(e) => onWallChange(e.target.value)}
        >
          {wallRuns.map((r) => (
            <option key={r.wallStart} value={r.wallStart}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          name="storageDoor"
          aria-label="Door"
          className={sel}
          value={door}
          onChange={(e) => applyParams(params, e.target.value as StorageDoor)}
        >
          {STORAGE_DOOR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => useDoc.getState().deleteStorage(storage.id)}
          className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400"
        >
          Delete
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {PARAM_FIELDS.map(([key, label]) => (
          <label key={key} className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
            <NumField
              value={params[key]}
              allowZero={key === 'offsetCm'}
              ariaLabel={label}
              onValue={(n) => {
                if (n === null) return
                applyParams({ ...params, [key]: n })
              }}
            />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className={errCls}>
          {error}
        </p>
      )}
    </div>
  )
}

export function StorageEditor({ doc, room }: { doc: PlanDoc; room: Room }) {
  const [addError, setAddError] = useState<string | null>(null)
  const storages = doc.rooms.filter((r) => r.storage?.parentRoomId === room.id)

  const onAdd = () => {
    const found = findFirstValidHostWall(doc, room, DEFAULT_STORAGE_PARAMS, DEFAULT_STORAGE_DOOR)
    if ('error' in found) {
      setAddError(found.error)
      return
    }
    const res = useDoc.getState().addStorage(room.id, found.hostWall, DEFAULT_STORAGE_PARAMS, DEFAULT_STORAGE_DOOR)
    if ('error' in res) {
      setAddError(res.error)
      return
    }
    setAddError(res.warning ? `Warning: ${res.warning}` : null)
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm">Built-in storage</b>
        <button
          type="button"
          onClick={onAdd}
          className="min-h-11 rounded-lg border border-orange-600 px-3 text-sm font-semibold text-orange-700 dark:border-orange-400 dark:text-orange-400"
        >
          + Add built-in storage
        </button>
      </div>
      {addError && (
        <p role="alert" className={errCls}>
          {addError}
        </p>
      )}
      {storages.map((s) => (
        <StorageRow key={s.id} doc={doc} parent={room} storage={s} />
      ))}
    </div>
  )
}
