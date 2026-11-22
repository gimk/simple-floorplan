// Sidebar card shown in Edit Mode when nothing is selected: apartment totals,
// the default ceiling height, and the reference surfaces (DPE, Loi Carrez...).
import { useEffect, useState } from 'react'
import { House, Plus, Trash2 } from 'lucide-react'
import { uid, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Selection, SurfaceReference, SurfaceReferenceSource } from '../../model/types'
import { useAnnotSel } from '../annotations/selection'
import { undoToast } from '../toast'
import {
  apartmentTotals,
  compareReference,
  parseCeilingInput,
  parseSurfaceInput,
  SOURCE_LABELS,
  SOURCE_VALUES,
  type ComparisonLevel,
} from './logic'

const box = 'rounded-lg border border-black/10 p-2 text-sm dark:border-white/10'
const input = 'h-9 w-full rounded-md border border-black/15 bg-white px-2 text-sm dark:border-white/15 dark:bg-[#12161b]'
const label = 'flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400'
const btn =
  'flex h-9 items-center justify-center gap-1 rounded-md border border-black/10 px-2 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10'

const LEVEL_CLASS: Record<ComparisonLevel, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  unknown: 'text-slate-500 dark:text-slate-400',
}

const UPDATE = (fn: (d: PlanDoc) => PlanDoc) => useDoc.getState().update(fn)

