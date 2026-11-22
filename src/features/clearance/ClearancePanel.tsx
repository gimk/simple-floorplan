// "Clearance" inspector section: the clashes of the current plan, one clickable row each.
// It stays out of the way when the layout is clean (nothing is rendered).
import { useMemo } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import { MUTED, PanelSection } from '../../shell/panel'
import { clashKey, clashText, findClashes } from './clash'
import type { Clash } from './clash'

type ListProps = {
  doc: Pick<PlanDoc, 'rooms' | 'elements'>
  clashes: Clash[]
  /** Called with the first element of the row (the door, when there is one). */
  onSelect: (elementId: string) => void
}

/** Presentational list, so it can be rendered without the store. */
export function ClashList({ doc, clashes, onSelect }: ListProps) {
  if (!clashes.length) return null
  return (
    <PanelSection
      id="clearance"
      title="Clearance"
      icon={<TriangleAlert size={16} className="shrink-0 text-red-600 dark:text-red-400" />}
      collapsible
      description={clashes.length === 1 ? '1 clash' : `${clashes.length} clashes`}
    >
      <ul className="flex flex-col gap-0.5">
        {clashes.map((clash) => (
          <li key={clashKey(clash)}>
            <button
              type="button"
              data-clash-row={clashKey(clash)}
              onClick={() => onSelect(clash.a)}
              className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-black/5 pointer-coarse:min-h-11 dark:hover:bg-white/10"
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-500 dark:bg-red-400" />
              <span className="min-w-0 flex-1">{clashText(doc, clash)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className={MUTED}>A door cannot open, or a fixture blocks a door swing.</p>
    </PanelSection>
  )
}

/** Connected version mounted in the Inspect tab. */
export function ClearancePanel() {
  const doc = useDoc((s) => s.doc)
  const select = useUi((s) => s.select)
  const clashes = useMemo(() => findClashes(doc), [doc])
  return <ClashList doc={doc} clashes={clashes} onSelect={(elementId) => select({ kind: 'element', elementId })} />
}
