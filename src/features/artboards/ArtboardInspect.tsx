// Right-panel Inspect card for one artboard (docs/simple-floorplan-2.md §2.6):
// name, ceiling height, total area, room list, and the Duplicate / Add / Delete artboard actions.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Sub-headings reuse the
// panel LABEL style (12 px medium slate-300), one step above the 12 px slate-400 hints (L2/L3).
// The Export card (Phase 5) stays available in Plan AND Design mode: exporting changes no data.
import { useId, useState } from 'react'
import { Clipboard, Copy, Download, Frame, Image, Plus } from 'lucide-react'
import { useDoc } from '../../model/store'
import { MAX_WALL_THICKNESS_CM, MIN_WALL_THICKNESS_CM } from '../../model/types'
import type { Artboard, PrecisionCm } from '../../model/types'
import { wallThicknessOf } from '../rooms/walls'
import { renderArtboardSvg } from '../export/artboardSvg'
import { downloadArtboardPng, downloadArtboardSvg } from '../export/download'
import { toast } from '../toast'
import {
  BTN,
  DangerButton,
  EmptyHint,
  FieldRow,
  LABEL,
  MUTED,
  NumberField,
  PanelSection,
  ROW,
  ROW_OFF,
  ROW_ON,
  Segmented,
  StatGrid,
  TextField,
  formatM2,
} from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { NumInput } from '../rooms/NumInput'
import { MIN_ARTBOARD_HEIGHT_CM, MIN_ARTBOARD_WIDTH_CM, artboardAreaM2, artboardFrame, roomAreaM2 } from './frame'
import { selectArtboard, selectRoom } from './selection'

export type ArtboardInspectProps = {
  /** Artboard to inspect. Falls back to the active artboard, then to the first artboard. */
  artboardId?: string | null
  className?: string
  /**
   * Read-only card (Design mode): no name, ceiling, precision, room selection, duplicate, add or
   * delete edit. The measured values (area, room list) stay visible.
   */
  readOnly?: boolean
}

/** Drawing precision choices, in cm: fine (1 mm), half and whole centimetre. */
const PRECISION_OPTIONS = [
  { value: '0.1', label: '1 mm', title: 'Draw to 1 mm' },
  { value: '0.5', label: '5 mm', title: 'Draw to 5 mm' },
  { value: '1', label: '1 cm', title: 'Draw to 1 cm' },
] as const

