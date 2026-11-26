// Floating input to type the length of one wall (cm). Enter = apply, Esc = cancel.
// Blur applies a valid value; an invalid value keeps the editor open with an error.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fmtCm } from '../../model/geometry'
import { setRoomWallLength } from './actions'

export type WallLengthEditorProps = {
  artboardId: string
  roomId: string
  edgeIndex: number
  clientX: number
  clientY: number
  currentCm: number
  onClose: () => void
}

const PAD = 8

export function WallLengthEditor({ artboardId, roomId, edgeIndex, clientX, clientY, currentCm, onClose }: WallLengthEditorProps) {
  const [value, setValue] = useState(fmtCm(currentCm))
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState({ left: clientX, top: clientY + 12 })
  const ref = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const done = useRef(false)

  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])

  // Keep the popup inside the window (centered on the click, below it, flipped above if it does not fit).
  useLayoutEffect(() => {
    const el = box.current
    const w = el?.offsetWidth ?? 160
    const h = el?.offsetHeight ?? 60
    const maxX = window.innerWidth - PAD - w / 2
    const left = Math.max(PAD + w / 2, Math.min(clientX, maxX))
    let top = clientY + 12
    if (top + h > window.innerHeight - PAD) top = clientY - 12 - h
    top = Math.max(PAD, Math.min(top, window.innerHeight - PAD - h))
    setPos({ left, top })
  }, [clientX, clientY, error])

  const finish = (apply: boolean) => {
    if (done.current) return
    if (apply) {
      const n = Number(value.trim().replace(',', '.'))
      if (!Number.isFinite(n) || n <= 0) {
        setError('Type a length above 0 cm.')
        return
      }
      if (Math.abs(n - currentCm) > 1e-9) setRoomWallLength(artboardId, roomId, edgeIndex, n)
    }
    done.current = true
    onClose()
  }

  return (
    <div
      ref={box}
      data-testid="wall-length-editor"
      className="fixed z-50 rounded-lg border border-white/20 bg-surface-2 px-2 py-1.5 shadow-xl"
      style={{ left: pos.left, top: pos.top, transform: 'translateX(-50%)' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1 text-[11px] font-semibold text-slate-300">Wall {edgeIndex + 1}</div>
      <div className="flex items-center gap-1.5">
        <input
          ref={ref}
          inputMode="decimal"
          aria-label="Wall length in cm"
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); ref.current?.focus() }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
          }}
          className={`w-20 rounded-md border bg-white/5 px-2 py-1 text-sm text-slate-100 outline-none ${
            error ? 'border-red-500 focus:border-red-500' : 'border-white/20 focus:border-orange-400'
          }`}
        />
        <span className="text-xs text-slate-400">cm</span>
      </div>
      {error && <p role="alert" className="mt-1 text-[11px] text-red-400">{error}</p>}
      <p className="mt-1 text-[10px] text-slate-500">Enter apply · Esc cancel</p>
    </div>
  )
}
