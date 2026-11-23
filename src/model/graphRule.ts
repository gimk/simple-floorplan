// Doc rule and load step for the stored wall graph (docs/walls-plan.md, phase 5a). Pure.
// The graph is DERIVED from the rooms: it is calculated again after each local edit that changed
// the rooms, and on load (migration of documents that have no walls). Rooms, measurements and
// labels are never touched here.
import { syncStoredGraph } from './storedGraph'
import type { PlanDoc } from './types'

/** Same doc when the stored graph is already right, else a copy with the new nodes and walls. */
export function ensureStoredGraph(doc: PlanDoc): PlanDoc {
  if (!doc.rooms.length && !doc.walls && !doc.nodes) return doc
  const g = syncStoredGraph({ nodes: doc.nodes, walls: doc.walls }, doc.rooms)
  return g.nodes === doc.nodes && g.walls === doc.walls ? doc : { ...doc, nodes: g.nodes, walls: g.walls }
}

/**
 * Doc rule (local edits only): when the rooms changed, or the doc has no walls yet, build the graph
 * again from `prev` so each wall keeps its id. Server-applied changes do not run doc rules.
 */
export function graphRule(prev: PlanDoc, next: PlanDoc): PlanDoc {
  if (next.rooms === prev.rooms && next.walls) return next
  const g = syncStoredGraph({ nodes: next.nodes ?? prev.nodes, walls: next.walls ?? prev.walls }, next.rooms)
  return g.nodes === next.nodes && g.walls === next.walls ? next : { ...next, nodes: g.nodes, walls: g.walls }
}
