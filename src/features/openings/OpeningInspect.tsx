// Right-panel Inspect card for one selected opening (docs/simple-floorplan-2.md §2.6):
// breadcrumb back to the artboard, the kind (door / window / opening), the style variant, the width
// in cm, the hinge and swing flips (only where the style has them) and Delete.
// Dark UI, built from the shared sidebar primitives in src/shell/panel. Units: cm.
import { Copy, DoorOpen, Frame, RectangleHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDoc } from '../../model/store'
import type { Artboard, Opening, OpeningKind, OpeningVariant } from '../../model/types'
import {
  BTN,
  BackLink,
  DangerButton,
  EmptyHint,
  FieldRow,
  NumberField,
  PanelSection,
  Segmented,
  SelectField,
  ROW,
  ROW_OFF,
  ROW_ON,
} from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { selectArtboard } from '../artboards/selection'
import { roomWalls } from '../rooms/ops'
import type { Wall } from '../rooms/ops'
import { toast } from '../toast'
import { addOpening, deleteOpening, updateOpening } from './actions'
import { MAX_OPENING_WIDTH_CM, MIN_OPENING_WIDTH_CM, openingVariant } from './geometry'
import { hostWallIn } from './sync'

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

/** Door styles. French doors are symmetric, the two sliding styles slide in the plane of the wall. */
const DOOR_VARIANT_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'french', label: 'French (double)' },
  { value: 'pocket', label: 'Pocket sliding' },
  { value: 'bypass', label: 'Bypass sliding' },
] as const

/** Window styles. The two casement styles add swinging leaves to the frame, like a door leaf. */
const WINDOW_VARIANT_OPTIONS = [
  { value: 'standard', label: 'Standard (fixed)' },
  { value: 'sliding', label: 'Sliding' },
  { value: 'casement', label: 'Single casement' },
  { value: 'double-casement', label: 'Double casement' },
] as const

/**
 * The wall that hosts the opening, with the distance of the opening centre from the wall start.
 * Same host as the canvas (`hostWallIn`): when two rooms are flush the opening stays on the wall of
 * the room it belongs to (`roomId`).
 */
function hostWallOf(artboard: Artboard, opening: Opening): { wall: Wall; centreCm: number } | null {
  const host = hostWallIn(artboard.rooms, opening)
  if (!host) return null
  const wall = roomWalls(host.room)[host.edgeIndex]
  return wall ? { wall, centreCm: host.t * wall.lengthCm } : null
}

type Hinge = 'left' | 'right'
type Swing = 'in' | 'out'

/** Mini top-view diagram of a door leaf: the wall, the leaf in its open position and the swing arc. */
function SwingDiagram({ hinge, swing }: { hinge: Hinge; swing: Swing }) {
  const hx = hinge === 'left' ? 7 : 17
  const far = hinge === 'left' ? 17 : 7
  const tipY = swing === 'in' ? 4 : 24
  // Screen sweep: left+in clockwise, left+out counter-clockwise, right+in counter-clockwise, right+out clockwise.
  const sweep = (hinge === 'left') === (swing === 'in') ? 1 : 0
  return (
    <svg width="28" height="28" viewBox="0 0 24 28" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="14" x2="23" y2="14" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d={`M ${hx} 14 L ${hx} ${tipY}`} stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d={`M ${hx} ${tipY} A 10 10 0 0 ${sweep} ${far} 14`} stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" fill="none" />
      <circle cx={hx} cy="14" r="1.8" fill="currentColor" />
    </svg>
  )
}

