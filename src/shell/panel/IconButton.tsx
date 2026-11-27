// Square icon-only button: 36 px, 44 px on coarse pointers. `label` is both the
// aria-label and the tooltip, so it is required.
// The app is dark only: each variant holds its dark look directly, with no `dark:` pairs.
import type { ReactNode } from 'react'

export type IconButtonProps = {
  /** Accessible name; also shown as the tooltip. */
  label: string
  icon: ReactNode
  onClick: () => void
  /** `danger` = red action such as delete. `bar` = on a toolbar. `primary` = filled accent. `ghost` = no hover fill. */
  variant?: 'default' | 'bar' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  /** Set for a toggle button (`aria-pressed`). */
  pressed?: boolean
  type?: 'button' | 'submit'
  className?: string
}

const LOOK: Record<NonNullable<IconButtonProps['variant']>, string> = {
  default: 'text-slate-300 hover:bg-white/10',
  bar: 'border border-white/10 bg-surface-2 text-slate-200 hover:bg-white/10',
  primary: 'bg-accent text-white hover:bg-accent-bright',
  danger: 'text-red-400 hover:bg-red-500/10',
  ghost: 'text-slate-400 hover:text-slate-100',
}

export function IconButton({ label, icon, onClick, variant = 'default', disabled, pressed, type = 'button', className }: IconButtonProps) {
  const on = pressed ? 'bg-orange-500/20 text-orange-400' : ''
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11 ${LOOK[variant]} ${on} ${className ?? ''}`}
    >
      {icon}
    </button>
  )
}
