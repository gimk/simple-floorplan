// Left-panel content of Plan mode (docs/simple-floorplan-2.md §2.4):
//   - "Architectural Objects": Door / Window / Opening picker buttons. A click arms the
//     place-opening tool with that kind; a second click on the active item goes back to Select.
//   - "Reference Images": the canvas images of the project, one click to select one, plus a
//     compact "Upload image / PDF" button (the upload itself belongs to the shell).
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { DoorOpen, Eye, EyeOff, Frame, ImagePlus, Lock, LockOpen, RectangleHorizontal } from 'lucide-react'
import { useDoc } from '../../model/store'
import type { OpeningKind } from '../../model/types'
import { BTN, BTN_PRIMARY, EmptyHint, INPUT, IconButton, LABEL, MUTED, PanelSection, ROW, ROW_OFF, ROW_ON } from '../../shell/panel'
import { newId } from '../../model/schema'
import { selectRoom } from '../artboards/selection'
import { addRoom } from '../rooms/actions'
import { NumInput } from '../rooms/NumInput'
import { createRectRoom, nextRoomName } from '../rooms/ops'
import { useUi } from '../../shell/uiStore'
import { DEFAULT_OPENING_WIDTH_CM } from './geometry'
import { PLACE_HINTS } from './placeHints'

export type ObjectsPanelProps = {
  /** Opens the shell file picker (PNG / JPG / WebP / SVG / PDF). */
  onUploadImage?: () => void
}

type PickerItem = {
  kind: OpeningKind
  label: string
  /** Small line under the label: the default width used by a new opening. */
  detail: string
  /** Styles the Inspect card offers for this kind (none for a plain opening). */
  styles?: string
  icon: ReactNode
}

const PICKERS: readonly PickerItem[] = [
  {
    kind: 'door',
    label: 'Door',
    detail: `${DEFAULT_OPENING_WIDTH_CM.door} cm`,
    styles: 'Standard · French · Pocket · Bypass',
    icon: <DoorOpen size={16} aria-hidden="true" />,
  },
  {
    kind: 'window',
    label: 'Window',
    detail: `${DEFAULT_OPENING_WIDTH_CM.window} cm`,
    styles: 'Fixed · Sliding · Casement · Double',
    icon: <Frame size={16} aria-hidden="true" />,
  },
  {
    kind: 'opening',
    label: 'Opening',
    detail: `${DEFAULT_OPENING_WIDTH_CM.opening} cm`,
    icon: <RectangleHorizontal size={16} aria-hidden="true" />,
  },
]

/**
 * Arm the place-opening tool with `kind`, or go back to Select when that kind is already armed
 * (clicking the active item toggles).
 */
function pick(kind: OpeningKind, armed: boolean): void {
  const ui = useUi.getState()
  if (armed) {
    ui.set({ tool: 'select', placingOpeningKind: null })
    return
  }
  ui.set({ tool: 'place-opening', placingOpeningKind: kind })
}

