// Right-panel Inspect card for one artboard (docs/simple-floorplan-2.md §2.6):
// name, ceiling height, total area, room list, and the Duplicate / Add / Delete artboard actions.
// Dark UI, built from the shared sidebar primitives in src/shell/panel.
import { useId } from 'react'
import { Copy, Frame, Plus, Trash2 } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { Artboard } from '../../model/types'
import {
  BTN,
  EmptyHint,
  FieldRow,
  MUTED,
  NumberField,
  PanelSection,
  ROW,
  ROW_OFF,
  ROW_ON,
  StatGrid,
  TextField,
  formatM2,
} from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { artboardAreaM2, roomAreaM2 } from './frame'
import { selectArtboard, selectRoom } from './selection'

export type ArtboardInspectProps = {
  /** Artboard to inspect. Falls back to the active artboard, then to the first artboard. */
  artboardId?: string | null
  className?: string
}

export function ArtboardInspect({ artboardId, className }: ArtboardInspectProps) {
  const artboards = useDoc((s) => s.doc.artboards)
  const activeArtboardId = useUi((s) => s.activeArtboardId)
  const selection = useUi((s) => s.selection)
  const nameId = useId()
  const ceilingId = useId()

  const wanted = artboardId ?? activeArtboardId
  const artboard: Artboard | undefined = artboards.find((a) => a.id === wanted) ?? artboards[0]
  if (!artboard) return null

  const areaM2 = artboardAreaM2(artboard)
  const onlyOne = artboards.length <= 1
  const selectedRooms = new Set(
    selection.kind === 'room' && selection.artboardId === artboard.id ? selection.roomIds : [],
  )

  const patch = (fn: (a: Artboard) => void) => {
    useDoc.getState().update((doc) => {
      const a = doc.artboards.find((x) => x.id === artboard.id)
      if (a) fn(a)
    })
  }

  const commitName = (value: string): boolean | void => {
    const name = value.trim()
    if (name === '') return false
    if (name === artboard.name) return
    patch((a) => { a.name = name })
  }

  const commitCeiling = (value: number | null): boolean | void => {
    if (value == null || !(value > 0)) return false
    if (value === artboard.ceilingHeightCm) return
    patch((a) => { a.ceilingHeightCm = value })
  }

  const duplicate = () => {
    const id = useDoc.getState().duplicateArtboard(artboard.id)
    if (id) selectArtboard(id)
  }

  const add = () => {
    const id = useDoc.getState().addArtboard()
    selectArtboard(id)
  }

  const remove = () => {
    const doc = useDoc.getState()
    if (doc.doc.artboards.length <= 1) return
    doc.deleteArtboard(artboard.id)
    const next = doc.doc.artboards[0]
    if (next) selectArtboard(next.id, 'none')
  }

  return (
    <PanelSection
      title="Artboard"
      icon={<Frame size={14} aria-hidden="true" />}
      className={className}
    >
      <FieldRow label="Name" htmlFor={nameId}>
        <TextField
          id={nameId}
          ariaLabel="Artboard name"
          value={artboard.name}
          onCommit={commitName}
          invalidMessage="Type a name for the artboard."
        />
      </FieldRow>

      <FieldRow label="Ceiling" htmlFor={ceilingId} hint="for the 3D view">
        <NumberField
          id={ceilingId}
          ariaLabel="Ceiling height"
          value={artboard.ceilingHeightCm}
          unit="cm"
          min={1}
          max={1000}
          onCommit={commitCeiling}
        />
      </FieldRow>

      <StatGrid
        items={[
          { label: 'Total area', value: `${formatM2(areaM2)} m²` },
          { label: artboard.rooms.length === 1 ? 'Room' : 'Rooms', value: String(artboard.rooms.length) },
        ]}
      />

      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400">Rooms</h3>
        {artboard.rooms.length === 0 ? (
          <EmptyHint>No room yet. Draw a room in Plan mode.</EmptyHint>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Rooms of the artboard">
            {artboard.rooms.map((r) => {
              const on = selectedRooms.has(r.id)
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => selectRoom(artboard.id, r.id)}
                    aria-pressed={on}
                    className={`${ROW} ${on ? ROW_ON : ROW_OFF} flex min-h-9 w-full items-center justify-between gap-2 text-left hover:bg-black/5 dark:hover:bg-white/5 pointer-coarse:min-h-11`}
                  >
                    <span className="truncate text-sm text-slate-800 dark:text-slate-100">
                      {r.name.trim() === '' ? 'Untitled room' : r.name}
                    </span>
                    <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`}>
                      {formatM2(roomAreaM2(r))} m²
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${BTN} flex-1`} onClick={duplicate} title="Duplicate artboard">
          <Copy size={14} aria-hidden="true" />
          Duplicate
        </button>
        <button type="button" className={`${BTN} flex-1`} onClick={add} title="Add an empty artboard">
          <Plus size={14} aria-hidden="true" />
          Add
        </button>
        <button
          type="button"
          className={`${BTN} flex-1 text-red-600 hover:bg-red-500/10 dark:text-red-400`}
          onClick={remove}
          disabled={onlyOne}
          title={onlyOne ? 'The document keeps at least one artboard' : 'Delete artboard'}
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete
        </button>
      </div>
    </PanelSection>
  )
}
