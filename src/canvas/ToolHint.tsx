// On-canvas tool hint pill. The Viewport overlay slot is SVG, so this renders an HTML pill
// through a portal into document.body (like the toast host). It works from inside the SVG tree.
// Usage: <ToolHint step="1/2" text={`Tape (M): Click or drag · Shift 45° · ${FREE_SNAP_LABEL} free · Esc exit`} />
import type { ReactNode } from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export type ToolHintProps = {
  text: ReactNode
  /** Optional step badge, for example "1/3" or 2. */
  step?: string | number
  /** Show a close button. The hint stays hidden after the user closes it (until it remounts). */
  dismissible?: boolean
  /** Fainter style for a hint that is already known. */
  muted?: boolean
  /** Where to place the pill. Default: top-center. */
  position?: 'top' | 'bottom'
  className?: string
}

export function ToolHint({ text, step, dismissible = false, muted = false, position = 'top', className = '' }: ToolHintProps) {
  const [closed, setClosed] = useState(false)
  if (closed || typeof document === 'undefined') return null
  const place = position === 'top' ? 'top-14' : 'bottom-20'
  return createPortal(
    <div
      data-testid="tool-hint"
      role="note"
      className={`pointer-events-none fixed left-1/2 z-30 flex max-w-[min(95vw,40rem)] -translate-x-1/2 justify-center ${place} ${className}`}
    >
      <div
        className={`pointer-events-none flex items-center gap-2 rounded-2xl border border-white/15 bg-surface-2/95 px-3 py-1 text-center text-[11px] leading-snug text-slate-200 shadow-lg ${
          muted ? 'opacity-60' : ''
        }`}
      >
        {step !== undefined && (
          <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-slate-100">{step}</span>
        )}
        <span className="min-w-0 text-balance break-words">{text}</span>
        {dismissible && (
          <button
            type="button"
            aria-label="Hide hint"
            className="pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 pointer-coarse:h-11 pointer-coarse:w-11"
            onClick={() => setClosed(true)}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
