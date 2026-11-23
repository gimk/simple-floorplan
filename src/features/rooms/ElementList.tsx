// One clickable row per element: kind + variant, then the wall label (room list) or the
// offset from the wall start (wall list), then the width in cm.
import { fmtCm } from '../../model/geometry'
import { MUTED } from '../../shell/panel'
import type { ElementRow } from './roomLists'

export function ElementList({ rows, onSelect, show = 'wall' }: { rows: ElementRow[]; onSelect: (id: string) => void; show?: 'wall' | 'offset' }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onSelect(row.id)}
            aria-label={`Select element ${row.kindLabel} ${row.wallLabel ?? ''}`.trim()}
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 pointer-coarse:min-h-11"
          >
            <span className="min-w-0 flex-1 truncate">
              {row.kindLabel}
              {row.variantLabel && <span className={MUTED}> · {row.variantLabel}</span>}
            </span>
            {show === 'wall' ? (
              <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`}>{row.wallLabel ?? '—'}</span>
            ) : (
              <span className={`shrink-0 font-mono text-xs tabular-nums ${MUTED}`} title="Offset from the wall start">
                @{fmtCm(row.offsetCm)} cm
              </span>
            )}
            <span className="shrink-0 font-mono text-xs tabular-nums">{fmtCm(row.widthCm)}</span>
            <span className={`shrink-0 text-[11px] ${MUTED}`}>cm</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
