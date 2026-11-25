// Pure lookup helpers for recorded solver state (docs/solver-plan.md).
// Used by the Solve tab, Wall cards, Measuring Mode, and plan/export overlays.
//
// Label kinds mapped by `solverChangeForLabel(doc, label)`:
//   - Room wall face length:  "KI-2"    -> stored wall id, kind 'position'
//   - Room wall thickness:    "KI-2-T"  -> stored wall id, kind 'thickness'
//   - Stored wall centre:     "W12-C"   -> wallId 'W12',   kind 'position'
//   - Stored wall outside:    "W12-E"   -> wallId 'W12',   kind 'position'
//   - Diagonals ("KI-D"), ceiling heights ("KI-H"), and unknown labels -> undefined
//     (not tied to one wall's position or thickness).
import { roundTo } from '../../model/precision'
import { labelRoomCode, parseThicknessLabel } from '../../model/survey'
import type { PlanDoc, SolverChange, SolverKey } from '../../model/types'
import { isV2Doc, targetOfLabel } from '../../model/v2/targets'
import { parseWallValueLabel, storedWallOfRoomWall, wallValueLabel } from '../../model/wallValues'

export type ValueState = 'measured' | 'solved' | 'estimated'

/** Length change threshold (cm) matching engine.ts `MOVE_TOL_CM`. */
const MOVE_TOL_CM = 0.05
const round1 = (v: number) => roundTo(v, 0.1)

/** Per-doc cache of stored walls whose length changed by the solve (|len1 - len0| > MOVE_TOL_CM). */
const lengthChangesCache = new WeakMap<
  Pick<PlanDoc, 'solver' | 'nodes' | 'walls'>,
  Map<string, { fromCm: number; toCm: number }>
>()

function getLengthChangesMap(
  doc: Pick<PlanDoc, 'solver' | 'nodes' | 'walls'>,
): Map<string, { fromCm: number; toCm: number }> {
  const cached = lengthChangesCache.get(doc)
  if (cached) return cached
  const map = new Map<string, { fromCm: number; toCm: number }>()
  const s = doc.solver
  if (s?.enabled && doc.nodes && doc.walls && Object.keys(s.baseNodes).length > 0) {
    const nodeMap = new Map(doc.nodes.map((n) => [n.id, n]))
    for (const w of doc.walls) {
      const aBase = s.baseNodes[w.a]
      const bBase = s.baseNodes[w.b]
      if (!aBase && !bBase) continue
      const a1 = nodeMap.get(w.a)
      const b1 = nodeMap.get(w.b)
      if (!a1 || !b1) continue
      const a0 = aBase ?? a1
      const b0 = bBase ?? b1
      const len0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
      const len1 = Math.hypot(b1.x - a1.x, b1.y - a1.y)
      if (Math.abs(len1 - len0) > MOVE_TOL_CM) {
        map.set(w.id, { fromCm: round1(len0), toCm: round1(len1) })
      }
    }
  }
  lengthChangesCache.set(doc, map)
  return map
}

/**
 * Length change `{ fromCm, toCm }` for a stored wall whose endpoints moved such that
 * `|len1 - len0| > 0.05 cm`, or undefined when the solver is Off or the wall length did not change.
 * Cached per `doc` via WeakMap.
 */
export function solverLengthChange(
  doc: Pick<PlanDoc, 'solver' | 'nodes' | 'walls'>,
  wallId: string,
): { fromCm: number; toCm: number } | undefined {
  if (!doc.solver?.enabled) return undefined
  return getLengthChangesMap(doc).get(wallId)
}

/** Expand a grouped run label like "R1-3+4" into member face labels ["R1-3", "R1-4"], or null. */
function expandGroupedLabel(label: string): string[] | null {
  const m = /^([^-]+)-(\d+(?:\+\d+)+)$/.exec(label)
  if (!m) return null
  const code = m[1]
  return m[2].split('+').map((n) => `${code}-${n}`)
}

/**
 * Recorded solver change for a stored wall, or undefined when the solver is Off or did not change
 * that wall (or did not change that `kind`).
 */
export function solverChangeForWall(
  doc: Pick<PlanDoc, 'solver'>,
  wallId: string,
  kind?: SolverKey['kind'],
): SolverChange | undefined {
  const s = doc.solver
  if (!s?.enabled) return undefined
  return s.changes.find((c) => c.wallId === wallId && (!kind || c.kind === kind))
}

/** True when the solver is On and recorded at least one change (or a change of `kind`) on `wallId`. */
export function isWallSolved(
  doc: Pick<PlanDoc, 'solver'>,
  wallId: string,
  kind?: SolverKey['kind'],
): boolean {
  return solverChangeForWall(doc, wallId, kind) !== undefined
}

/**
 * Resolve a survey label to `{ wallId, kind }` on the stored wall graph, or null when the label
 * does not name a single wall's position or thickness (e.g. diagonal "KI-D", height "KI-H").
 */
