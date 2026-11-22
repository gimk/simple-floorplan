import { useEffect, useState } from 'react'
import { Camera, MapPin } from 'lucide-react'
import { fmtCm, roomWalls } from '../../model/geometry'
import { addPin, patchPin } from '../annotations/actions'
import { pointOnWall, roomPins, placePin } from '../annotations/logic'
import { PinEditor } from '../annotations/PinEditor'
import type { Pin, PlanDoc, Room } from '../../model/types'
import { MiniDrawing } from './MiniDrawing'
import { NumField } from './NumField'
import { wallRefLength } from './logic'

const sel = 'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-[15px] dark:border-slate-600 dark:bg-[#1b2128]'

/** Distance along the wall from its start, in the same (measured if known) length the items use. */
export function pinOffset(doc: PlanDoc, room: Room, pin: Pin): number | null {
  const w = roomWalls(room).find((x) => x.start.id === pin.wallStart)
  if (!w || !(w.length > 0)) return null
  const along = (pin.at.x - w.start.x) * w.dir.x + (pin.at.y - w.start.y) * w.dir.y
  return Math.max(0, Math.min(w.length, along)) * (wallRefLength(doc, room, w) / w.length)
}

function setWallPlace(doc: PlanDoc, room: Room, pin: Pin, wallStart: string, offsetCm: number) {
  const w = roomWalls(room).find((x) => x.start.id === wallStart)
  if (!w) return
  const ref = wallRefLength(doc, room, w)
  const at = pointOnWall(room, wallStart, ref > 0 ? (offsetCm / ref) * w.length : 0)
  if (at) patchPin(pin.id, { wallStart, roomId: room.id, at })
}

function PinSheet({ doc, room, pin, onClose }: { doc: PlanDoc; room: Room; pin: Pin; onClose: () => void }) {
  const walls = roomWalls(room)
  const pins = roomPins(doc, room.id)
  const off = pinOffset(doc, room, pin)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label="Pin" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-[560px] flex-col gap-3 overflow-auto rounded-t-2xl border border-black/10 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-white/15 dark:bg-[#1b2128] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <b className="text-base">Pin {pins.findIndex((p) => p.id === pin.id) + 1} · {room.name}</b>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-orange-700 px-4 text-sm font-semibold text-white">Done</button>
        </div>
        <p className="text-[13px] text-slate-500 dark:text-slate-400">Tap the drawing near the wall where the pin goes, or pick the wall and the distance below.</p>
        <MiniDrawing
          doc={doc} room={room} focused={null}
          pins={pins.map((p, i) => ({ n: i + 1, at: p.at, active: p.id === pin.id }))}
          onPick={(pt) => { const pl = placePin(pt, [room], Infinity); patchPin(pin.id, { at: pl.at, wallStart: pl.wallStart, roomId: room.id }) }}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Wall</span>
            <select name="pinWall" aria-label="Wall" className={sel} value={pin.wallStart ?? ''} onChange={(e) => e.target.value && setWallPlace(doc, room, pin, e.target.value, off ?? 0)}>
              {!pin.wallStart && <option value="">—</option>}
              {walls.map((w) => <option key={w.start.id} value={w.start.id}>{room.code}-{w.index + 1}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">From start</span>
            <NumField
              ariaLabel="Distance from wall start" allowZero value={off ?? undefined} enterKeyHint="done"
              onValue={(n) => pin.wallStart && setWallPlace(doc, room, pin, pin.wallStart, n ?? 0)}
            />
          </label>
        </div>
        <PinEditor pin={pin} silent onDeleted={onClose} />
      </div>
    </div>
  )
}

/** "Pins & photos" section of a room card. */
export function PinsSection({ doc, room }: { doc: PlanDoc; room: Room }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const pins = roomPins(doc, room.id)
  const open = pins.find((p) => p.id === openId)
  const add = () => {
    const first = roomWalls(room)[0]
    if (!first) return
    const mid = pointOnWall(room, first.start.id, first.length / 2)
    if (mid) setOpenId(addPin({ roomId: room.id, wallStart: first.start.id, at: mid }, true))
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm">Pins &amp; photos</b>
        <button type="button" onClick={add} className="min-h-11 rounded-lg border border-orange-600 px-3 text-sm font-semibold text-orange-700 dark:border-orange-400 dark:text-orange-400">+ Pin</button>
      </div>
      {pins.length === 0 && <p className="text-[13px] text-slate-500 dark:text-slate-400">Notes and photos tied to a spot: radiator pipes, electrical panel…</p>}
      {pins.map((p, i) => {
        const off = pinOffset(doc, room, p)
        const wl = roomWalls(room).find((w) => w.start.id === p.wallStart)
        return (
          <button
            key={p.id} type="button" onClick={() => setOpenId(p.id)}
            className="flex min-h-11 items-center gap-2.5 rounded-lg border border-slate-300 bg-slate-50 p-2.5 text-left dark:border-slate-700 dark:bg-[#12161b]"
          >
            <span className="flex size-6 flex-none items-center justify-center rounded-full bg-orange-600 text-xs font-bold text-white">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">{p.text || 'No note'}</span>
              <span className="block font-mono text-xs text-slate-500 dark:text-slate-400">
                {wl ? `${room.code}-${wl.index + 1}${off != null ? ` · ${fmtCm(off)} cm` : ''}` : 'free spot'}
              </span>
            </span>
            {p.photoKeys.length > 0 && <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Camera size={14} aria-hidden />{p.photoKeys.length}</span>}
            <MapPin size={16} aria-hidden className="flex-none text-slate-400" />
          </button>
        )
      })}
      {open && <PinSheet doc={doc} room={room} pin={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