/** One picker button: icon, label, default width; `aria-pressed` when its tool is armed. */
function PickerButton({ item, armed }: { item: PickerItem; armed: boolean }) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={armed}
        aria-label={`Place ${item.label.toLowerCase()}`}
        title={`Place: ${item.label} (default ${item.detail})`}
        onClick={() => pick(item.kind, armed)}
        className={`${ROW} flex min-h-9 w-full items-center gap-2 text-left pointer-coarse:min-h-11 ${
          armed ? ROW_ON : `${ROW_OFF} hover:bg-black/5 dark:hover:bg-white/10`
        }`}
      >
        <span className="shrink-0 text-slate-600 dark:text-slate-300">{item.icon}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-slate-800 dark:text-slate-100">{item.label}</span>
          {item.styles && <span className={`truncate ${MUTED}`}>{item.styles}</span>}
        </span>
        <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`}>{item.detail}</span>
      </button>
    </li>
  )
}

/** Artboard that receives a new room: the active one, else the first. */
function targetArtboard() {
  const { doc } = useDoc.getState()
  return doc.artboards.find((a) => a.id === useUi.getState().activeArtboardId) ?? doc.artboards[0]
}

/** Parse "0,0 400,0 400,300 0,300" into points (each point is "x,y"). Null when under 3 points or junk remains. */
function parsePoints(text: string): { x: number; y: number }[] | null {
  const re = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g
  const pts = [...text.matchAll(re)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
  if (text.replace(re, '').replace(/[\s;]+/g, '') !== '') return null
  return pts.length >= 3 ? pts : null
}

/** Numeric "Add room" form: rectangle by X / Y / width / depth, or a polygon from a points string. */
function AddRoomForm() {
  const [name, setName] = useState('')
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const [w, setW] = useState(400)
  const [d, setD] = useState(300)
  const [points, setPoints] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submitRect = () => {
    const ab = targetArtboard()
    if (!ab) return
    if (!(w >= 10) || !(d >= 10)) { setError('Width and depth must be at least 10 cm.'); return }
    const room = createRectRoom({ x, y }, { x: x + w, y: y + d }, name.trim() || nextRoomName(ab.rooms))
    addRoom(ab.id, room)
    selectRoom(ab.id, room.id)
    setName('')
    setError(null)
  }

  const submitPolygon = () => {
    const ab = targetArtboard()
    if (!ab) return
    const vertices = parsePoints(points.trim())
    if (!vertices) { setError('Type at least 3 points like 0,0 400,0 400,300 0,300.'); return }
    const room = { id: newId(), name: name.trim() || nextRoomName(ab.rooms), vertices }
    addRoom(ab.id, room)
    selectRoom(ab.id, room.id)
    setPoints('')
    setError(null)
  }

  const field = (label: string, testId: string, value: number, set: (v: number) => void, min?: number) => (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <NumInput testId={testId} ariaLabel={label} value={value} min={min} onCommit={(v) => { set(v) }} />
    </label>
  )

  return (
    <PanelSection title="Add Room">
      <form
        data-testid="add-room-form"
        className="flex flex-col gap-2"
        aria-label="Add room"
        onSubmit={(e) => { e.preventDefault(); submitRect() }}
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name</span>
          <input
            data-testid="add-room-name" type="text" className={INPUT} value={name} placeholder="Room 1"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {field('X (cm)', 'add-room-x', x, setX)}
          {field('Y (cm)', 'add-room-y', y, setY)}
          {field('Width (cm)', 'add-room-width', w, setW, 10)}
          {field('Depth (cm)', 'add-room-depth', d, setD, 10)}
        </div>
        <button type="submit" data-testid="add-room-submit" className={BTN_PRIMARY}>Add room</button>
      </form>
      <details className="flex flex-col gap-2" data-testid="add-polygon-details">
        <summary className={`cursor-pointer ${MUTED}`}>By points</summary>
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Points (x,y in cm)</span>
            <input
              data-testid="add-polygon-input" type="text" className={INPUT} value={points}
              placeholder="0,0 400,0 400,300 0,300"
              onChange={(e) => setPoints(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitPolygon() } }}
            />
          </label>
          <button type="button" data-testid="add-polygon-submit" className={BTN} onClick={submitPolygon}>Add polygon room</button>
        </div>
      </details>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </PanelSection>
  )
}

/** Left panel of Plan mode: the opening picker and the reference image list. */
export function ObjectsPanel({ onUploadImage }: ObjectsPanelProps) {
  const refImages = useDoc((s) => s.doc.refImages)
  const tool = useUi((s) => s.tool)
  const placingKind = useUi((s) => s.placingOpeningKind)
  const selection = useUi((s) => s.selection)
  const placing = tool === 'place-opening'
  const selectedImageId = selection.kind === 'refImage' ? selection.imageId : null

  const selectImage = (imageId: string) => {
    useUi.getState().set({ selection: { kind: 'refImage', imageId } })
  }

  return (
    <>
      <PanelSection title="Architectural Objects">
        <ul className="flex flex-col gap-1" aria-label="Architectural objects">
          {PICKERS.map((item) => (
            <PickerButton
              key={item.kind}
              item={item}
              armed={placing && placingKind === item.kind}
            />
          ))}
        </ul>
        {placing && placingKind ? (
          <EmptyHint>{PLACE_HINTS[placingKind]}</EmptyHint>
        ) : (
          <EmptyHint>Pick an object, then click a wall of a room. Choose the style in the Inspect panel after placing.</EmptyHint>
        )}
      </PanelSection>

      <AddRoomForm />

      <PanelSection title="Reference Images">
        {refImages.length === 0 ? (
          <>
            <EmptyHint>No reference image yet. Trace a scan or a photo of your plan.</EmptyHint>
            {onUploadImage ? (
              <button type="button" className={BTN_PRIMARY} onClick={onUploadImage}>
                <ImagePlus size={14} aria-hidden="true" />
                Upload image
              </button>
            ) : (
              <EmptyHint>Image upload is not available in this view.</EmptyHint>
            )}
          </>
        ) : (
          <>
            <ul className="flex flex-col gap-1" aria-label="Reference images">
              {refImages.map((img) => {
                const on = img.id === selectedImageId
                const name = img.name.trim() === '' ? 'Untitled image' : img.name
                return (
                  <li key={img.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`Select reference image ${name}`}
                      title={img.locked ? 'This image is locked' : 'Select this image'}
                      onClick={() => selectImage(img.id)}
                      className={`${ROW} flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left ${
                        on ? ROW_ON : `${ROW_OFF} hover:bg-black/5 dark:hover:bg-white/10`
                      }`}
                    >
                      <img
                        src={img.src}
                        alt=""
                        width={32}
                        height={32}
                        className={`h-8 w-8 shrink-0 rounded border border-black/10 bg-black/5 object-cover dark:border-white/10 ${img.visible ? '' : 'opacity-40'}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{name}</span>
                      {!img.visible && <span className={`shrink-0 ${MUTED}`}>hidden</span>}
                    </button>
                    <IconButton
                      label={img.visible ? `Hide ${name}` : `Show ${name}`}
                      pressed={!img.visible}
                      icon={img.visible ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
                      onClick={() => useDoc.getState().updateRefImage(img.id, { visible: !img.visible })}
                    />
                    <IconButton
                      label={img.locked ? `Unlock ${name}` : `Lock ${name}`}
                      pressed={img.locked}
                      icon={img.locked ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
                      onClick={() => useDoc.getState().updateRefImage(img.id, { locked: !img.locked })}
                    />
                  </li>
                )
              })}
            </ul>

            <button
              type="button"
              className={BTN}
              onClick={onUploadImage}
              disabled={!onUploadImage}
              title={onUploadImage ? 'Upload an image or a PDF page as a reference image' : 'Image upload is not available in this view'}
            >
              <ImagePlus size={14} aria-hidden="true" />
              Upload image / PDF
            </button>
            {!onUploadImage && <EmptyHint>Image upload is not available in this view.</EmptyHint>}
          </>
        )}
      </PanelSection>
    </>
  )
}
