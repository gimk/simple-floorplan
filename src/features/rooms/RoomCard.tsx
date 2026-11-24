// Inspect card for one room: name, code, walk order, ceiling, stats, the walls list with the
// fit check, the elements list, and the measured values of this room
// (docs/sidebar-plan-3.md step 4). Whole-plan tools live in the Solve tab.
import { useState } from 'react'
import { Check, DoorOpen, Lock, Ruler, Square, Trash2 } from 'lucide-react'
import { fmtCm, innerWallLengths, roomAreaM2 } from '../../model/geometry'
import { planPrecision, shownLength } from '../../model/precision'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, Selection } from '../../model/types'
import { effectiveCeilingCm } from '../export/calc'
import {
  BTN,
  CheckboxRow,
  EmptyHint,
  FieldRow,
  IconButton,
  MUTED,
  NumberField,
  PanelSection,
  StatGrid,
  SwitchRow,
  TextField,
  formatM2,
} from '../../shell/panel'
import { useSidebar } from '../../shell/sidebar/store'
import { undoToast } from '../toast'
import { applyMeasuredNear, describeReport, setVerifiedLocked, verifiedAllLocked, verifiedWalls } from './apply'
import { fmtDiffCm, patchRoom, update, type ActiveHole } from './cards'
import { ElementList } from './ElementList'
import { RoomOldValues } from '../measure/OldValues'
import { fitCheck } from './fit'
import { deleteRoom, setRoomCode } from './ops'
import { elementRows, wallRows, WALL_TYPE_CHIP } from './roomLists'
import { isV2Doc } from '../../model/v2/targets'
import { roomWallLinks } from './wallSides'
import { HoleCard } from './VertexCard'

