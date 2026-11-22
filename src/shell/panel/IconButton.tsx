// Square icon-only button: 36 px, 44 px on coarse pointers. `label` is both the
// aria-label and the tooltip, so it is required.
import type { ReactNode } from 'react'

export type IconButtonProps = {
  /** Accessible name; also shown as the tooltip. */
  label: string
  icon: ReactNode
  onClick: () => void
  /** `danger` = red action such as delete. */
  variant?: 'default' | 'danger'
  disabled?: boolean
  /** Set for a toggle button (`aria-pressed`). */
  pressed?: boolean
  type?: 'button' | 'submit'
  className?: string
}

export function IconButton({ label, icon, onClick, variant = 'default', disabled, pressed, type = 'button', className }: IconButtonProps) {
  const look =
    variant === 'danger'
      ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
      : 'text-slate-600 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10'
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11 ${look} ${className ?? ''}`}
    >
      {icon}
    </button>
  )
}
