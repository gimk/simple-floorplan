// Command palette (Cmd/Ctrl+K, docs/measurements-plan.md section 7): one search field over the
// tools, the edit actions, the layers, the measurement settings, select-similar and the export.
// Same look as the shortcuts dialog: a dark backdrop and a light card (dark mode supported).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { activeIndex, commandList, filterCommands, groupRows, nextEnabled, type Command } from './commands'
import { toast } from '../features/toast'

export type CommandPaletteProps = {
  open: boolean
  onClose: () => void
  /** Open the shortcuts dialog (the App owns it). */
  onOpenShortcuts?: () => void
}

const ROW = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm'

/** Run a command and close the palette. A throw becomes a toast. */
function runCommand(c: Command, close: () => void) {
  close()
  try {
    c.run()
  } catch (e) {
    toast(`Command failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The element that had the focus before the palette opened (nothing on the server). */
const focusBefore = (): HTMLElement | null =>
  typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)
    ? null
    : document.activeElement

/**
 * The palette. While it is closed nothing is mounted, so every open starts with an empty query
 * and the first row active, and closing puts the focus back where it was.
 */
export function CommandPalette({ open, onClose, onOpenShortcuts }: CommandPaletteProps) {
  if (!open) return null
  return <PaletteDialog onClose={onClose} onOpenShortcuts={onOpenShortcuts} />
}

function PaletteDialog({
  onClose,
  onOpenShortcuts,
}: {
  onClose: () => void
  onOpenShortcuts?: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  // Taken once, at mount (the effect below gives the focus back at unmount).
  const [returnFocus] = useState(focusBefore)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const list = useMemo(() => commandList({ openShortcuts: onOpenShortcuts }), [onOpenShortcuts])
  const found = useMemo(() => filterCommands(list, query), [list, query])
  // The active row stays inside the list, on an enabled command when there is one.
  const current = activeIndex(found, index)

  // Focus the search field, and give the focus back on close.
  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      if (returnFocus && returnFocus.isConnected) returnFocus.focus()
    }
  }, [returnFocus])

  // Esc closes first (capture, so the app does not clear the selection), arrows move, Enter runs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((i) => nextEnabled(found, Math.min(i, found.length - 1), e.key === 'ArrowDown' ? 1 : -1))
        return
      }
      if (e.key === 'Enter') {
        // The active row, or the first enabled row when the active one cannot run.
        const c = found[current]?.enabled ? found[current] : found.find((x) => x.enabled)
        if (!c) return
        e.preventDefault()
        runCommand(c, onClose)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [found, current, onClose])

  // Keep the active row in view.
  useEffect(() => {
    boxRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current, query])

  const active = found[current]
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        ref={boxRef}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-black/10 bg-white shadow-xl dark:border-white/15 dark:bg-[#1b2128]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-black/10 px-3 dark:border-white/10">
          <Search size={16} className="shrink-0 opacity-60" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            // A named field keeps the browser quiet (the palette is not a form).
            name="command-palette-query"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
            placeholder="Type a command: tool, layer, units, export…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={active ? `cmd-${active.id}` : undefined}
            className="h-11 w-full min-w-0 bg-transparent text-sm outline-none"
          />
        </div>
        <div
          id="command-palette-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-[60vh] overflow-y-auto p-1.5"
        >
          {found.length === 0 && (
            <p className="px-2.5 py-3 text-sm opacity-60">No command matches “{query}”.</p>
          )}
          {groupRows(found).map(({ group, rows }) => (
            <div key={group} role="group" aria-label={group}>
              <div aria-hidden="true" className="px-2.5 pb-1 pt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                {group}
              </div>
              {rows.map(({ command: c, index: i }) => {
                const isActive = i === current
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    id={`cmd-${c.id}`}
                    aria-selected={isActive}
                    data-command={c.id}
                    data-active={isActive || undefined}
                    disabled={!c.enabled}
                    onMouseMove={() => { if (!isActive) setIndex(i) }}
                    onClick={() => { if (c.enabled) runCommand(c, onClose) }}
                    className={`${ROW} ${isActive ? 'bg-orange-700 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'} disabled:opacity-40 disabled:hover:bg-transparent`}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.shortcut && (
                      <kbd
                        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] ${isActive ? 'border-white/40' : 'border-black/10 opacity-70 dark:border-white/15'}`}
                      >
                        {c.shortcut}
                      </kbd>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-black/10 px-3 py-1.5 text-xs opacity-60 dark:border-white/10">
          ↑ ↓ to move · Enter to run · Esc to close
        </div>
      </div>
    </div>
  )
}
