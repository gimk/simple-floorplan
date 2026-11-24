// Typed length and angle of the current wall segment (docs/measurements-plan.md, section 7).
// A small box next to the pointer preview, drawn as an HTML <input> pair inside a <foreignObject>
// (same placement pattern as RoomNameEditor). Enter places the segment, Esc closes the box, Tab
// goes from the length to the angle. The chain stays: the box is only a way to place one segment.
import { useEffect, useRef } from 'react'
import type { Vec } from '../../model/types'
import type { Vp } from './interaction'

export type WallTyped = { length: string; angle: string; focus: 'length' | 'angle' }

export function WallToolInput({
  at, vp, value, invalid, onChange, onPlace, onClose, onTabAngle,
}: {
  at: Vec
  vp: Vp
  value: WallTyped
  invalid: boolean
  onChange: (v: WallTyped) => void
  onPlace: () => void
  onClose: () => void
  /** Tab from the length: the angle field takes the angle of the preview when it is empty. */
  onTabAngle: () => void
}) {
  const { px } = vp
  const length = useRef<HTMLInputElement>(null)
  const angle = useRef<HTMLInputElement>(null)

  // The box opens on the typed digit: the length field takes the focus with the caret at the end.
  useEffect(() => {
    const el = value.focus === 'angle' ? angle.current : length.current
    if (!el) return
    el.focus()
    const n = el.value.length
    try { el.setSelectionRange(n, n) } catch { /* an input without a selection: nothing to do */ }
    // Only when the box opens (on mount) and when Tab moves the focus: not on each character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.focus])

  const w = px(168)
  const h = px(60)
  const left = at.x + px(12)
  const top = at.y + px(12)

  const field = (which: 'length' | 'angle', label: string, ref: React.RefObject<HTMLInputElement | null>, text: string) => (
    <label className="flex items-center" style={{ gap: px(3) }}>
      <span
        className={`shrink-0 leading-tight ${invalid && which === 'length' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}
        style={{ fontSize: px(9.5), width: px(56) }}
      >
        {label}
      </span>
      <input
        ref={ref}
        name={which === 'length' ? 'wallLength' : 'wallAngle'}
        value={text}
        inputMode="decimal"
        aria-label={label}
        data-wall-tool-input={which}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value
          onChange(which === 'length' ? { ...value, length: v } : { ...value, angle: v })
        }}
        onKeyDown={(e) => {
          // Viewport, tool shortcuts and the chain listener must stay out of the way.
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); onPlace(); return }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
          if (e.key === 'Tab') {
            e.preventDefault()
            if (which === 'length') onTabAngle()
            else onChange({ ...value, focus: 'length' })
          }
        }}
        className={`box-border min-w-0 flex-1 rounded-sm border bg-white text-slate-800 outline-none dark:bg-slate-900 dark:text-slate-100 ${
          invalid && which === 'length'
            ? 'border-red-500 dark:border-red-400'
            : 'border-orange-500 dark:border-orange-400'
        }`}
        style={{ fontSize: px(12), lineHeight: 1.1, borderWidth: px(1), height: px(20), paddingInline: px(3) }}
      />
    </label>
  )

  return (
    <foreignObject
      x={left}
      y={top}
      width={w}
      height={h}
      className="overflow-visible"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        className="box-border flex flex-col justify-center rounded-md bg-white/95 shadow-sm dark:bg-[#1b2128]/95"
        style={{ width: w, height: h, gap: px(3), paddingInline: px(4) }}
        data-wall-tool-box=""
      >
        {field('length', 'Length (cm)', length, value.length)}
        {field('angle', 'Angle (°)', angle, value.angle)}
      </div>
    </foreignObject>
  )
}
