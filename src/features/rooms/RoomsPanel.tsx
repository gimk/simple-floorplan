// Sidebar panel: the current context of the selection, one card at a time
// (docs/sidebar-plan-3.md step 4, primitives in src/shell/panel). All lengths are cm.
// One undo step per edit, comma decimals.
//   room  -> RoomCard   (room, walls list, elements list, measured lengths)
//   wall  -> WallCard   (wall + "On this wall", header steps to the previous / next wall)
//   storedWall -> StoredWallCard (a v2 wall: the wall once, then its two sides)
//   group -> WallCard (walls) or GroupCard (rooms, points)
//   vertex -> VertexCard
// The apartment card and the whole-plan tools are elsewhere (apartment, Solve tab).
import { useEffect, useMemo } from 'react'
import { selectedItems, type SelItem } from '../../model/selection'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Selection, ToolId } from '../../model/types'
import { wallGroup, setWallTypes, type ActiveHole, type WallRef } from './cards'
import { useActiveHole } from './holes'
import { wallProps } from './walls'
import { GroupCard } from './GroupCard'
import { NewWallsCardConnected } from './NewWallsCard'
import { TraceCardConnected } from './TraceCard'
import { traceById } from './traceActions'
import { RoomCard } from './RoomCard'
import { VertexCard } from './VertexCard'
import { WallCard } from './WallCard'
import { StoredWallCard } from './StoredWallCard'

// The whole-plan tools (apply to all rooms, solve whole plan, precision, keep locked) live
// in the Solve tab (features/solve). `fitCheck` moved to ./fit; re-exported for old imports.
export { fitCheck } from './fit'
export type { FitCheck } from './fit'
/** Selected hole (own store, see ./holes.ts). Passed down so the view stays pure. */
export type { ActiveHole } from './cards'

/** Sidebar panel: the card of the selected room / wall / vertex. */
export function RoomsPanel() {
  const doc = useDoc((s) => s.doc)
  const selection = useUi((s) => s.selection)
  const multi = useUi((s) => s.multi)
  const tool = useUi((s) => s.tool)
  const items = useMemo(() => selectedItems({ selection, multi }), [selection, multi])
  const activeHole = useActiveHole()

  // 'b' toggles the selected wall(s) between bearing and partition (the primary wall decides).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      const ui = useUi.getState()
      if (ui.mode !== 'edit' || ui.selection?.kind !== 'wall') return
      const sel = ui.selection
      const r = useDoc.getState().doc.rooms.find((x) => x.id === sel.roomId)
      if (!r) return
      const refs: WallRef[] = wallGroup(selectedItems(ui)) ?? [{ roomId: sel.roomId, wallStart: sel.wallStart }]
      setWallTypes(refs, wallProps(r, sel.wallStart).type === 'bearing' ? 'partition' : 'bearing')
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  return <RoomsPanelView doc={doc} selection={selection} items={items} activeHole={activeHole} tool={tool} />
}

/**
 * Same panel from plain data, so it can be rendered without the stores (tests, SSR).
 * With no selection and the Wall tool active, the "New walls" card shows the thickness and the
 * type that the tool will use (docs/walls-plan.md phase 6).
 */
export function RoomsPanelView({ doc, selection, items = selection ? [selection] : [], activeHole, tool = 'select' }: {
  doc: PlanDoc; selection: Selection; items?: SelItem[]; activeHole: ActiveHole; tool?: ToolId
}) {
  if (!selection) return tool === 'wall' ? <NewWallsCardConnected /> : null
  if (selection.kind === 'trace') {
    const trace = traceById(doc, selection.id)
    return trace ? <TraceCardConnected trace={trace} /> : null
  }
  // Shift + click group: rooms and points show a summary, walls are edited together.
  const groupKind = items.length > 1 ? items[0].kind : null
  if (groupKind === 'room' || groupKind === 'vertex') return <GroupCard kind={groupKind} count={items.length} />
  if (selection.kind === 'element') return null
  // A stored wall of a v2 document: the wall is ONE object with two sides (Walls in the interface).
  if (selection.kind === 'storedWall') {
    return <StoredWallCard doc={doc} wallId={selection.wallId} side={selection.side} />
  }
  const room = doc.rooms.find((r) => r.id === selection.roomId)
  if (!room) return null

  if (selection.kind === 'wall') {
    return <WallCard doc={doc} room={room} wallStart={selection.wallStart} group={wallGroup(items)} />
  }
  if (selection.kind === 'vertex') {
    return <VertexCard room={room} vertexId={selection.vertexId} activeHole={activeHole} />
  }
  return <RoomCard doc={doc} room={room} selection={selection} activeHole={activeHole} />
}
