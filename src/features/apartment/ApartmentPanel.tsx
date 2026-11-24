// Sidebar card shown in Edit Mode when nothing is selected: apartment totals,
// the default ceiling height, and the reference surfaces (DPE, Loi Carrez...).
// Built from the shared panel primitives (docs/sidebar-plan.md §3-4).
import { useId, useState } from 'react'
import { House, Plus, Trash2 } from 'lucide-react'
import { uid, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Selection, SurfaceReference, SurfaceReferenceSource } from '../../model/types'
import {
  BTN,
  EmptyHint,
  ERROR,
  FieldRow,
  formatM2,
  IconButton,
  INPUT,
  MUTED,
  NumberField,
  PanelSection,
  SelectField,
  StatGrid,
  TextField,
} from '../../shell/panel'
import { useAnnotSel } from '../annotations/selection'
import { renovationSummary } from '../renovation/logic'
import { undoToast } from '../toast'
import { DeletedRoomsOldValues, RemovedWallsOldValues } from '../measure/OldValues'
import { conversionToShow, useConversionNotice } from './conversion'
import { apartmentTotals, compareReference, SOURCE_LABELS, SOURCE_VALUES, type ComparisonLevel } from './logic'
import { WallConversionSection } from './WallConversionSection'
import { buildReference, draftAfterAdd, EMPTY_REFERENCE_DRAFT, type ReferenceDraft } from './referenceForm'

const LEVEL_CLASS: Record<ComparisonLevel, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  unknown: 'text-slate-500 dark:text-slate-400',
}

/** Word of each level: the colour alone says nothing to a colour-blind user (review finding 28). */
const LEVEL_TAG: Record<ComparisonLevel, string | null> = {
  ok: 'OK',
  warn: 'Check',
  bad: 'Large diff',
  unknown: null,
}

