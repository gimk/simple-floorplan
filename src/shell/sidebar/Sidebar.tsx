// Sidebar shell: two tabs around the feature panels (docs/sidebar-plan.md phase 1).
//   Inspect = the current context (breadcrumb + apartment, room/wall, element, tape, pin).
//   Plan    = the global sections (background, layers, calculators, export).
// Panels are mounted unchanged here; the tab and the open state of each section are
// remembered per viewer (localStorage, see ./store.ts).
import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { ImagePlus } from 'lucide-react'
import { useUi } from '../../model/store'
import { useAnnotSel } from '../../features/annotations/selection'
import { ApartmentPanel } from '../../features/apartment'
import { RoomsPanel } from '../../features/rooms'
import { ElementsPanel } from '../../features/elements'
import { TapePanel, PinPanel } from '../../features/annotations'
import { BackgroundPanel } from '../../features/background'
import { CalculatorsPanel, ExportPanel } from '../../features/export'
import { PanelSection } from '../panel'
import { Breadcrumb } from './Breadcrumb'
import { LayersSection } from './LayersSection'
import { useSidebar, type SidebarTab } from './store'

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'plan', label: 'Plan' },
]

export function Sidebar() {
  const tab = useSidebar((s) => s.tab)
  const setTab = useSidebar((s) => s.setTab)
  const selection = useUi((s) => s.selection)
  const annotSel = useAnnotSel((s) => s.sel)
  const baseId = useId()
  const tabRefs = useRef<Partial<Record<SidebarTab, HTMLButtonElement | null>>>({})

  // A new selection brings the inspector back — but not on the first render, so a
  // viewer who left the sidebar on Plan keeps it after a reload.
  const signature = JSON.stringify([selection, annotSel])
  const lastSignature = useRef(signature)
  useEffect(() => {
    if (lastSignature.current === signature) return
    lastSignature.current = signature
    setTab('inspect')
  }, [signature, setTab])

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = TABS.length
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % count
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + count) % count
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else return
    e.preventDefault()
    const id = TABS[next].id
    setTab(id)
    tabRefs.current[id]?.focus()
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Sidebar view"
        className="flex shrink-0 gap-1 rounded-lg border border-black/10 p-0.5 dark:border-white/10"
      >
        {TABS.map((t, index) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el
              }}
              id={`${baseId}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
              className={`min-h-9 min-w-0 flex-1 rounded-md px-2 text-sm pointer-coarse:min-h-11 ${
                active
                  ? 'bg-orange-700 font-medium text-white'
                  : 'text-slate-600 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div
        id={`${baseId}-panel-inspect`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-inspect`}
        className={tab === 'inspect' ? 'flex flex-col gap-3' : 'hidden'}
      >
        <Breadcrumb />
        <ApartmentPanel />
        <RoomsPanel />
        <ElementsPanel />
        <TapePanel />
        <PinPanel />
      </div>

      <div
        id={`${baseId}-panel-plan`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-plan`}
        className={tab === 'plan' ? 'flex flex-col gap-3' : 'hidden'}
      >
        <PanelSection id="background" title="Background" icon={<ImagePlus size={16} />} collapsible>
          <BackgroundPanel />
        </PanelSection>
        <LayersSection />
        {/* These two still render their own <details>; phase 2 unifies them. */}
        <CalculatorsPanel />
        <ExportPanel />
      </div>
    </div>
  )
}