export function RoomCard({ doc, room, selection, activeHole }: {
  doc: PlanDoc; room: Room; selection: NonNullable<Selection>; activeHole: ActiveHole
}) {
  const apartmentCeilingCm = doc.apartment?.defaultCeilingCm ?? null
  // Report of the last "Apply measured lengths" run for this room; local, so it goes away
  // with the room card instead of following the selection.
  const [note, setNote] = useState<string | null>(null)

  const select = useUi.getState().select
  const verified = verifiedWalls({ measurements: doc.measurements }, room)
  const allLocked = verifiedAllLocked({ measurements: doc.measurements }, room)
  // Same rule as hasOwnCeiling(): a room height of 0 does not count as its own.
  const ownCeiling = room.ceilingCm !== undefined && room.ceilingCm > 0
  const ceiling = effectiveCeilingCm(doc, room)
  const areaM2 = roomAreaM2(room)
  // A v2 document: one line per FACE, with the stored wall it belongs to and what is on the other
  // side of that wall (docs/walls-plan.md, Walls in the interface). v1 rooms keep the old list.
  const links = isV2Doc(doc) && (doc.walls ?? []).length > 0 ? roomWallLinks(doc, room) : null

  const runApply = () => {
    const current = useDoc.getState().doc
    const r = applyMeasuredNear(current, room.id)
    if (r.doc !== current) update(() => r.doc)
    setNote(describeReport(r.reports[0]))
  }

  return (
    <>
      {activeHole && <HoleCard />}

      <PanelSection
        title="Room"
        icon={<Square size={16} />}
        actions={
          <IconButton
            label={`Delete room ${room.name}`}
            icon={<Trash2 size={16} />}
            variant="danger"
            onClick={() => {
              update((d) => deleteRoom(d, room.id))
              useUi.getState().select(null)
              undoToast('Room deleted', () => useDoc.temporal.getState().undo())
            }}
          />
        }
      >
        <FieldRow label="Name" htmlFor="room-name">
          <TextField
            id="room-name"
            name="name"
            value={room.name}
            onCommit={(v) => {
              if (!v.trim()) return false
              patchRoom(room.id, { name: v.trim() })
            }}
          />
        </FieldRow>
        <FieldRow label="Code" htmlFor="room-code" hint="unique">
          <TextField
            id="room-code"
            name="code-unique-"
            value={room.code}
            invalidMessage="Code already used"
            onCommit={(v) => {
              const c = v.trim()
              if (!c || doc.rooms.some((r) => r.id !== room.id && r.code === c)) return false
              update((d) => setRoomCode(d, room.id, c))
            }}
          />
        </FieldRow>
        <FieldRow label="Walk order" htmlFor="room-walk-order">
          <NumberField
            id="room-walk-order"
            name="walk-order"
            value={room.walkOrder}
            onCommit={(v) => {
              if (v === null) return false
              patchRoom(room.id, { walkOrder: v })
            }}
          />
        </FieldRow>
        <FieldRow
          label="Ceiling"
          htmlFor="room-ceiling"
          hint={!ownCeiling && apartmentCeilingCm !== null && apartmentCeilingCm > 0 ? `Apartment default: ${fmtCm(apartmentCeilingCm)} cm` : undefined}
        >
          <NumberField
            id="room-ceiling"
            name="ceiling-height"
            unit="cm"
            value={room.ceilingCm ?? null}
            placeholder={!ownCeiling && apartmentCeilingCm !== null && apartmentCeilingCm > 0 ? fmtCm(apartmentCeilingCm) : undefined}
            onCommit={(v) => {
              if (v === null) { patchRoom(room.id, { ceilingCm: undefined }); return }
              if (v <= 0) return false
              patchRoom(room.id, { ceilingCm: v })
            }}
          />
        </FieldRow>
        <SwitchRow
          name="roomOutdoor"
          label="Outdoor (balcony, terrace)"
          checked={!!room.outdoor}
          onChange={(checked) => patchRoom(room.id, { outdoor: checked })}
        />
        <StatGrid
          items={[
            { label: 'Area', value: `${formatM2(areaM2)} m²` },
            { label: 'Perimeter', value: `${fmtCm(Math.round(innerWallLengths(room).reduce((a, l) => a + l, 0) * 10) / 10)} cm` },
            { label: 'Volume', value: ceiling === null ? '—' : `${formatM2((areaM2 * ceiling) / 100)} m³` },
            {
              label: 'Ceiling',
              value: ceiling === null ? '—' : `${fmtCm(ceiling)} cm`,
              hint: ceiling !== null && !ownCeiling ? '(apartment default)' : undefined,
            },
          ]}
        />
      </PanelSection>

      <PanelSection id="room-walls" title="Walls" icon={<Ruler size={16} />} collapsible>
        {(() => {
          const rows = wallRows(doc, room)
          if (!rows.length) return <EmptyHint>This room has no wall yet.</EmptyHint>
          return (
            <ul className="flex flex-col gap-0.5">
              {rows.map((row) => {
                const link = links?.get(row.wallStart) ?? null
                const current = link
                  ? selection.kind === 'storedWall' && selection.wallId === link.wallId
                  : selection.kind === 'wall' && selection.wallStart === row.wallStart
                return (
                  <li key={row.wallStart}>
                    <button
                      type="button"
                      aria-label={`Select wall ${row.label}${link ? ` (${link.wallId})` : ''}`}
                      aria-current={current ? 'true' : undefined}
                      onClick={() =>
                        link
                          // A click opens the wall card, with the side this room is on.
                          ? select({ kind: 'storedWall', wallId: link.wallId, side: link.side, face: `room:${room.id}:${link.wallStart}` })
                          : select({ kind: 'wall', roomId: room.id, wallStart: row.wallStart })}
                      className={`flex min-h-9 w-full flex-col justify-center gap-0.5 rounded-md px-1 py-1 text-left text-sm pointer-coarse:min-h-11 ${
                        current ? 'bg-orange-700/10' : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      {/* Two lines: the measures on the first one, the wall and its other side on the
                          second one (in 320 px, one line cut 'W12 · shared with Couloir' to 'W...'). */}
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-10 shrink-0 font-mono text-xs">{row.label}</span>
                        <span className={`shrink-0 rounded px-1 text-[11px] ${WALL_TYPE_CHIP[row.type]}`}>{row.typeLabel}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
                          {row.verifiedCm === null ? (
                            <span className={MUTED}>{fmtCm(shownLength(row.lengthCm, planPrecision(doc)))}</span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              {fmtCm(row.verifiedCm)}
                              <Check size={11} role="img" aria-label="measured" className="ml-0.5 inline align-[-1px]" />
                            </span>
                          )}
                          {row.verifiedCm !== null && Math.abs(row.verifiedCm - row.lengthCm) >= 0.5 && (
                            // Remaining error: measured minus plan (after a fit, the error that could not be removed).
                            <span data-wall-residual={row.label} title={`Plan ${fmtCm(row.lengthCm)} cm`}
                              className={`rounded px-1 text-[11px] ${Math.abs(row.verifiedCm - row.lengthCm) >= 2 ? 'bg-orange-500/15 text-orange-800 dark:text-orange-300' : MUTED}`}>
                              {fmtDiffCm(row.verifiedCm - row.lengthCm)}
                            </span>
                          )}
                          <span className={`text-[11px] ${MUTED}`}>cm</span>
                        </span>
                        {row.locked && <Lock size={12} role="img" aria-label="locked" className="shrink-0 text-slate-500 dark:text-slate-400" />}
                      </span>
                      {link && (
                        <span className={`min-w-0 truncate pl-12 text-[11px] ${MUTED}`} data-room-wall-link={link.wallId}>
                          {link.wallId} · {link.text}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        })()}
        {(() => {
          // Fit check: every measured value (walls + diagonal) against the plan, as one rms number.
          const fit = fitCheck(doc, room)
          if (!fit) return null
          return (
            <p data-fit-rms className={`text-xs ${fit.rmsCm >= 2 ? 'font-semibold text-orange-700 dark:text-orange-300' : MUTED}`}>
              {fit.diagonal && <>Diagonal {room.code}-D: measured {fmtCm(fit.diagonal.measuredCm)}, plan {fmtCm(fit.diagonal.planCm)} ({fmtDiffCm(fit.diagonal.measuredCm - fit.diagonal.planCm)}). </>}
              Fit error {fmtCm(fit.rmsCm)} cm rms over {fit.count} measured value{fit.count === 1 ? '' : 's'}.
            </p>
          )
        })()}
      </PanelSection>

      <PanelSection id="room-elements" title="Elements" icon={<DoorOpen size={16} />} collapsible>
        {(() => {
          const rows = elementRows(doc, room)
          return rows.length
            ? <ElementList rows={rows} onSelect={(id) => select({ kind: 'element', elementId: id })} />
            : <EmptyHint>No door, window or fixture in this room yet.</EmptyHint>
        })()}
      </PanelSection>

      <PanelSection id="room-measured" title="Measured lengths" collapsible>
        <button className={BTN} disabled={!verified.length} onClick={runApply}>Apply measured lengths</button>
        <CheckboxRow
          name="lockVerifiedWalls"
          label="Lock measured walls"
          disabled={!verified.length}
          checked={allLocked}
          onChange={(checked) => update((d) => setVerifiedLocked(d, room.id, checked))}
        />
        {!verified.length && <EmptyHint>No measured wall lengths yet. Measure this room in Measuring Mode.</EmptyHint>}
        {note && <p className="text-xs text-slate-700 dark:text-slate-200">{note}</p>}
        {/* Values that left this room when a wall changed: shown in Edit Mode too (decision (e)). */}
        <RoomOldValues doc={doc} room={room} />
        <EmptyHint>
          Whole plan: Solve tab.{' '}
          <button
            type="button"
            data-goto-solve=""
            onClick={() => useSidebar.getState().setTab('solve')}
            className="underline hover:no-underline"
          >
            Open Solve
          </button>
        </EmptyHint>
      </PanelSection>
    </>
  )
}