const m2 = (v: number) => v.toFixed(2).replace('.', ',')
const cm = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',')
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${m2(Math.abs(v))}`

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

/** Height field that commits on blur or Enter, so each edit is exactly one undo step. */
function CeilingField({ value }: { value: number | null }) {
  const shown = value === null ? '' : cm(value)
  const [text, setText] = useState(shown)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(shown)
    setBad(false)
  }, [shown])
  const commit = () => {
    if (text === shown) return
    if (!text.trim()) {
      setDefaultCeiling(null)
      setBad(false)
      return
    }
    const n = parseCeilingInput(text)
    if (n === null) {
      setBad(true)
      setText(shown)
      return
    }
    setBad(false)
    setDefaultCeiling(n)
  }
  return (
    <label className={label}>
      <span>Default ceiling height (cm)</span>
      <input
        className={`${input} ${bad ? 'border-red-500' : ''}`}
        type="text"
        inputMode="decimal"
        placeholder="not set"
        aria-label="Default ceiling height in centimeters"
        aria-invalid={bad}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {bad && <span role="alert" className="text-red-600 dark:text-red-400">Enter a positive height, e.g. 250</span>}
    </label>
  )
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
    <li className="flex flex-col gap-1 rounded-md border border-black/10 p-2 dark:border-white/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {SOURCE_LABELS[ref.source]}
            {ref.label ? ` · ${ref.label}` : ''}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {m2(ref.surfaceM2)} m² reported · {scope}
            {cmp.planM2 !== null ? ` · plan ${m2(cmp.planM2)} m²` : ''}
            {ref.date ? ` · ${ref.date}` : ''}
          </p>
        </div>
        <button
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-red-600 hover:bg-red-500/10 max-md:h-11 max-md:w-11 dark:text-red-400"
          title="Delete this reference"
          aria-label={`Delete reference ${SOURCE_LABELS[ref.source]}${ref.label ? ` ${ref.label}` : ''}`}
          onClick={() => {
            removeReference(ref.id)
            undoToast('Reference deleted', () => useDoc.temporal.getState().undo())
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <p className={`text-xs font-medium ${LEVEL_CLASS[cmp.level]}`}>{diff}</p>
      {ref.note && <p className="text-xs text-slate-500 dark:text-slate-400">{ref.note}</p>}
    </li>
  )
}

function ReferenceForm({ doc }: { doc: PlanDoc }) {
  const [source, setSource] = useState<SurfaceReferenceSource>('dpe')
  const [surface, setSurface] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [refLabel, setRefLabel] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [bad, setBad] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const surfaceM2 = parseSurfaceInput(surface)
    if (surfaceM2 === null) {
      setBad(true)
      return
    }
    setBad(false)
    addReference({
      id: uid('ref'),
      source,
      surfaceM2,
      ...(refLabel.trim() ? { label: refLabel.trim() } : {}),
      ...(roomCode ? { roomCode } : {}),
      ...(date ? { date } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    setSurface('')
    setRefLabel('')
    setNote('')
    setDate('')
  }

  return (
    <form className="flex flex-col gap-1 rounded-md border border-dashed border-black/15 p-2 dark:border-white/15" onSubmit={submit}>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Add a reference surface</p>
      <label className={label}>
        <span>Source</span>
        <select
          className={input}
          aria-label="Reference source"
          value={source}
          onChange={(e) => setSource(e.target.value as SurfaceReferenceSource)}
        >
          {SOURCE_VALUES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        <span>Surface (m²)</span>
        <input
          className={`${input} ${bad ? 'border-red-500' : ''}`}
          type="text"
          inputMode="decimal"
          placeholder="e.g. 62,4"
          aria-label="Reference surface in square meters"
          aria-invalid={bad}
          value={surface}
          onChange={(e) => setSurface(e.target.value)}
        />
      </label>
      {bad && <span role="alert" className="text-xs text-red-600 dark:text-red-400">Enter a positive surface, e.g. 62,4</span>}
      <label className={label}>
        <span>Room (optional)</span>
        <select className={input} aria-label="Room for this reference" value={roomCode} onChange={(e) => setRoomCode(e.target.value)}>
          <option value="">Whole apartment</option>
          {doc.rooms.map((r) => (
            <option key={r.id} value={r.code}>
              {r.code} — {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        <span>Label (optional)</span>
        <input
          className={input}
          type="text"
          placeholder="e.g. DPE 2023"
          aria-label="Reference label"
          value={refLabel}
          onChange={(e) => setRefLabel(e.target.value)}
        />
      </label>
      <label className={label}>
        <span>Date (optional)</span>
        <input className={input} type="date" aria-label="Reference document date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={label}>
        <span>Note (optional)</span>
        <input className={input} type="text" aria-label="Reference note" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button className={btn} type="submit">
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

  return (
    <section className={box} aria-label="Apartment">
      <h2 className="flex items-center gap-2 font-semibold">
        <House size={16} /> Apartment
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <dt className="text-slate-500 dark:text-slate-400">Rooms</dt>
        <dd className="text-right tabular-nums">
          {totals.roomCount}
          {totals.outdoorRoomCount > 0 ? ` (${totals.indoorRoomCount} indoor)` : ''}
        </dd>
        <dt className="text-slate-500 dark:text-slate-400">Floor area</dt>
        <dd className="text-right tabular-nums">{m2(totals.indoorAreaM2)} m²</dd>
        {totals.outdoorRoomCount > 0 && (
          <>
            <dt className="text-slate-500 dark:text-slate-400">Outdoor</dt>
            <dd className="text-right tabular-nums">{m2(totals.outdoorAreaM2)} m²</dd>
          </>
        )}
        <dt className="text-slate-500 dark:text-slate-400" title="Sum of every indoor room perimeter; shared walls count once per room.">
          Wall perimeter
        </dt>
        <dd className="text-right tabular-nums">{m2(totals.wallPerimeterM)} m</dd>
        <dt className="text-slate-500 dark:text-slate-400">Volume</dt>
        <dd className="text-right tabular-nums">
          {m2(totals.volumeM3)} m³
          {totals.roomsWithoutCeiling > 0 ? ` (${totals.roomsWithoutCeiling} without height)` : ''}
        </dd>
        <dt className="text-slate-500 dark:text-slate-400">Survey</dt>
        <dd className="text-right tabular-nums">
          {totals.measured.done} / {totals.measured.total} measured
        </dd>
      </dl>

      <div className="mt-2 flex flex-col gap-1">
        <CeilingField value={totals.defaultCeilingCm} />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Used for rooms without their own height.
          {totals.roomsWithOwnCeiling > 0
            ? ` ${totals.roomsWithOwnCeiling} room(s) override it.`
            : ' No room overrides it.'}
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <h3 className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span>Reference surfaces</span>
          <span className="tabular-nums">{references.length}</span>
        </h3>
        {references.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No reference yet. Add the DPE or Loi Carrez surface to check the plan.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {references.map((r) => (
              <ReferenceRow key={r.id} doc={doc} reference={r} />
            ))}
          </ul>
        )}
        <p className="text-xs opacity-60">
          Green ≤ 2 %, amber ≤ 5 %, red &gt; 5 %. Loi Carrez excludes surfaces under 1,80 m height, so a small difference is normal.
        </p>
        <ReferenceForm doc={doc} />
      </div>
    </section>
  )
}

/** Apartment card for the Edit Mode sidebar, wired to the stores. */
export function ApartmentPanel() {
  const doc = useDoc((s) => s.doc)
  const selection = useUi((s) => s.selection)
  const annotSel = useAnnotSel((s) => s.sel)
  if (annotSel !== null) return null
  return <ApartmentCard doc={doc} selection={selection} />
}
