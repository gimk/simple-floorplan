// Read-only blocks of the contractor share viewer.
// Pure presentation: the plan image, the room list, the verified dimensions, the
// openings table and the room notes. No fetch and no local store here.
import { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { renderPlanSvg } from '../core/export'
import { fmtCm, roomAreaM2 } from '../model/geometry'
import { roomsInWalkOrder } from '../model/survey'
import type { PlanDoc } from '../model/types'
import { effectiveCeilingCm } from '../features/export/calc'
import { itemRows, surveyRows } from '../features/export/surveyExport'
import { BTN, MUTED, PANEL_CARD, SECTION_PAD, formatDecimal } from '../shell/panel'

/** One bordered block of the viewer, light and dark. */
const CARD = `${PANEL_CARD} ${SECTION_PAD} bg-white dark:bg-[#1b2128]`

const TH = 'whitespace-nowrap px-1.5 py-1 text-left font-medium'
const TH_NUM = 'whitespace-nowrap px-1.5 py-1 text-right font-medium'
const TD = 'px-1.5 py-1'
const TD_NUM = 'px-1.5 py-1 text-right tabular-nums'
const ROW = 'border-b border-black/5 dark:border-white/5'

const m2 = (v: number) => `${formatDecimal(v, 2)} m²`

/** The plan as an image sized to the container, with a zoom that scrolls on phones. */
export function PlanImage({ doc }: { doc: PlanDoc }) {
  const [zoom, setZoom] = useState(1)
  const src = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderPlanSvg(doc).svg)}`, [doc])
  const label = doc.title?.trim() || 'Floor plan'

  return (
    <section aria-label="Plan" className={CARD}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={MUTED}>Plan</span>
        <div role="group" aria-label="Zoom" className="flex items-center gap-1">
          <button
            type="button"
            className={BTN}
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
          >
            <Minus size={14} />
          </button>
          <button type="button" className={`${BTN} min-w-14 tabular-nums`} aria-label="Reset zoom" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className={BTN}
            aria-label="Zoom in"
            disabled={zoom >= 4}
            onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="overflow-auto rounded-md border border-black/10 bg-white dark:border-white/10">
        <div className="min-w-full" style={{ width: `${zoom * 100}%` }}>
          <img src={src} alt={`Floor plan of ${label}`} className="block h-auto w-full" />
        </div>
      </div>
    </section>
  )
}

type Verified = { total: number; verified: number; ids: string[] }

/** Room list with floor areas, ceilings and the count of dimensions verified on site. */
export function RoomsTable({ doc }: { doc: PlanDoc }) {
  const byRoom = useMemo(() => {
    const map = new Map<string, Verified>()
    for (const row of surveyRows(doc)) {
      if (row.optional) continue // wall thickness: not part of the survey count
      const entry = map.get(row.roomCode) ?? { total: 0, verified: 0, ids: [] }
      entry.total += 1
      if (row.measuredCm !== null) {
        entry.verified += 1
        entry.ids.push(row.id)
      }
      map.set(row.roomCode, entry)
    }
    return map
  }, [doc])

  const rooms = roomsInWalkOrder(doc)
  if (rooms.length === 0) return <p className={`${CARD} ${MUTED}`}>This plan has no rooms yet.</p>

  const indoor = rooms.filter((r) => !r.outdoor)
  const indoorM2 = indoor.reduce((sum, r) => sum + roomAreaM2(r), 0)
  const outdoorM2 = rooms.filter((r) => r.outdoor).reduce((sum, r) => sum + roomAreaM2(r), 0)

  return (
    <section aria-label="Rooms" className={CARD}>
      <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Rooms</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10">
              <th className={TH}>Room</th>
              <th className={TH_NUM}>Area</th>
              <th className={TH_NUM}>Ceiling</th>
              <th className={TH}>Verified</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => {
              const v = byRoom.get(room.code)
              const ceiling = effectiveCeilingCm(doc, room)
              return (
                <tr key={room.id} className={ROW}>
                  <td className={TD}>
                    <span className="font-medium">{room.name}</span>{' '}
                    <span className="text-slate-500 dark:text-slate-400">({room.code})</span>
                    {room.outdoor && <span className="text-slate-500 dark:text-slate-400"> · outdoor</span>}
                  </td>
                  <td className={TD_NUM}>{m2(roomAreaM2(room))}</td>
                  <td className={TD_NUM}>{ceiling === null ? '–' : `${fmtCm(ceiling)} cm`}</td>
                  <td className={TD} title={v && v.ids.length ? v.ids.join(', ') : undefined}>
                    {v && v.verified > 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        ✓ {v.verified}/{v.total}
                      </span>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">–</span>
                    )}
                  </td>
                </tr>
              )
            })}
            <tr className="font-semibold">
              <td className={TD}>Indoor total</td>
              <td className={TD_NUM}>{m2(indoorM2)}</td>
              <td className={TD_NUM} />
              <td className={TD} />
            </tr>
            {outdoorM2 > 0 && (
              <tr>
                <td className={TD}>Outdoor</td>
                <td className={TD_NUM}>{m2(outdoorM2)}</td>
                <td className={TD_NUM} />
                <td className={TD} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={`${MUTED} mt-1`}>✓ = length measured on site. Areas use measured lengths when present.</p>
    </section>
  )
}

/** The dimensions the survey verified on site, with the planned value and the gap. */
export function DimensionsTable({ doc }: { doc: PlanDoc }) {
  const rows = useMemo(() => surveyRows(doc), [doc])
  const verified = rows.filter((r) => r.measuredCm !== null)
  // Optional values (wall thickness) are listed when measured, but are not in the count.
  const required = rows.filter((r) => !r.optional)
  const requiredDone = required.filter((r) => r.measuredCm !== null).length
  if (rows.length === 0) return null

  return (
    <section aria-label="Verified dimensions" className={CARD}>
      <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Verified dimensions</h2>
      {verified.length === 0 ? (
        <p className={MUTED}>No dimension measured on site yet: the plan values are traced estimates.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10">
                  <th className={TH}>ID</th>
                  <th className={TH}>Room</th>
                  <th className={TH_NUM}>Plan</th>
                  <th className={TH_NUM}>Measured</th>
                  <th className={TH_NUM}>Gap</th>
                </tr>
              </thead>
              <tbody>
                {verified.map((r) => (
                  <tr key={r.id} className={ROW}>
                    <td className={TD}>
                      <span className="text-emerald-700 dark:text-emerald-400">✓</span> {r.id}
                    </td>
                    <td className={TD}>{r.roomName}</td>
                    <td className={TD_NUM}>{r.plannedCm === null ? '–' : `${fmtCm(r.plannedCm)} cm`}</td>
                    <td className={TD_NUM}>{r.measuredCm === null ? '–' : `${fmtCm(r.measuredCm)} cm`}</td>
                    <td className={TD_NUM}>{r.diffCm === null ? '–' : `${fmtCm(r.diffCm)} cm`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`${MUTED} mt-1`}>
            {requiredDone} of {required.length} dimensions measured on site. Walls are CODE-1..n, CODE-D is the
            diagonal, CODE-H the ceiling height, CODE-n-T a wall thickness.
          </p>
        </>
      )}
    </section>
  )
}

/** Doors, windows and radiators with their sizes on the wall. */
export function OpeningsTable({ doc }: { doc: PlanDoc }) {
  const rows = useMemo(() => itemRows(doc), [doc])
  if (rows.length === 0) return null
  const cm = (v: number | null) => (v === null ? '–' : fmtCm(v))

  return (
    <section aria-label="Openings and fixtures" className={CARD}>
      <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Openings and fixtures</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10">
              <th className={TH}>Room</th>
              <th className={TH}>Wall</th>
              <th className={TH}>Type</th>
              <th className={TH_NUM}>From start</th>
              <th className={TH_NUM}>Width</th>
              <th className={TH_NUM}>Height</th>
              <th className={TH_NUM}>Sill</th>
              <th className={TH_NUM}>Depth</th>
              <th className={TH}>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.roomCode}-${r.wall}-${i}`} className={ROW}>
                <td className={TD}>{r.roomCode}</td>
                <td className={TD}>{r.wall}</td>
                <td className={TD}>{r.type}</td>
                <td className={TD_NUM}>{cm(r.fromStartCm)}</td>
                <td className={TD_NUM}>{cm(r.widthCm)}</td>
                <td className={TD_NUM}>{cm(r.heightCm)}</td>
                <td className={TD_NUM}>{cm(r.sillCm)}</td>
                <td className={TD_NUM}>{cm(r.depthCm)}</td>
                <td className={TD}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${MUTED} mt-1`}>Sizes in cm. "From start" is the distance from the first corner of the wall.</p>
    </section>
  )
}

/** Free-text room notes, keyed by room code in the document. */
export function NotesList({ doc }: { doc: PlanDoc }) {
  const entries = Object.entries(doc.roomNotes ?? {}).filter(([, text]) => text.trim() !== '')
  if (entries.length === 0) return null
  const nameOf = (code: string) => doc.rooms.find((r) => r.code === code)?.name ?? code

  return (
    <section aria-label="Room notes" className={CARD}>
      <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Room notes</h2>
      <ul className="flex flex-col gap-1.5">
        {entries.map(([code, text]) => (
          <li key={code} className="text-xs">
            <span className="font-medium">
              {code} · {nameOf(code)}
            </span>
            <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{text}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
