// Shared "‹ Artboard: <name>" button that returns from a detail panel to the artboard.
import { ChevronLeft } from 'lucide-react'

export type BackLinkProps = {
  /** Name shown after "Artboard:". */
  name?: string
  onClick: () => void
  /** Text before the name (default "Artboard"). */
  label?: string
  className?: string
}

export function BackLink({ name, onClick, label = 'Artboard', className }: BackLinkProps) {
  const text = name ? `${label}: ${name}` : label
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Back to ${text}`}
      className={`flex min-h-9 w-full min-w-0 items-center gap-1 rounded-md px-1 text-left text-sm text-slate-600 hover:bg-black/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-orange-500 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100 pointer-coarse:min-h-11 ${className ?? ''}`}
    >
      <ChevronLeft size={16} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{text}</span>
    </button>
  )
}
