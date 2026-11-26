// Right-panel Inspect card for one selected opening (docs/simple-floorplan-2.md §2.6):
// breadcrumb back to the artboard, the kind (door / window / opening), the width in cm,
// the hinge and swing flips (doors only) and Delete.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm.
import { ChevronLeft, DoorOpen, FlipHorizontal2, FlipVertical2, Frame, RectangleHorizontal, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDoc } from '../../model/store'
import type { Artboard, Opening, OpeningKind } from '../../model/types'
import { BTN, FieldRow, MUTED, NumberField, PanelSection, Segmented } from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { selectArtboard } from '../artboards/selection'
import { deleteOpening, flipOpeningHinge, flipOpeningSwing, updateOpening } from './actions'
import { MAX_OPENING_WIDTH_CM, MIN_OPENING_WIDTH_CM } from './geometry'

export type OpeningInspectProps = {
  /** Artboard that holds the opening. */
  artboardId: string
  /** Opening to inspect. Unknown ids render nothing. */
  openingId: string
  className?: string
}

const KIND_LABEL: Record<OpeningKind, string> = { door: 'Door', window: 'Window', opening: 'Opening' }

const KIND_ICON: Record<OpeningKind, ReactNode> = {
  door: <DoorOpen size={14} aria-hidden="true" />,
  window: <Frame size={14} aria-hidden="true" />,
  opening: <RectangleHorizontal size={14} aria-hidden="true" />,
}

const KIND_OPTIONS = [
  { value: 'door', label: 'Door' },
  { value: 'window', label: 'Window' },
  { value: 'opening', label: 'Opening' },
] as const

/** Clear the selection after a delete, so the Inspect panel falls back to the artboard. */
function clearSelection(): void {
  useUi.getState().set({ selection: { kind: 'none' } })
}

/** Small "back" line above the card: the artboard name, one click back to the Artboard card. */
function BackToArtboard({ artboard }: { artboard: Artboard }) {
  const label = artboard.name.trim() === '' ? 'Untitled artboard' : artboard.name
  return (
    <button
      type="button"
      aria-label="Back to artboard"
      title="Back to artboard"
      onClick={() => selectArtboard(artboard.id)}
      className={`flex min-h-9 w-fit max-w-full items-center gap-1 rounded-md px-1 hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11 ${MUTED}`}
    >
      <ChevronLeft size={12} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * Inspect card of one opening. Renders nothing when the artboard or the opening is unknown, so
 * the shell can mount it unconditionally.
 */
export function OpeningInspect({ artboardId, openingId, className }: OpeningInspectProps) {
  const artboard = useDoc((s) => s.doc.artboards.find((a) => a.id === artboardId))
  const opening: Opening | undefined = artboard?.openings.find((o) => o.id === openingId)
  if (!artboard || !opening) return null

  const kind = opening.kind
  const isDoor = kind === 'door'

  const setKind = (value: string) => {
    if (value === kind) return
    updateOpening(artboard.id, opening.id, { kind: value as OpeningKind })
  }

  const setWidth = (value: number | null): boolean | void => {
    if (value == null) return false
    if (value === opening.widthCm) return
    updateOpening(artboard.id, opening.id, { widthCm: value })
  }

  const remove = () => {
    deleteOpening(artboard.id, opening.id)
    clearSelection()
  }

  return (
    <PanelSection title={KIND_LABEL[kind]} icon={KIND_ICON[kind]} className={className}>
      <BackToArtboard artboard={artboard} />

      <FieldRow label="Type" stacked>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} ariaLabel="Opening type" />
      </FieldRow>

      <FieldRow label="Width" hint="wall to wall">
        <NumberField
          ariaLabel="Opening width"
          unit="cm"
          min={MIN_OPENING_WIDTH_CM}
          max={MAX_OPENING_WIDTH_CM}
          value={opening.widthCm}
          onCommit={setWidth}
        />
      </FieldRow>

      {isDoor && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className={BTN}
            onClick={() => flipOpeningHinge(artboard.id, opening.id)}
            title="Move the hinge to the other end of the door"
          >
            <FlipHorizontal2 size={14} aria-hidden="true" />
            Flip Hinge
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => flipOpeningSwing(artboard.id, opening.id)}
            title="Open the door to the other side of the wall"
          >
            <FlipVertical2 size={14} aria-hidden="true" />
            Flip Swing
          </button>
        </div>
      )}

      <button
        type="button"
        className={`${BTN} text-red-600 hover:bg-red-500/10 dark:text-red-400`}
        onClick={remove}
        title={`Delete this ${KIND_LABEL[kind].toLowerCase()}`}
      >
        <Trash2 size={14} aria-hidden="true" />
        {`Delete ${KIND_LABEL[kind]}`}
      </button>
    </PanelSection>
  )
}