export function ArtboardInspect({ artboardId, className, readOnly = false }: ArtboardInspectProps) {
  const artboards = useDoc((s) => s.doc.artboards)
  const projectTitle = useDoc((s) => s.doc.title)
  const activeArtboardId = useUi((s) => s.activeArtboardId)
  const mode = useUi((s) => s.mode)
  const selection = useUi((s) => s.selection)
  const nameId = useId()
  const ceilingId = useId()
  const wallId = useId()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const wanted = artboardId ?? activeArtboardId
  const artboard: Artboard | undefined = artboards.find((a) => a.id === wanted) ?? artboards[0]
  if (!artboard) return null

  const areaM2 = artboardAreaM2(artboard)
  const frame = artboardFrame(artboard)
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

  const commitWallThickness = (value: number | null): boolean | void => {
    if (value == null || !(value >= 0) || value > MAX_WALL_THICKNESS_CM) return false
    if (value === wallThicknessOf(artboard)) return
    patch((a) => { a.wallThicknessCm = value })
  }

  /** Move the frame so its left/top edge sits at the typed world cm (content stays inside it). */
  const commitFrameX = (value: number): boolean | void => {
    const dx = value - frame.x
    if (dx === 0) return
    patch((a) => { a.xCm += dx })
  }
  const commitFrameY = (value: number): boolean | void => {
    const dy = value - frame.y
    if (dy === 0) return
    patch((a) => { a.yCm += dy })
  }
  const commitFrameW = (value: number): boolean | void => {
    if (!(value >= MIN_ARTBOARD_WIDTH_CM)) return false
    patch((a) => { a.widthCm = value })
  }
  const commitFrameH = (value: number): boolean | void => {
    if (!(value >= MIN_ARTBOARD_HEIGHT_CM)) return false
    patch((a) => { a.heightCm = value })
  }

  const setPrecision = (value: string) => {
    const precisionCm = Number(value) as PrecisionCm
    if (precisionCm === artboard.precisionCm) return
    patch((a) => { a.precisionCm = precisionCm })
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
    const deletedName = artboard.name.trim() === '' ? 'artboard' : artboard.name
    doc.deleteArtboard(artboard.id)
    setConfirmingDelete(false)
    toast(`Deleted ${deletedName}`, { kind: 'info', actionLabel: 'Undo', onAction: () => useDoc.getState().undo() })
    // Read the artboards AFTER the delete: `doc.doc` is the document before it, so the old code
    // always selected the deleted artboard again (and the card showed nothing useful).
    const next = useDoc.getState().doc.artboards[0]
    if (next) selectArtboard(next.id, 'none')
  }

  // Export options: Design mode always shows the furniture; Plan mode only when there is some.
  const exportOptions = {
    projectTitle,
    includeFurniture: mode === 'design' || artboard.furniture.length > 0,
    includeWallLabels: true,
  }

  const exportSvg = () => {
    downloadArtboardSvg(artboard, exportOptions)
    toast('Exported SVG')
  }

  const copySvg = async () => {
    try {
      await navigator.clipboard.writeText(renderArtboardSvg(artboard, exportOptions).svg)
      toast('SVG copied')
    } catch (err) {
      toast(`Copy failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const exportPng = async () => {
    try {
      await downloadArtboardPng(artboard, exportOptions)
      toast('Exported PNG')
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <>
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
            disabled={readOnly}
            invalidMessage="Type a name for the artboard."
          />
        </FieldRow>

        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Artboard frame" data-testid="artboard-frame-form">
          {([
            ['X', frame.x, 'artboard-x-input', commitFrameX, undefined],
            ['Y', frame.y, 'artboard-y-input', commitFrameY, undefined],
            ['Width', frame.width, 'artboard-width-input', commitFrameW, MIN_ARTBOARD_WIDTH_CM],
            ['Height', frame.height, 'artboard-height-input', commitFrameH, MIN_ARTBOARD_HEIGHT_CM],
          ] as const).map(([label, value, testId, onCommit, min]) => (
            <label key={testId} className="flex flex-col gap-1">
              <span className={LABEL}>{label} (cm)</span>
              <NumInput testId={testId} ariaLabel={`Artboard ${label.toLowerCase()} (cm)`} value={value} min={min} disabled={readOnly} onCommit={onCommit} />
            </label>
          ))}
        </div>

        <FieldRow label="Ceiling" htmlFor={ceilingId} hint="for the 3D view">
          <NumberField
            id={ceilingId}
            ariaLabel="Ceiling height"
            value={artboard.ceilingHeightCm}
            unit="cm"
            min={1}
            max={1000}
            disabled={readOnly}
            onCommit={commitCeiling}
          />
        </FieldRow>

        <FieldRow label="Wall thickness" htmlFor={wallId} hint="0 = thin walls">
          <NumberField
            id={wallId}
            ariaLabel="Wall thickness (cm)"
            value={wallThicknessOf(artboard)}
            unit="cm"
            min={MIN_WALL_THICKNESS_CM}
            max={MAX_WALL_THICKNESS_CM}
            disabled={readOnly}
            onCommit={commitWallThickness}
          />
        </FieldRow>

        <FieldRow label="Precision" hint="drawing step">
          <Segmented
            options={PRECISION_OPTIONS}
            value={String(artboard.precisionCm)}
            onChange={setPrecision}
            ariaLabel="Drawing precision"
            size="sm"
            disabled={readOnly}
          />
        </FieldRow>

        <StatGrid
          items={[
            { label: 'Total area', value: `${formatM2(areaM2)} m²` },
            { label: artboard.rooms.length === 1 ? 'Room' : 'Rooms', value: String(artboard.rooms.length) },
          ]}
        />

        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>Rooms</h3>
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
                      disabled={readOnly}
                      aria-pressed={on}
                      className={`${ROW} ${on ? ROW_ON : ROW_OFF} flex min-h-9 w-full items-center justify-between gap-2 text-left hover:bg-white/5 pointer-coarse:min-h-11`}
                    >
                      <span className="truncate text-sm text-slate-100">
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

        {readOnly && (
          <EmptyHint>Read-only in Design mode. Switch to Plan mode to rename, duplicate, add or delete artboards.</EmptyHint>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${BTN} flex-1`}
            onClick={duplicate}
            disabled={readOnly}
            title={readOnly ? 'Switch to Plan mode to edit the artboard' : 'Duplicate artboard'}
          >
            <Copy size={14} aria-hidden="true" />
            Duplicate
          </button>
          <button
            type="button"
            className={`${BTN} flex-1`}
            onClick={add}
            disabled={readOnly}
            title={readOnly ? 'Switch to Plan mode to edit the artboard' : 'Add an empty artboard'}
          >
            <Plus size={14} aria-hidden="true" />
            Add
          </button>
        </div>

        <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
          {confirmingDelete && !readOnly && !onlyOne ? (
            <div role="group" aria-label="Confirm artboard delete" className="flex flex-col gap-2">
              <p className="text-sm text-slate-100">Delete artboard?</p>
              <EmptyHint>
                {`This also deletes its ${artboard.rooms.length} room${artboard.rooms.length === 1 ? '' : 's'}, ${artboard.openings.length} opening${artboard.openings.length === 1 ? '' : 's'} and ${artboard.furniture.length} furniture item${artboard.furniture.length === 1 ? '' : 's'}. You can undo it.`}
              </EmptyHint>
              <div className="flex gap-2">
                <DangerButton className="flex-1" onClick={remove}>
                  Yes
                </DangerButton>
                <button type="button" className={`${BTN} flex-1`} onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <DangerButton
              onClick={() => setConfirmingDelete(true)}
              disabled={onlyOne || readOnly}
            >
              Delete artboard
            </DangerButton>
          )}
          {onlyOne && !readOnly && <EmptyHint>The document keeps at least one artboard.</EmptyHint>}
        </div>
      </PanelSection>

      <PanelSection title="Export" icon={<Download size={14} aria-hidden="true" />}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${BTN} flex-1`}
            onClick={exportPng}
            title="Download this artboard as a PNG picture"
          >
            <Image size={14} aria-hidden="true" />
            Export PNG
          </button>
          <button
            type="button"
            className={`${BTN} flex-1`}
            onClick={exportSvg}
            title="Download this artboard as an SVG file"
          >
            <Download size={14} aria-hidden="true" />
            Export SVG
          </button>
          <button
            type="button"
            className={`${BTN} flex-1`}
            data-testid="copy-svg-btn"
            aria-label="Copy SVG"
            onClick={copySvg}
            title="Copy this artboard as SVG text"
          >
            <Clipboard size={14} aria-hidden="true" />
            Copy SVG
          </button>
        </div>
      </PanelSection>
    </>
  )
}