export function labelWallKey(doc: PlanDoc, label: string): SolverKey | null {
  // 1. Stored wall value: 'W12-C' (centre) or 'W12-E' (outside/facade) -> position change on W12.
  const wallValue = parseWallValueLabel(label)
  if (wallValue) return { wallId: wallValue.wallId, kind: 'position' }

  // 2. Stored target on an existing measurement (v2 documents attach targets automatically).
  const storedTarget = doc.measurements[label]?.target
  if (storedTarget) {
    const k = storedTarget.kind ?? 'face'
    if (k === 'diagonal') return null
    return { wallId: storedTarget.wallId, kind: k === 'thickness' ? 'thickness' : 'position' }
  }

  // 3. v2 document: resolve via room cycles (`targetOfLabel`).
  if (isV2Doc(doc)) {
    const t = targetOfLabel(doc, label)
    if (!t) return null
    const k = t.kind ?? 'face'
    if (k === 'diagonal') return null
    return { wallId: t.wallId, kind: k === 'thickness' ? 'thickness' : 'position' }
  }

  // 4. v1 fallback: resolve room wall index -> start vertex -> storedWallOfRoomWall.
  const thick = parseThicknessLabel(label)
  if (thick) {
    const room = doc.rooms.find((r) => r.code === thick.code)
    const start = room?.vertices[thick.index]?.id
    const sw = room && start ? storedWallOfRoomWall(doc, room.id, start) : null
    return sw ? { wallId: sw.id, kind: 'thickness' } : null
  }

  const code = labelRoomCode(label)
  if (!code) return null
  const m = /^(\d+)$/.exec(label.slice(code.length + 1))
  if (!m) return null
  const index = Number(m[1]) - 1
  if (index < 0) return null
  const room = doc.rooms.find((r) => r.code === code)
  const start = room?.vertices[index]?.id
  const sw = room && start ? storedWallOfRoomWall(doc, room.id, start) : null
  return sw ? { wallId: sw.id, kind: 'position' } : null
}

/**
 * Recorded solver change for a survey value label ("KI-2", "KI-2-T", "W12-C", "W12-E", or grouped
 * runs like "R1-3+4"), or undefined when the solver is Off, the wall did not change, or the label
 * does not map to a wall.
 */
export function solverChangeForLabel(doc: PlanDoc, label: string): SolverChange | undefined {
  if (!doc.solver?.enabled) return undefined
  const members = expandGroupedLabel(label)
  if (members) {
    for (const m of members) {
      const c = solverChangeForLabel(doc, m)
      if (c) return c
    }
    return undefined
  }
  const key = labelWallKey(doc, label)
  if (!key) return undefined
  return solverChangeForWall(doc, key.wallId, key.kind)
}

function isSingleLabelSolved(doc: PlanDoc, label: string): boolean {
  const key = labelWallKey(doc, label)
  if (!key) return false
  if (solverChangeForWall(doc, key.wallId, key.kind)) return true
  if (key.kind === 'position' && solverLengthChange(doc, key.wallId)) return true
  return false
}

/**
 * Display state of one survey value:
 *   - 'measured'  when a positive measured value exists (`measuredCm` if given, else `doc.measurements[label]`)
 *   - 'solved'    when unmeasured and the solver changed that wall's position, length, or thickness
 *                 (for grouped labels like "R1-3+4", solved if any member face is solved)
 *   - 'estimated' otherwise
 */
export function valueState(
  doc: PlanDoc,
  label: string,
  measuredCm?: number | null,
): ValueState {
  const actual = measuredCm !== undefined ? measuredCm : doc.measurements[label]?.actualCm
  if (actual != null && Number.isFinite(actual) && actual > 0) return 'measured'
  if (!doc.solver?.enabled) return 'estimated'
  const members = expandGroupedLabel(label)
  if (members) return members.some((m) => isSingleLabelSolved(doc, m)) ? 'solved' : 'estimated'
  return isSingleLabelSolved(doc, label) ? 'solved' : 'estimated'
}

/**
 * Best readable label for a stored wall: survey labels of its room faces in walk order
 * (e.g. "KI-2" or "KI-2 / LI-4"), falling back to `wallId`.
 */
export function wallLabel(doc: Pick<PlanDoc, 'rooms' | 'walls'>, wallId: string): string {
  const rooms = [...doc.rooms].sort((a, b) => a.walkOrder - b.walkOrder || a.code.localeCompare(b.code))
  const labels: string[] = []
  const seen = new Set<string>()
  for (const r of rooms) {
    const cycle = r.cycle ?? []
    cycle.forEach((f, idx) => {
      if (f.wallId !== wallId) return
      const lab = `${r.code}-${idx + 1}`
      if (!seen.has(lab)) {
        seen.add(lab)
        labels.push(lab)
      }
    })
  }
  if (labels.length) return labels.join(' / ')
  // Fallback via wall.faces if room.cycle is absent.
  const wall = (doc.walls ?? []).find((w) => w.id === wallId)
  if (wall) {
    for (const r of rooms) {
      for (const f of wall.faces) {
        if (f.roomId !== r.id || !f.wallStart) continue
        const idx = r.vertices.findIndex((v) => v.id === f.wallStart)
        if (idx < 0) continue
        const lab = `${r.code}-${idx + 1}`
        if (!seen.has(lab)) {
          seen.add(lab)
          labels.push(lab)
        }
      }
    }
  }
  return labels.length ? labels.join(' / ') : wallId
}

/**
 * Survey hover label that `hoverTarget` (features/rooms/hoverTarget.ts) understands for a stored wall.
 * Standard stored walls (`W1`, `W2`, ...) use `'W12-C'` so the whole stored wall highlights on the plan.
 */
export function hoverLabelForWall(doc: Pick<PlanDoc, 'rooms' | 'walls'>, wallId: string): string {
  const centre = wallValueLabel(wallId, 'centre')
  if (parseWallValueLabel(centre)) return centre
  const display = wallLabel(doc, wallId)
  return display.split(' / ')[0] || wallId
}
