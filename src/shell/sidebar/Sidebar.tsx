// Sidebar shell: three tabs around the feature panels (docs/sidebar-plan.md phase 1,
// docs/sidebar-plan-3.md for the Solve tab).
//   Inspect = the current context (breadcrumb + apartment, room/wall, element, tape, pin).
//   Solve   = the whole-plan tools (progress, precision, keep locked, apply / solve).
//   Plan    = the global sections (background, layers, calculators, export).
// Panels are mounted unchanged here; the tab and the open state of each section are
// remembered per viewer (localStorage, see ./store.ts). A new selection brings back Inspect.
import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { ImagePlus } from 'lucide-react'
import { useUi } from '../../model/store'
import { useAnnotSel } from '../../features/annotations/selection'
import { ApartmentPanel } from '../../features/apartment'
import { ClearancePanel } from '../../features/clearance'
import { RoomsPanel } from '../../features/rooms'
import { SolvePanel } from '../../features/solve'
import { ElementsPanel } from '../../features/elements'
import { TapePanel, PinPanel } from '../../features/annotations'
import { BackgroundPanel } from '../../features/background'
import { LayersPanel } from '../../features/layers'
import { SchedulePanel } from '../../features/schedule'
import { CalculatorsPanel, ExportPanel } from '../../features/export'
import { SharePanel } from '../../features/share/SharePanel'
import { PanelSection } from '../panel'
import { Breadcrumb } from './Breadcrumb'
import { LayersSection } from './LayersSection'
import { useSidebar, type SidebarTab } from './store'
import { scrollToTop } from './scroll'

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'solve', label: 'Solve' },
  { id: 'layers', label: 'Layers' },
  { id: 'plan', label: 'Plan' },
]

export function Sidebar() {
  const tab = useSidebar((s) => s.tab)
  const setTab = useSidebar((s) => s.setTab)
  const selection = useUi((s) => s.selection)
  const annotSel = useAnnotSel((s) => s.sel)
  const baseId = useId()
  const tabRefs = useRef<Partial<Record<SidebarTab, HTMLButtonElement | null>>>({})
  const inspectRef = useRef<HTMLDivElement | null>(null)

  // A new selection brings the inspector back — but not on the first render, so a
  // viewer who left the sidebar on Plan keeps it after a reload. The card of the new
  // selection sits at the top, so the scroll container goes back to the top too.
  const signature = JSON.stringify([selection, annotSel])
  const lastSignature = useRef(signature)
  useEffect(() => {
    if (lastSignature.current === signature) return
    lastSignature.current = signature
    // Clicking a row of the Layers tab selects an item: stay on that tab.
    if (useSidebar.getState().tab === 'layers') return
    setTab('inspect')
    // The card of the new selection sits at the top: bring it into view in the scrolling <aside>.
    scrollToTop(inspectRef.current)
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
      {/* Sticky bar: negative margins and matching background cover the aside padding, and
          -top-3 makes it stick at the top edge of the panel (top-0 sticks under the 12 px padding),
          so the scrolling sections pass behind it instead of showing through. */}
      <div className="sticky -top-3 z-10 -mx-3 -mt-3 border-b border-black/10 bg-white px-3 pb-2 pt-3 dark:border-white/10 dark:bg-[#1b2128]">
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
      </div>

      <div
        ref={inspectRef}
        id={`${baseId}-panel-inspect`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-inspect`}
        className={tab === 'inspect' ? 'flex flex-col gap-3' : 'hidden'}
      >
        <Breadcrumb />
        <ApartmentPanel />
        {/* Clashes belong to the apartment context: only shown when nothing is selected. */}
        {!selection && !annotSel && <ClearancePanel />}
        <RoomsPanel />
        <ElementsPanel />
        <TapePanel />
        <PinPanel />
      </div>

      <div
        id={`${baseId}-panel-solve`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-solve`}
        className={tab === 'solve' ? 'flex flex-col gap-3' : 'hidden'}
      >
        {/* Whole-plan tools: progress, precision, keep locked, apply / solve (docs/sidebar-plan-3.md). */}
        <SolvePanel />
      </div>

      <div
        id={`${baseId}-panel-layers`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-layers`}
        className={tab === 'layers' ? 'flex flex-col gap-3' : 'hidden'}
      >
        <LayersPanel />
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
        {/* Room schedule table (docs/measurements-plan.md 6); owns the "schedule" section id. */}
        <SchedulePanel />
        {/* Each of these owns its collapsible PanelSection (ids "calculators", "export"). */}
        <CalculatorsPanel />
        <ExportPanel />
        {/* Read-only contractor links (docs/plan.md 7.4); owns the "share" section id. */}
        <SharePanel />
      </div>
    </div>
  )
}
