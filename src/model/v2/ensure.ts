// Load step of the v2 model (docs/walls-plan.md, phase 5c step 4). Pure, cm, y down.
//
// LOAD = CONVERSION. Every document that comes into the app (IndexedDB, another project, a server
// snapshot, a .sfp import, the demo apartment) goes through `ensureV2` once:
//   - a v1 document (or a document with no `schemaVersion`) gets its stored graph
//     (`ensureStoredGraph`, phase 5a), then the wall model (`convertToV2`), then a target on every
//     value that can hold one (`attachTargets`). The conversion report is stored in
//     `doc.conversion` (always, with `seen` left to the report UI) so the user can check the walls
//     that the conversion merged;
//   - a v2 document keeps its walls: the polygon of each room is calculated again from the graph
//     (`materializeRooms`), so a saved room polygon is only a FALLBACK, for a room whose cycle is
//     missing. Such a room is written into the graph when it can be (at least 3 walls).
// `ensureV2` is a load step: it does not create an undo step by itself, and it gives the same
// document back when there is nothing to do (a v2 document that is already right).
//
// It never moves a value: measurements stay keyed by their label, and the labels do not change
// (the conversion keeps the room order and the corner ids; see src/model/v2/convert.ts).
//
// The traced walls of the Wall tool (`doc.traces`, phase 6) become STANDALONE walls here, and
// `doc.traces` is cleared: in a v2 document the Wall tool draws real walls (docs/walls-plan.md,
// "Walls in the interface"). See `tracesToWalls`.

import { ensureStoredGraph } from '../graphRule'
import type { PlanDoc } from '../types'
import { convertToV2 } from './convert'
import { attachElements, materializeElements } from './elements'
import { attachTargets } from './targets'
import { materializeDoc } from './syncRule'
import { addStandaloneWall, applyRoomPolygon } from './write'

export type EnsureV2Options = {
  /** Time of the conversion, for `doc.conversion.at`. Default: the clock. */
  now?: string
}

/**
 * The traced walls of a document (the Wall tool of an older version) become STANDALONE walls: a
 * wall drawn by the user is a real wall in a v2 document (docs/walls-plan.md, "Walls in the
 * interface"). Same thickness and same type; the walls take the next free ids `W<n>`. `doc.traces`
 * is empty after this step. The values are not touched: a value is keyed by its label.
 * Gives the same document back when there is no trace.
 */
export function tracesToWalls(doc: PlanDoc): PlanDoc {
  const traces = doc.traces ?? []
  if (!traces.length) return doc
  let next = doc
  for (const t of traces) next = addStandaloneWall(next, t.a, t.b, { type: t.type, thicknessCm: t.thicknessCm }).doc
  return { ...next, traces: [] }
}

/** The document in the v2 state: walls as the source, a calculated room view, stored targets. */
export function ensureV2(doc: PlanDoc, opts: EnsureV2Options = {}): PlanDoc {
  return doc.schemaVersion === 2 ? keepV2(doc) : convert(doc, opts.now ?? new Date().toISOString())
}

/** A v1 document becomes v2, with the report of the walls that the conversion merged. */
function convert(doc: PlanDoc, now: string): PlanDoc {
  const { doc: v2, report } = convertToV2(ensureStoredGraph(doc))
  // The conversion refuses a document whose stored graph is out of step with its rooms: it stays
  // a v1 document (the next load tries again) rather than getting the faces of other walls.
  if (v2.schemaVersion !== 2) return doc
  // Every element now belongs to a wall (phase 7). Its view (roomId, wallStart, offsetCm) does not
  // change, so nothing moves on the plan.
  // The traced walls of the Wall tool become standalone walls, and `doc.traces` is cleared.
  return tracesToWalls(attachElements(attachTargets({ ...v2, conversion: { at: now, report } })))
}

/**
 * A v2 document: the walls are the source, so the survey view is calculated again. A room that has
 * no cycle is kept as it was saved (a fallback), and written into the graph when its polygon can
 * hold walls.
 */
function keepV2(doc: PlanDoc): PlanDoc {
  // A trace cannot stay in a v2 document: it is a wall of the graph (a load of an older client, or
  // a document that an older version saved while the Wall tool still drew traces).
  let next = tracesToWalls(doc)
  if (Array.isArray(next.walls) && Array.isArray(next.nodes)) {
    for (const r of next.rooms) {
      if (r.cycle?.length || r.vertices.length < 3) continue
      const written = applyRoomPolygon(next, r.id, r)
      // The polygon was refused (fewer than 3 walls): the saved room stays as it is.
      if (written !== next) next = written
    }
    next = materializeDoc(next)
  }
  // Elements on walls (phase 7): an element saved with the view only gets its wall, and every view is
  // calculated again, so an element follows the wall after any change of the graph.
  return materializeElements(attachElements(attachTargets(next)))
}