/** Icon button of the swing / hinge picker. */
function PickButton({ label, active, onClick, hinge, swing }: { label: string; active: boolean; onClick: () => void; hinge: Hinge; swing: Swing }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`${ROW} flex min-h-11 items-center justify-center ${active ? `${ROW_ON} text-orange-700 dark:text-orange-300` : `${ROW_OFF} text-slate-600 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10`}`}
    >
      <SwingDiagram hinge={hinge} swing={swing} />
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
  const isWindow = kind === 'window'
  const variant = openingVariant(opening)
  // French doors swing from both ends (symmetric, no hinge) and the two sliding styles stay in the
  // plane of the wall, so neither of them uses the hinge or the swing side. A single casement
  // window hinges on one side, a double casement is symmetric like a french door.
  const showHinge = (isDoor && (variant === 'standard' || variant === 'pocket')) || (isWindow && variant === 'casement')
  const showSwing =
    (isDoor && (variant === 'standard' || variant === 'french')) ||
    (isWindow && (variant === 'casement' || variant === 'double-casement'))

  const setKind = (value: string) => {
    if (value === kind) return
    updateOpening(artboard.id, opening.id, { kind: value as OpeningKind })
  }

  // 'standard' is stored as no variant at all, so old and new documents stay equivalent.
  const setVariant = (value: string) => {
    if (value === variant) return
    const next: OpeningVariant | undefined = value === 'standard' ? undefined : (value as OpeningVariant)
    updateOpening(artboard.id, opening.id, { variant: next })
  }

  const setWidth = (value: number | null): boolean | void => {
    if (value == null) return false
    if (value === opening.widthCm) return
    updateOpening(artboard.id, opening.id, { widthCm: value })
  }

  const hinge: Hinge = opening.hinge ?? 'left'
  const swing: Swing = opening.swing ?? 'in'
  const host = hostWallOf(artboard, opening)
  const nearEdgeCm = host ? host.centreCm - opening.widthCm / 2 : 0
  const farEdgeCm = host ? host.wall.lengthCm - host.centreCm - opening.widthCm / 2 : 0

  /** Move the opening so its near edge is `fromStartCm` from the wall start (centre slides along the wall). */
  const placeFromStart = (fromStartCm: number | null): boolean | void => {
    if (!host || fromStartCm == null) return false
    const maxStart = Math.max(0, host.wall.lengthCm - opening.widthCm)
    const start = Math.min(maxStart, Math.max(0, fromStartCm))
    const t = (start + opening.widthCm / 2) / host.wall.lengthCm
    const xCm = host.wall.a.x + (host.wall.b.x - host.wall.a.x) * t
    const yCm = host.wall.a.y + (host.wall.b.y - host.wall.a.y) * t
    if (Math.abs(xCm - opening.xCm) < 1e-9 && Math.abs(yCm - opening.yCm) < 1e-9) return
    updateOpening(artboard.id, opening.id, { xCm, yCm })
  }

  const duplicate = () => {
    const step = opening.widthCm + 10
    let xCm = opening.xCm + 20
    let yCm = opening.yCm + 20
    if (host) {
      const wantStart = nearEdgeCm + step
      const start = wantStart + opening.widthCm <= host.wall.lengthCm ? wantStart : Math.max(0, nearEdgeCm - step)
      const t = (start + opening.widthCm / 2) / host.wall.lengthCm
      xCm = host.wall.a.x + (host.wall.b.x - host.wall.a.x) * t
      yCm = host.wall.a.y + (host.wall.b.y - host.wall.a.y) * t
    }
    const id = crypto.randomUUID()
    addOpening(artboard.id, { ...opening, id, xCm, yCm })
    useUi.getState().set({ activeArtboardId: artboard.id, selection: { kind: 'opening', artboardId: artboard.id, openingId: id } })
  }

  const remove = () => {
    deleteOpening(artboard.id, opening.id)
    useUi.getState().set({ selection: { kind: 'none' } })
    toast(`Deleted ${KIND_LABEL[kind].toLowerCase()}`, {
      kind: 'info',
      actionLabel: 'Undo',
      onAction: () => useDoc.getState().undo(),
    })
  }

  return (
    <PanelSection title={KIND_LABEL[kind]} icon={KIND_ICON[kind]} className={className}>
      <BackLink name={artboard.name.trim() === '' ? 'Untitled artboard' : artboard.name} onClick={() => selectArtboard(artboard.id)} />

      <FieldRow label="Type" stacked>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} ariaLabel="Opening type" />
      </FieldRow>

      {isDoor && (
        <FieldRow label="Style">
          <SelectField ariaLabel="Door style" value={variant} options={DOOR_VARIANT_OPTIONS} onChange={setVariant} />
        </FieldRow>
      )}

      {isWindow && (
        <FieldRow label="Style">
          <SelectField ariaLabel="Window style" value={variant} options={WINDOW_VARIANT_OPTIONS} onChange={setVariant} />
        </FieldRow>
      )}

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

      <FieldRow label="Position" hint="along the wall" stacked>
        {host ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              ariaLabel="Distance from wall start"
              unit="cm"
              min={0}
              value={Math.round(nearEdgeCm * 10) / 10}
              onCommit={placeFromStart}
            />
            <NumberField
              ariaLabel="Distance from wall end"
              unit="cm"
              min={0}
              value={Math.round(farEdgeCm * 10) / 10}
              onCommit={(v) => (v == null ? false : placeFromStart(host.wall.lengthCm - opening.widthCm - v))}
            />
          </div>
        ) : (
          <EmptyHint>This opening is not on a wall.</EmptyHint>
        )}
      </FieldRow>
      {host && <EmptyHint>From wall start (left) and from wall end (right), edge to edge.</EmptyHint>}

      {showHinge && showSwing && (
        <FieldRow label="Hinge & swing" stacked>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label="Hinge and swing">
            {(['left', 'right'] as const).flatMap((h) =>
              (['in', 'out'] as const).map((sw) => (
                <PickButton
                  key={`${h}-${sw}`}
                  label={`Hinge ${h}, swing ${sw}`}
                  active={hinge === h && swing === sw}
                  hinge={h}
                  swing={sw}
                  onClick={() => updateOpening(artboard.id, opening.id, { hinge: h, swing: sw })}
                />
              )),
            )}
          </div>
        </FieldRow>
      )}
      {showHinge && !showSwing && (
        <FieldRow label="Hinge" stacked>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label="Hinge side">
            {(['left', 'right'] as const).map((h) => (
              <PickButton
                key={h}
                label={`Hinge ${h}`}
                active={hinge === h}
                hinge={h}
                swing={swing}
                onClick={() => updateOpening(artboard.id, opening.id, { hinge: h })}
              />
            ))}
          </div>
        </FieldRow>
      )}
      {showSwing && !showHinge && (
        <FieldRow label="Swing" stacked>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label="Swing side">
            {(['in', 'out'] as const).map((sw) => (
              <PickButton
                key={sw}
                label={`Swing ${sw}`}
                active={swing === sw}
                hinge={hinge}
                swing={sw}
                onClick={() => updateOpening(artboard.id, opening.id, { swing: sw })}
              />
            ))}
          </div>
        </FieldRow>
      )}

      <button type="button" className={BTN} onClick={duplicate} title={`Duplicate this ${KIND_LABEL[kind].toLowerCase()} next to the original`}>
        <Copy size={14} aria-hidden="true" />
        Duplicate
      </button>

      <DangerButton onClick={remove} shortcut="Del">
        {`Delete ${KIND_LABEL[kind]}`}
      </DangerButton>
    </PanelSection>
  )
}
