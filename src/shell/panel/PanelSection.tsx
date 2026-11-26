// Titled block used by every sidebar panel. Optional icon, optional collapsible body
// (open state is remembered per viewer in localStorage) and optional header actions.
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { HEADING, MUTED, PANEL_CARD, SECTION_PAD } from './styles'

export type PanelSectionProps = {
  /** Section heading (also the memory key when `id` is omitted). */
  title: string
  /** Small icon shown before the title. */
  icon?: ReactNode
  /** Right-hand header content, e.g. `<IconButton label="Delete room" … />`. */
  actions?: ReactNode
  /** Renders a toggle button. */
  collapsible?: boolean
  /** Open state on the very first visit (default: open). */
  defaultOpen?: boolean
  /** Muted line under the heading. */
  description?: string
  children?: ReactNode
  className?: string
  /** Classes of the body wrapper (default: `mt-3 flex flex-col gap-3`). */
  contentClassName?: string
}

export function PanelSection({
  title,
  icon,
  actions,
  collapsible = false,
  defaultOpen = true,
  description,
  children,
  className,
  contentClassName,
}: PanelSectionProps) {
  const autoId = useId()
  const [storedOpen, setStoredOpen] = useState(defaultOpen)
  const open = collapsible ? storedOpen : true
  const bodyId = `${autoId}-body`
  return (
    <section className={`${PANEL_CARD} ${SECTION_PAD} flex flex-col ${className ?? ''}`} aria-label={title}>
      <div className="flex min-h-9 items-center gap-1">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setStoredOpen(!open)}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left pointer-coarse:min-h-11"
          >
            <ChevronDown size={14} className={`shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${open ? '' : '-rotate-90'}`} />
            {icon}
            <span className={`truncate ${HEADING}`}>{title}</span>
          </button>
        ) : (
          <h2 className={`flex min-w-0 flex-1 items-center gap-2 ${HEADING}`}>
            {icon}
            <span className="truncate">{title}</span>
          </h2>
        )}
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {description && open && <p className={`mt-1 ${MUTED}`}>{description}</p>}
      <div id={bodyId} className={open ? (contentClassName ?? 'mt-3 flex flex-col gap-3') : 'hidden'}>
        {children}
      </div>
    </section>
  )
}
