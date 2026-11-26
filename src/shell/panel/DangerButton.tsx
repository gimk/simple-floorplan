// Shared red danger button (delete) with a Trash2 icon and an optional shortcut badge.
import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { BTN_DANGER } from './styles'

export type DangerButtonProps = {
  children: ReactNode
  onClick: () => void
  /** Shortcut hint shown as a badge, e.g. "Del". */
  shortcut?: string
  disabled?: boolean
  className?: string
}

export function DangerButton({ children, onClick, shortcut, disabled, className }: DangerButtonProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${BTN_DANGER} ${className ?? ''}`}>
      <Trash2 size={14} aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
      {shortcut && (
        <kbd className="ml-1 rounded border border-red-500/40 px-1 font-sans text-[10px] leading-4 opacity-80">{shortcut}</kbd>
      )}
    </button>
  )
}