const UPDATE = (fn: (d: PlanDoc) => PlanDoc) => useDoc.getState().update(fn)

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatM2(Math.abs(v))}`

function setDefaultCeiling(value: number | null) {
  UPDATE((d) => {
    const apartment = { ...(d.apartment ?? {}) }
    if (value === null) delete apartment.defaultCeilingCm
    else apartment.defaultCeilingCm = value
    return { ...d, apartment }
  })
}

function addReference(ref: SurfaceReference) {
  UPDATE((d) => ({
    ...d,
    apartment: { ...(d.apartment ?? {}), references: [...(d.apartment?.references ?? []), ref] },
  }))
}

function removeReference(id: string) {
  UPDATE((d) => ({
    ...d,
    apartment: {
      ...(d.apartment ?? {}),
      references: (d.apartment?.references ?? []).filter((r) => r.id !== id),
    },
  }))
}

function ReferenceRow({ doc, reference }: { doc: PlanDoc; reference: SurfaceReference }) {
  const ref = reference
  const cmp = compareReference(doc, ref)
  const scope = ref.roomCode ? `room ${ref.roomCode}` : 'whole apartment'
  const diff =
    cmp.diffM2 === null || cmp.diffPct === null
      ? cmp.missingRoom
        ? `room ${ref.roomCode} not found in the plan`
        : 'cannot compare'
      : `${signed(cmp.diffM2)} m² (${signed(cmp.diffPct)} %)`
  return (
    <li className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200">
              {SOURCE_LABELS[ref.source]}
            </span>
            {ref.label && <span className="truncate font-medium">{ref.label}</span>}
          </p>
          <p className={`mt-0.5 ${MUTED}`}>
            {formatM2(ref.surfaceM2)} m² reported · {scope}
            {cmp.planM2 !== null ? ` · plan ${formatM2(cmp.planM2)} m²` : ''}
            {ref.date ? ` · ${ref.date}` : ''}
          </p>
        </div>
        <IconButton
          variant="danger"
          icon={<Trash2 size={14} />}
          label={`Delete reference ${SOURCE_LABELS[ref.source]}${ref.label ? ` ${ref.label}` : ''}`}
          onClick={() => {
            removeReference(ref.id)
            undoToast('Reference deleted', () => useDoc.temporal.getState().undo())
          }}
        />
      </div>
      <p className={`flex items-center gap-1.5 text-xs font-medium ${LEVEL_CLASS[cmp.level]}`}>
        {LEVEL_TAG[cmp.level] && (
          <span className="shrink-0 rounded bg-black/5 px-1 py-0.5 text-[10px] font-semibold uppercase dark:bg-white/10">
            {LEVEL_TAG[cmp.level]}
          </span>
        )}
        <span className="min-w-0">{diff}</span>
      </p>
      {ref.note && <p className={MUTED}>{ref.note}</p>}
    </li>
  )
}

function ReferenceForm({ doc }: { doc: PlanDoc }) {
  const [draft, setDraft] = useState<ReferenceDraft>(EMPTY_REFERENCE_DRAFT)
  const [bad, setBad] = useState(false)
  const ids = useId()
  const set = <K extends keyof ReferenceDraft>(key: K, value: ReferenceDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const ref = buildReference(draft, uid('ref'))
    if (!ref) {
      setBad(true)
      return
    }
    setBad(false)
    addReference(ref)
    setDraft((d) => draftAfterAdd(d))
  }

  return (
    <form
      className="mt-2 flex flex-col gap-1.5 rounded-md border border-dashed border-black/15 p-2 dark:border-white/15"
      onSubmit={submit}
    >
      <p className={`font-semibold ${MUTED}`}>Add a reference surface</p>
      <FieldRow label="Source" htmlFor={`${ids}-source`}>
        <SelectField
          id={`${ids}-source`}
          name="referenceSource"
          ariaLabel="Reference source"
          value={draft.source}
          options={SOURCE_VALUES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))}
          onChange={(v) => set('source', v as SurfaceReferenceSource)}
        />
      </FieldRow>
      <FieldRow label="Surface" htmlFor={`${ids}-surface`}>
        <NumberField
          id={`${ids}-surface`}
          name="referenceSurface"
          ariaLabel="Reference surface in square meters"
          unit="m²"
          placeholder="e.g. 62,4"
          min={0.01}
          invalidMessage="Enter a positive surface, e.g. 62,4"
          value={draft.surfaceM2}
          onCommit={(v) => {
            if (v !== null && v <= 0) return false
            setBad(false)
            set('surfaceM2', v)
          }}
        />
      </FieldRow>
      {bad && (
        <p role="alert" className={ERROR}>
          Enter a positive surface, e.g. 62,4
        </p>
      )}
      <FieldRow label="Room" htmlFor={`${ids}-room`} hint="optional">
        <SelectField
          id={`${ids}-room`}
          name="referenceRoomCode"
          ariaLabel="Room for this reference"
          value={draft.roomCode}
          options={[
            { value: '', label: 'Whole apartment' },
            ...doc.rooms.map((r) => ({ value: r.code, label: `${r.code} — ${r.name}` })),
          ]}
          onChange={(v) => set('roomCode', v)}
        />
      </FieldRow>
      <FieldRow label="Label" htmlFor={`${ids}-label`} hint="optional">
        <TextField
          id={`${ids}-label`}
          name="referenceLabel"
          ariaLabel="Reference label"
          placeholder="e.g. DPE 2023"
          value={draft.label}
          onCommit={(v) => set('label', v)}
        />
      </FieldRow>
      <FieldRow label="Date" htmlFor={`${ids}-date`} hint="optional">
        <input
          id={`${ids}-date`}
          name="referenceDate"
          type="date"
          aria-label="Reference document date"
          className={INPUT}
          value={draft.date}
          onChange={(e) => set('date', e.target.value)}
        />
      </FieldRow>
      <FieldRow label="Note" htmlFor={`${ids}-note`} hint="optional">
        <TextField
          id={`${ids}-note`}
          name="referenceNote"
          ariaLabel="Reference note"
          value={draft.note}
          onCommit={(v) => set('note', v)}
        />
      </FieldRow>
      <button className={`${BTN} mt-0.5 w-full`} type="submit">
        <Plus size={14} /> Add reference
      </button>
    </form>
  )
}

/**
 * Presentational card, so it can be rendered without the stores (tests, exports).
 * Hidden while something is selected: the other panels own that selection.
 */
export function ApartmentCard({ doc, selection }: { doc: PlanDoc; selection: Selection }) {
  if (selection !== null) return null

  const totals = apartmentTotals(doc)
  const references = doc.apartment?.references ?? []
  // Renovation (7.4): room areas before and after the works, only when a wall is tagged.
  const renovation = renovationSummary(doc)
  // Conversion report (walls-plan 5c): shown until the user hides it with "Hide this report".
  const conversion = conversionToShow(doc)

  return (
    <PanelSection title="Apartment" icon={<House size={16} />}>
      <StatGrid
        items={[
          {
            label: 'Rooms',
            value: totals.outdoorRoomCount > 0 ? `${totals.roomCount} (${totals.indoorRoomCount} indoor)` : `${totals.roomCount}`,
          },
          { label: 'Floor area', value: `${formatM2(totals.indoorAreaM2)} m²` },
          ...(totals.outdoorRoomCount > 0
            ? [{ label: 'Outdoor', value: `${formatM2(totals.outdoorAreaM2)} m²` }]
            : []),
          {
            label: 'Wall perimeter',
            value: `${formatM2(totals.wallPerimeterM)} m`,
            hint: 'shared walls count once per room',
          },
          {
            label: 'Volume',
            value: `${formatM2(totals.volumeM3)} m³`,
            ...(totals.roomsWithoutCeiling > 0
              ? { hint: `${totals.roomsWithoutCeiling} without height`, tone: 'muted' as const }
              : {}),
          },
          { label: 'Survey', value: `${totals.measured.done} / ${totals.measured.total} measured` },
        ]}
      />

      {renovation && (
        <p className={`text-xs tabular-nums ${MUTED}`}>
          Before: {formatM2(renovation.before.areaM2)} m² in {renovation.before.rooms} rooms · After:{' '}
          {formatM2(renovation.after.areaM2)} m² in {renovation.after.rooms} rooms
        </p>
      )}

      {conversion && <WallConversionSection conversion={conversion} />}

      {/* Values that left the plan: old values of deleted rooms and of removed walls, in Edit Mode
          too (decision (e)). Nothing when there are none. */}
      <RemovedWallsOldValues doc={doc} />
      <DeletedRoomsOldValues doc={doc} />

      <FieldRow label="Default ceiling" htmlFor="apt-default-ceiling">
        <NumberField
          id="apt-default-ceiling"
          name="defaultCeilingCm"
          ariaLabel="Default ceiling height in centimeters"
          unit="cm"
          placeholder="not set"
          min={1}
          invalidMessage="Enter a positive height, e.g. 250"
          value={totals.defaultCeilingCm}
          onCommit={(v) => {
            if (v !== null && v <= 0) return false
            setDefaultCeiling(v)
          }}
        />
      </FieldRow>
      <EmptyHint>
        Used for rooms without their own height.
        {totals.roomsWithOwnCeiling > 0
          ? ` ${totals.roomsWithOwnCeiling} room(s) override it.`
          : ' No room overrides it.'}
      </EmptyHint>

      <PanelSection
        id="apt-refs"
        title="Reference surfaces"
        className="mt-1 bg-black/[0.03] dark:bg-white/[0.04]"
        collapsible
        actions={<span className={`tabular-nums ${MUTED}`}>{references.length}</span>}
        contentClassName="mt-2 flex flex-col gap-2"
      >
        {references.length === 0 ? (
          <EmptyHint>No reference yet. Add the DPE or Loi Carrez surface to check the plan.</EmptyHint>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {references.map((r) => (
              <ReferenceRow key={r.id} doc={doc} reference={r} />
            ))}
          </ul>
        )}
        <EmptyHint className="opacity-80">
          Green ≤ 2 %, amber ≤ 5 %, red &gt; 5 %. Loi Carrez excludes surfaces under 1,80 m height, so a small
          difference is normal.
        </EmptyHint>
        <ReferenceForm doc={doc} />
      </PanelSection>
    </PanelSection>
  )
}

/** Apartment card for the Edit Mode sidebar, wired to the stores. */
export function ApartmentPanel() {
  const doc = useDoc((s) => s.doc)
  const selection = useUi((s) => s.selection)
  const annotSel = useAnnotSel((s) => s.sel)
  // The panel is always mounted, so the "plan converted" toast is shown once after the load.
  useConversionNotice()
  if (annotSel !== null) return null
  return <ApartmentCard doc={doc} selection={selection} />
}
