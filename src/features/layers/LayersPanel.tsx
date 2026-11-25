// Layers panel: a tree grouped by room that lists every wall and object, so each one can be
// found and selected (docs: like the layers of a design tool). Click = select, Shift/Cmd-click =
// add to a group (kinds that allow it), chevron = collapse. Hover shows the wall on the canvas
// (`hoverLabel`). Delete / Backspace is NOT handled here: the canvas handlers listen on window and
// act on the selection, so the same code deletes from a row.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Layers, Lock, TriangleAlert } from 'lucide-react'
import { selKey, selectedItems, toggleItem, type SelItem } from '../../model/selection'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import { fmtLen, unitSuffix, type LengthUnits } from '../../model/units'
import { EmptyHint, MUTED, PanelSection, ROW_OFF, ROW_ON, formatM2 } from '../../shell/panel'
import { WALL_TYPE_LABEL } from '../rooms/roomLists'
import { ancestorKeys, buildLayerTree, filterTree, findKeys, type LayerNode } from './tree'

const WARNING_TEXT = { overlap: 'Overlaps another wall', short: 'Shorter than 1 cm' } as const

type ListProps = {
  nodes: LayerNode[]
  units: LengthUnits
  selected: Set<string>
  collapsed: Set<string>
  onToggle: (key: string) => void
  onSelect: (sel: SelItem, add: boolean) => void
  onHover?: (label: string | null) => void
  /** Key of the row to scroll into view. */
  focusKey?: string | null
}

function detailOf(n: LayerNode, units: LengthUnits): string {
  const parts: string[] = []
  if (n.type === 'room' && n.areaM2 !== undefined) parts.push(`${formatM2(n.areaM2)} m²`)
  if (n.type === 'wall') {
    if (n.lengthCm !== undefined) parts.push(`${fmtLen(n.lengthCm, units)} ${unitSuffix(units)}`)
    parts.push(n.measured ? 'measured' : 'estimated')
    if (n.wallType) parts.push(WALL_TYPE_LABEL[n.wallType].toLowerCase())
  }
  if (n.type === 'element' && n.widthCm !== undefined) parts.push(`${fmtLen(n.widthCm, units)} ${unitSuffix(units)}`)
  return parts.join(' · ')
}

function Row({ n, depth, ...p }: ListProps & { n: LayerNode; depth: number }) {
  const open = !p.collapsed.has(n.key)
  const isSel = !!n.sel && p.selected.has(selKey(n.sel))
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (p.focusKey === n.key) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [p.focusKey, n.key])
  const detail = detailOf(n, p.units)
  const group = n.type === 'group'
  return (
    <li role="treeitem" aria-expanded={n.children.length ? open : undefined} aria-selected={isSel}>
      <div
        ref={ref}
        data-layer-key={n.key}
        className={`flex min-h-8 items-center gap-1 rounded-md border pr-1 text-sm ${isSel ? ROW_ON : ROW_OFF}`}
        style={{ paddingLeft: depth * 12 }}
        onMouseEnter={() => n.hoverLabel && p.onHover?.(n.hoverLabel)}
        onMouseLeave={() => n.hoverLabel && p.onHover?.(null)}
      >
        {n.children.length ? (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${n.label}`}
            onClick={() => p.onToggle(n.key)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/10"
          >
            <ChevronDown size={14} className={open ? '' : '-rotate-90'} />
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" />
        )}
        <button
          type="button"
          disabled={!n.sel && !n.children.length}
          onClick={(e) => (n.sel ? p.onSelect(n.sel, e.shiftKey || e.metaKey || e.ctrlKey) : p.onToggle(n.key))}
          className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left ${group ? 'text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400' : n.type === 'room' ? 'font-medium' : ''}`}
        >
          <span className="truncate">{n.label}</span>
          {detail && <span className={`truncate ${MUTED}`}>{detail}</span>}
        </button>
        {n.locked && <Lock size={12} aria-label="Locked" className="shrink-0 text-slate-500 dark:text-slate-400" />}
        {n.warnings && n.warnings.length > 0 && (
          <span
            title={n.warnings.map((w) => WARNING_TEXT[w]).join(' · ')}
            aria-label={n.warnings.map((w) => WARNING_TEXT[w]).join(' · ')}
            className="shrink-0 text-amber-600 dark:text-amber-400"
          >
            <TriangleAlert size={14} />
          </span>
        )}
      </div>
      {n.children.length > 0 && open && (
        <ul role="group" className="flex flex-col gap-0.5">
          {n.children.map((c) => (
            <Row key={c.key} n={c} depth={depth + 1} {...p} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** The tree itself, with no store: tests render it with a given state. */
export function LayersList(p: ListProps) {
  return (
    <ul role="tree" aria-label="Layers tree" className="flex flex-col gap-0.5">
      {p.nodes.map((n) => (
        <Row key={n.key} n={n} depth={0} {...p} />
      ))}
    </ul>
  )
}

/** Tree + issue count + filter for a document. Exported for tests. */
export function LayersView({ doc, units }: { doc: PlanDoc; units: LengthUnits }) {
  const selection = useUi((s) => s.selection)
  const multi = useUi((s) => s.multi)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const tree = useMemo(() => buildLayerTree(doc), [doc])
  const selected = useMemo(() => new Set(selectedItems({ selection, multi }).map(selKey)), [selection, multi])
  const nodes = useMemo(() => filterTree(tree.nodes, filter), [tree, filter])

  // A new selection opens the rows above it and scrolls to the first one.
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const sigRef = useRef('')
  useEffect(() => {
    const sig = [...selected].join('|')
    if (sig === sigRef.current) return
    sigRef.current = sig
    const keys = findKeys(tree.nodes, (n) => !!n.sel && selected.has(selKey(n.sel)))
    if (!keys.length) return setFocusKey(null)
    const above = new Set(keys.flatMap((k) => ancestorKeys(tree.nodes, k)))
    setCollapsed((c) => (above.size && [...above].some((k) => c.has(k)) ? new Set([...c].filter((k) => !above.has(k))) : c))
    setFocusKey(keys[0])
  }, [selected, tree])

  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const onSelect = (sel: SelItem, add: boolean) => {
    const ui = useUi.getState()
    if (add) ui.set(toggleItem(ui, sel))
    else ui.select(sel)
  }
  const onHover = (label: string | null) => useUi.getState().set({ hoverLabel: label })

  // While a filter is on, every row that matches is open.
  const openAll = filter.trim() ? new Set<string>() : collapsed
  return (
    <>
      {tree.issueCount > 0 && (
        <p role="status" className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert size={14} /> {tree.issueCount} wall {tree.issueCount === 1 ? 'issue' : 'issues'} (overlap or under 1 cm)
        </p>
      )}
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter rooms, walls, doors…"
        aria-label="Filter layers"
        className="min-h-9 w-full rounded-md border border-black/10 bg-transparent px-2 text-sm dark:border-white/10"
      />
      {nodes.length ? (
        <LayersList nodes={nodes} units={units} selected={selected} collapsed={openAll} onToggle={toggle} onSelect={onSelect} onHover={onHover} focusKey={focusKey} />
      ) : (
        <EmptyHint>{filter.trim() ? 'Nothing matches the filter.' : 'No rooms or walls yet.'}</EmptyHint>
      )}
    </>
  )
}

export function LayersPanel() {
  const doc = useDoc((s) => s.doc)
  const units = useUi((s) => s.canvasUnits)
  return (
    <PanelSection id="layer-tree" title="Layers" icon={<Layers size={16} />}>
      <LayersView doc={doc} units={units} />
    </PanelSection>
  )
}
