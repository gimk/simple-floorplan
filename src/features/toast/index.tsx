// Tiny toast store + host. Mount <ToastHost /> once from any layer/panel; it renders
// into document.body via a portal, so it works from inside the SVG tree.
// Used for destructive-action feedback (docs/plan.md 7.2 #15): "Room deleted · Undo".
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { create } from 'zustand'

export type Toast = {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
  durationMs: number
}

type ToastState = { toasts: Toast[] }

export const DEFAULT_DURATION_MS = 5000

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export const useToast = create<ToastState>(() => ({ toasts: [] }))

/** Show a toast (default 5 s). Pass actionLabel/onAction for e.g. an Undo button. */
export function toast(message: string, opts?: { actionLabel?: string; onAction?: () => void; durationMs?: number }): number {
  const t: Toast = {
    id: nextId++,
    message,
    actionLabel: opts?.actionLabel,
    onAction: opts?.onAction,
    durationMs: opts?.durationMs ?? DEFAULT_DURATION_MS,
  }
  useToast.setState((s) => ({ toasts: [...s.toasts, t] }))
  timers.set(t.id, setTimeout(() => dismiss(t.id), t.durationMs))
  return t.id
}

export function dismiss(id: number) {
  const tm = timers.get(id)
  if (tm) {
    clearTimeout(tm)
    timers.delete(id)
  }
  useToast.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

/** Destructive-action toast whose Undo button calls the given undo function. */
export function undoToast(message: string, undo: () => void): number {
  return toast(message, { actionLabel: 'Undo', onAction: undo })
}

/** Fixed bottom-center toast stack, rendered in document.body. aria-live for screen readers. */
export function ToastHost() {
  const toasts = useToast((s) => s.toasts)
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-16 left-1/2 z-50 flex w-auto max-w-[95vw] -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex min-h-9 items-center gap-3 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm shadow-lg dark:border-white/15 dark:bg-[#1b2128]"
        >
          <span className="text-zinc-900 dark:text-zinc-100">{t.message}</span>
          {t.actionLabel && (
            <button
              type="button"
              className="min-h-9 rounded-md bg-orange-700 px-3 text-sm font-semibold text-white hover:bg-orange-800"
              onClick={() => {
                t.onAction?.()
                dismiss(t.id)
              }}
            >
              {t.actionLabel}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss notification"
            className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
