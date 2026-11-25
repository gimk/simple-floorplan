import { useState } from 'react'
import { Archive, Trash2 } from 'lucide-react'
import { fmtCm, roomWalls } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { EmptyHint, ERROR, FieldRow, IconButton, NumberField, PanelSection, SelectField } from '../../shell/panel'
import { readStorageParams, type StorageDoor, type StorageParams } from '../storage/geometry'
import {
  moveStorageToWall, readStorageDoor, STORAGE_DOOR_OPTIONS, storageHostWallStart,
} from '../storage/ui'
import { undoToast } from '../toast'

type ParamField = { key: keyof StorageParams; label: string; min: number }
const PARAM_FIELDS: ParamField[] = [
  { key: 'offsetCm', label: 'From start', min: 0 },
  { key: 'widthCm', label: 'Width', min: 1 },
  { key: 'depthCm', label: 'Depth', min: 1 },
  { key: 'sideCm', label: 'Side wall', min: 1 },
  { key: 'backCm', label: 'Back wall', min: 1 },
]

function StorageInspector({ doc, room }: { doc: PlanDoc; room: Room }) {
  const [error, setError] = useState<string | null>(null)
  const parent = doc.rooms.find((r) => r.id === room.storage?.parentRoomId)
  const params = readStorageParams(doc, room)
  const door = readStorageDoor(doc, room)
  const hostWallStart = storageHostWallStart(doc, room)
  const parentWalls = parent ? roomWalls(parent) : []

  const applyParams = (nextParams: StorageParams, nextDoor: StorageDoor = door) => {
    const res = useDoc.getState().updateStorage(room.id, nextParams, nextDoor)
    setError(res.error ?? null)
  }

  const onWallChange = (newWallStart: string) => {
    if (!params) return
    const res = moveStorageToWall(useDoc.getState().doc, room, newWallStart, params, door)
    if ('error' in res) {
      setError(res.error)
      return
    }
    useDoc.getState().update(() => res.doc)
    setError(null)
  }

  const onDelete = () => {
    useDoc.getState().deleteStorage(room.id)
    useUi.getState().select(parent ? { kind: 'room', roomId: parent.id } : null)
    undoToast('Built-in storage deleted', () => useDoc.temporal.getState().undo())
  }

  return (
    <PanelSection
      id="room-storage"
      title="Built-in storage"
      icon={<Archive size={16} />}
      actions={<IconButton label="Delete built-in storage" variant="danger" icon={<Trash2 size={16} />} onClick={onDelete} />}
    >
      <FieldRow label="Parent room">
        {parent ? (
          <button
            type="button"
            onClick={() => useUi.getState().select({ kind: 'room', roomId: parent.id })}
            className="text-left text-sm font-medium text-orange-700 underline hover:no-underline dark:text-orange-400"
          >
            {parent.name} ({parent.code})
          </button>
        ) : (
          <span className="text-sm text-slate-500 dark:text-slate-400">Unknown</span>
        )}
      </FieldRow>

      {params && parent && (
        <>
          <FieldRow label="Wall" htmlFor="storage-wall">
            <SelectField
              id="storage-wall"
              name="storage-wall"
              value={hostWallStart ?? ''}
              options={parentWalls.map((w) => ({ value: w.start.id, label: `on ${parent.code}-${w.index + 1}` }))}
              onChange={onWallChange}
            />
          </FieldRow>
          {PARAM_FIELDS.map(({ key, label, min }) => (
            <FieldRow key={key} label={label} htmlFor={`storage-${key}`}>
              <NumberField
                id={`storage-${key}`}
                name={`storage-${key}`}
                unit="cm"
                value={params[key]}
                min={min}
                onCommit={(v) => {
                  if (v === null) return false
                  applyParams({ ...params, [key]: v })
                }}
              />
            </FieldRow>
          ))}
          <FieldRow label="Door" htmlFor="storage-door">
            <SelectField
              id="storage-door"
              name="storage-door"
              value={door}
              options={STORAGE_DOOR_OPTIONS}
              onChange={(v) => applyParams(params, v as StorageDoor)}
            />
          </FieldRow>
        </>
      )}

      {error && (
        <p role="alert" className={ERROR}>
          {error}
        </p>
      )}
    </PanelSection>
  )
}

function ParentStorageList({ doc, room }: { doc: PlanDoc; room: Room }) {
  const storages = doc.rooms.filter((r) => r.storage?.parentRoomId === room.id)
  return (
    <PanelSection id="room-storages" title="Built-in storage" icon={<Archive size={16} />} collapsible>
      {storages.length === 0 ? (
        <EmptyHint>No built-in storage in this room yet.</EmptyHint>
      ) : (
        <ul className="flex flex-col gap-1">
          {storages.map((s) => {
            const p = readStorageParams(doc, s)
            const size = p ? `${fmtCm(p.widthCm)} × ${fmtCm(p.depthCm)} cm` : ''
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => useUi.getState().select({ kind: 'room', roomId: s.id })}
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-black/5 pointer-coarse:min-h-11 dark:hover:bg-white/10"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  {size && <span className="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">{size}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </PanelSection>
  )
}

export function StoragePanelSection({ doc, room }: { doc: PlanDoc; room: Room }) {
  return room.storage ? <StorageInspector doc={doc} room={room} /> : <ParentStorageList doc={doc} room={room} />
}
