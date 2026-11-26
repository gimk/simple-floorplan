// Floating input to type the length of one wall (cm). Enter or blur = apply, Esc = cancel.
import { useEffect, useRef, useState } from 'react'
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

export function WallLengthEditor({ artboardId, roomId, edgeIndex, clientX, clientY, currentCm, onClose }: WallLengthEditorProps) {
  const [value, setValue] = useState(fmtCm(currentCm))
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])

  const finish = (apply: boolean) => {
    if (done.current) return
    done.current = true
    if (apply) {
      const n = Number(value.trim().replace(',', '.'))
      if (Number.isFinite(n) && n > 0 && Math.abs(n - currentCm) > 1e-9) setRoomWallLength(artboardId, roomId, edgeIndex, n)
    }
    onClose()
  }

  return (
    <div
      data-testid="wall-length-editor"
      className="fixed z-50 flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#12161b] px-2 py-1.5 shadow-xl"
      style={{ left: clientX, top: clientY, transform: 'translate(-50%, 12px)' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        inputMode="decimal"
        aria-label="Wall length in cm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true) }
          else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
        }}
        className="w-20 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-slate-100 outline-none focus:border-orange-400"
      />
      <span className="text-xs text-slate-400">cm</span>
    </div>
  )
}
