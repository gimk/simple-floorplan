// Fixed bottom-center toast stack, rendered in document.body via a portal.
// Split from ./index so this file only exports a component (fast refresh).
import { createPortal } from 'react-dom'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { dismiss, pauseToast, resumeToast, undoShortcut, useToast } from './index'
import type { ToastKind } from './index'

const KIND_STYLE: Record<ToastKind, { border: string; icon: string }> = {
  info: { border: 'border-l-sky-500', icon: 'text-sky-500' },
  success: { border: 'border-l-emerald-500', icon: 'text-emerald-500' },
  error: { border: 'border-l-red-500', icon: 'text-red-500' },
}
const KIND_ICON = { info: Info, success: CheckCircle2, error: AlertCircle } as const

const ANIM_CSS = `@keyframes toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:no-preference){.toast-enter{animation:toast-in 150ms ease-out}}`

/** Fixed bottom-center toast stack, rendered in document.body. Clears the toolbar and the safe area. */
export function ToastHost() {
  const toasts = useToast((s) => s.toasts)
  return createPortal(
    <div
      className="pointer-events-none fixed left-1/2 z-50 flex w-auto max-w-[95vw] -translate-x-1/2 flex-col items-center gap-2"
      style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <style>{ANIM_CSS}</style>
      {toasts.map((t) => {
        const Icon = KIND_ICON[t.kind]
        const style = KIND_STYLE[t.kind]
        const shortcut = t.actionShortcut ?? (t.actionLabel === 'Undo' ? undoShortcut() : undefined)
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            data-kind={t.kind}
            onPointerEnter={() => pauseToast(t.id)}
            onPointerLeave={() => resumeToast(t.id)}
            onFocus={() => pauseToast(t.id)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resumeToast(t.id)
            }}
            className={`toast-enter pointer-events-auto flex min-h-9 items-center gap-3 rounded-lg border border-l-4 border-black/10 bg-white px-3 py-1.5 text-sm shadow-lg dark:border-white/15 dark:bg-[#1b2128] ${style.border}`}
          >
            <Icon size={16} aria-hidden="true" className={`shrink-0 ${style.icon}`} />
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
                {shortcut && <span className="ml-2 text-[11px] font-normal opacity-60">{shortcut}</span>}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss notification"
              className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 hover:bg-black/5 pointer-coarse:h-11 pointer-coarse:w-11 dark:text-zinc-400 dark:hover:bg-white/10"
              onClick={() => dismiss(t.id)}
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
