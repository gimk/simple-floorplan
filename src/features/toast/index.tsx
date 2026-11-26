// Tiny toast store. Mount <ToastHost /> (./ToastHost) once from any layer/panel.
// Used for destructive-action feedback (docs/plan.md 7.2 #15): "Room deleted · Undo".
import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export type Toast = {
  id: number
  message: string
  kind: ToastKind
  actionLabel?: string
  actionShortcut?: string
  onAction?: () => void
  durationMs: number
}

export type ToastOptions = {
  kind?: ToastKind
  actionLabel?: string
  /** Faint shortcut hint next to the action. Defaults to the platform Undo key when the label is Undo. */
  actionShortcut?: string
  onAction?: () => void
  durationMs?: number
}

type ToastState = { toasts: Toast[] }

export const DEFAULT_DURATION_MS = 5000
export const ERROR_DURATION_MS = 7000
export const ACTION_DURATION_MS = 8000
export const MAX_TOASTS = 3

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()
/** Remaining time and start of the running timer, to pause and resume. */
const clocks = new Map<number, { remaining: number; startedAt: number }>()

export const useToast = create<ToastState>(() => ({ toasts: [] }))

function startTimer(id: number, ms: number) {
  const tm = timers.get(id)
  if (tm) clearTimeout(tm)
  clocks.set(id, { remaining: ms, startedAt: Date.now() })
  timers.set(id, setTimeout(() => dismiss(id), ms))
}

/** Pause the auto-dismiss timer (pointer hover, keyboard focus). */
export function pauseToast(id: number) {
  const tm = timers.get(id)
  const c = clocks.get(id)
  if (!tm || !c) return
  clearTimeout(tm)
  timers.delete(id)
  clocks.set(id, { remaining: Math.max(0, c.remaining - (Date.now() - c.startedAt)), startedAt: 0 })
}

/** Resume a paused timer with the time that is left. */
export function resumeToast(id: number) {
  const c = clocks.get(id)
  if (!c || timers.has(id)) return
  startTimer(id, Math.max(c.remaining, 1000))
}

/** Shortcut text for Undo on this platform. */
export function undoShortcut(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  return /mac|iphone|ipad/i.test(nav?.platform || nav?.userAgent || '') ? '⌘Z' : 'Ctrl+Z'
}

function defaultDuration(kind: ToastKind, hasAction: boolean): number {
  if (hasAction) return ACTION_DURATION_MS
  return kind === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS
}

/**
 * Show a toast (info 5 s, error 7 s, with action 8 s). Pass actionLabel/onAction for e.g. an Undo button.
 * Max 3 visible (oldest dropped). A repeat of the newest message restarts that toast instead of stacking.
 */
export function toast(message: string, opts?: ToastOptions): number {
  const kind = opts?.kind ?? 'info'
  const durationMs = opts?.durationMs ?? defaultDuration(kind, !!opts?.actionLabel)
  const list = useToast.getState().toasts
  const last = list[list.length - 1]
  if (last && last.message === message && last.kind === kind) {
    const merged: Toast = {
      ...last,
      actionLabel: opts?.actionLabel,
      actionShortcut: opts?.actionShortcut,
      onAction: opts?.onAction,
      durationMs,
    }
    useToast.setState({ toasts: [...list.slice(0, -1), merged] })
    startTimer(last.id, durationMs)
    return last.id
  }
  const t: Toast = {
    id: nextId++,
    message,
    kind,
    actionLabel: opts?.actionLabel,
    actionShortcut: opts?.actionShortcut,
    onAction: opts?.onAction,
    durationMs,
  }
  const next = [...list, t]
  for (const old of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) dismiss(old.id)
  useToast.setState((s) => ({ toasts: [...s.toasts, t].slice(-MAX_TOASTS) }))
  startTimer(t.id, durationMs)
  return t.id
}

export function dismiss(id: number) {
  const tm = timers.get(id)
  if (tm) clearTimeout(tm)
  timers.delete(id)
  clocks.delete(id)
  useToast.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

/** Destructive-action toast whose Undo button calls the given undo function. */
export function undoToast(message: string, undo: () => void): number {
  return toast(message, { actionLabel: 'Undo', onAction: undo })
}
