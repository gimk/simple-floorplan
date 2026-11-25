// Pure solver state engine (docs/solver-plan.md). No store access.
//
// In a v2 document the stored wall graph (doc.nodes, doc.walls) is the editing source and rooms
// are a materialized view. `solverOn` solves from the base geometry, moves nodes and updates wall
// thicknesses IN PLACE (keeping every node id and wall id stable), records what moved in
// `doc.solver`, and rebuilds room views via `applyGraphUpdate`. `solverOff` writes back
// `baseNodes` and `baseThickness` and rebuilds the room views, restoring the exact base geometry.
// A v1 document is converted once via `ensureV2` before solving.
import { DEFAULT_WALL_CM, dot, innerWallLengths, mul, roomInnerRing, roomWalls, sub } from '../../model/geometry'
import { planPrecision, roundTo } from '../../model/precision'
import type { PlanDoc, SolverChange, SolverHold, SolverKey, StoredNode, StoredWall, Vec } from '../../model/types'
import { wallCentreCm, wallOutsidePlanCm, wallValueLabel } from '../../model/wallValues'
import { applyGraphUpdate } from '../../model/v2/drag'
import { ensureV2 } from '../../model/v2/ensure'
import { applyGlobal, type GlobalApplyOptions, type GlobalReport } from '../rooms/applyGlobal'
import type { GlobalHold } from '../rooms/globalSolve'
import { facadePlannedLengths } from '../rooms/outside/outsideDims'
import { verifiedWalls } from '../rooms/solve'
import { readStorageParams, storageCorners, wallRunMetrics, type StorageParams } from '../storage/geometry'
import { wallLabel } from './lookup'

/** Movement or thickness change threshold (cm) below which a node/wall counts as unchanged. */
const MOVE_TOL_CM = 0.05

/** Distance (cm) within which a room corner matches an endpoint node of its adjacent stored wall. */
const CORNER_NODE_TOL_CM = 0.5

/** Distance (cm) within which an interior T-junction node lies on a wall's base centre line. */
const ON_LINE_TOL_CM = 1

/** Noise threshold (cm) for detecting user edits between prev and next docs. */
const EDIT_EPS_CM = 1e-6

const round1 = (v: number) => roundTo(v, 0.1)

const sameKey = (a: SolverKey, b: SolverKey) => a.kind === b.kind && a.wallId === b.wallId

export type SolverOptions = Omit<GlobalApplyOptions, 'hold'> & {
  /** Inject ISO timestamp for deterministic tests. Defaults to current time. */
  now?: string
}

export type EditedWalls = {
  /** Stored wall ids whose node positions changed. */
  position: string[]
  /** Stored wall ids whose thicknessCm changed. */
  thickness: string[]
  /** Node ids whose position changed. */
  movedNodes: string[]
}

/**
 * Restore the base geometry recorded in `doc.solver` and turn the solver Off.
 * Keeps `revoked`, clears `changes`, `baseNodes`, and `baseThickness`.
 * A doc with no `solver` field is returned unchanged.
 */
export function solverOff(doc: PlanDoc): PlanDoc {
  const s = doc.solver
  if (!s) return doc
  const liveWallIds = doc.walls ? new Set(doc.walls.map((w) => w.id)) : null
  const prunedRevoked = liveWallIds ? s.revoked.filter((h) => liveWallIds.has(h.wallId)) : s.revoked
  const hasBaseNodes = doc.nodes ? doc.nodes.some((n) => n.id in s.baseNodes) : false
  const hasBaseThick = doc.walls ? doc.walls.some((w) => w.id in s.baseThickness) : false
  let next = doc
  if ((hasBaseNodes || hasBaseThick) && doc.schemaVersion === 2 && doc.nodes && doc.walls) {
    const nodes: StoredNode[] = hasBaseNodes
      ? doc.nodes.map((n) => (n.id in s.baseNodes ? { ...n, x: s.baseNodes[n.id].x, y: s.baseNodes[n.id].y } : n))
      : doc.nodes
    const walls: StoredWall[] = hasBaseThick
      ? doc.walls.map((w) => (w.id in s.baseThickness ? { ...w, thicknessCm: s.baseThickness[w.id] } : w))
      : doc.walls
    next = applyGraphUpdate(doc, nodes, walls)
  }
  return {
    ...next,
    solver: {
      enabled: false,
      ...(s.solvedAt !== undefined ? { solvedAt: s.solvedAt } : {}),
      ...(s.rmsCm !== undefined ? { rmsCm: s.rmsCm } : {}),
      changes: [],
      revoked: prunedRevoked,
      baseNodes: {},
      baseThickness: {},
    },
  }
}

/** Build the GlobalHold structure from the doc's revoked/edited holds. */
function holdsFrom(revoked: SolverHold[]): GlobalHold {
  const position: string[] = []
  const thickness: string[] = []
  for (const h of revoked) {
    if (h.kind === 'position') position.push(h.wallId)
    else thickness.push(h.wallId)
  }
  return {
    ...(position.length ? { position } : {}),
    ...(thickness.length ? { thickness } : {}),
  }
}

/**
 * Whole-plan RMS mismatch (cm) of all measured lengths (room inside walls, diagonals, stored wall
 * centre and outside face values) against the actual geometry of `doc`.
 */
function planRmsCm(doc: PlanDoc): number {
  const diffs: number[] = []
  for (const room of doc.rooms) {
    const inner = innerWallLengths(room)
    for (const v of verifiedWalls(doc, room)) {
      diffs.push(v.cm - inner[v.index])
    }
    const dm = doc.measurements[`${room.code}-D`]?.actualCm
    if (room.diagonal && dm && dm > 0) {
      const q = roomInnerRing(room)
      const a = q[room.diagonal[0]]
      const b = q[room.diagonal[1]]
      if (a && b) diffs.push(dm - Math.hypot(b.x - a.x, b.y - a.y))
    }
  }
  const nodes = doc.nodes ?? []
  const walls = doc.walls ?? []
  if (walls.length && nodes.length) {
    let outsidePlan: Map<string, number> | null = null
    for (const w of walls) {
      const cLabel = wallValueLabel(w.id, 'centre')
      const cm = doc.measurements[cLabel]?.actualCm
      if (cm && cm > 0) {
        const planCm = wallCentreCm(nodes, w)
        if (planCm != null) diffs.push(cm - planCm)
      }
      const oLabel = wallValueLabel(w.id, 'outside')
      const om = doc.measurements[oLabel]?.actualCm
      if (om && om > 0) {
        outsidePlan ??= facadePlannedLengths(doc)
        const planCm = outsidePlan.get(oLabel) ?? wallOutsidePlanCm(doc.rooms, nodes, w)
        if (planCm != null) diffs.push(om - planCm)
      }
    }
  }
  return diffs.length ? Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length) : 0
}

/** Compass direction of a vector (plan x right = East, y down = South). */
function compassDir(vx: number, vy: number): 'N' | 'S' | 'E' | 'W' {
  if (Math.abs(vx) >= Math.abs(vy)) return vx >= 0 ? 'E' : 'W'
  return vy >= 0 ? 'S' : 'N'
}

/** Size of a change for sorting (largest first). */
function changeSize(c: SolverChange): number {
  if (c.kind === 'position') return c.moveCm ?? 0
  return Math.abs((c.toCm ?? 0) - (c.fromCm ?? 0))
}

/**
 * Turn the solver On (or re-solve from base).
 * 1. Calls `solverOff` first so the solve always starts from base geometry.
 * 2. Ensures v2 graph (`ensureV2`) so nodes and walls have stable ids.
 * 3. Runs `applyGlobal` with `opts` and holds from `revoked`.
 * 4. Applies solved node positions and wall thicknesses in place to the v2 graph.
 * 5. Diffs base vs solved to record `baseNodes`, `baseThickness`, and sorted `changes`.
 */
export function solverOn(doc: PlanDoc, opts: SolverOptions = {}): { doc: PlanDoc; report: GlobalReport } {
  const offDoc = solverOff(doc)
  const base = offDoc.schemaVersion === 2 && offDoc.nodes && offDoc.walls ? offDoc : ensureV2(offDoc, { now: opts.now })
  const liveWallIds = new Set((base.walls ?? []).map((w) => w.id))
  const revoked: SolverHold[] = (base.solver?.revoked ?? []).filter((h) => liveWallIds.has(h.wallId))
  const hold = holdsFrom(revoked)
  const heldThickSet = new Set(hold.thickness ?? [])

  // Save built-in storage parameters before the solve so we can restore them on their solved host wall.
  const storages = base.rooms.filter((r) => r.storage)
  const savedParams = new Map<string, StorageParams>()
  for (const s of storages) {
    const p = readStorageParams(base, s)
    if (p) savedParams.set(s.id, p)
  }

  const applied = applyGlobal(base, {
    keepLocked: opts.keepLocked,
    surfaceMode: opts.surfaceMode,
    surfaceSigmaPct: opts.surfaceSigmaPct,
    snapThickness: opts.snapThickness,
    angles: opts.angles,
    ...(hold.position?.length || hold.thickness?.length ? { hold } : {}),
  })

  const solvedAt = opts.now ?? new Date().toISOString()

  // If applyGlobal made no change (e.g. no measurements to fit) or the doc is not v2, keep base.
  if (applied.doc === base || base.schemaVersion !== 2 || !base.nodes || !base.walls) {
    const rmsCm = planRmsCm(base)
    return {
      doc: {
        ...base,
        solver: {
          enabled: true,
          solvedAt,
          rmsCm,
          changes: [],
          revoked,
          baseNodes: {},
          baseThickness: {},
        },
      },
      report: { ...applied.report, rmsCm },
    }
  }

  const step = planPrecision(base) || 0.1
  const snap = (v: number) => roundTo(v, step)
  const baseNodeMap = new Map(base.nodes.map((n) => [n.id, n]))
  const baseWallMap = new Map(base.walls.map((w) => [w.id, w]))

  // Map solved room corners back to existing stored node ids (preserving all ids).
  const nodeObs = new Map<string, Vec[]>()
  for (const r of base.rooms) {
    if (r.storage) continue
    const cycle = r.cycle
    const pts = applied.solved.rooms[r.id]
    if (!cycle || cycle.length !== r.vertices.length || !pts || pts.length !== r.vertices.length) continue
    const n = cycle.length
    for (let k = 0; k < n; k++) {
      const p0 = r.vertices[k]
      const p1: Vec = { x: snap(pts[k].x), y: snap(pts[k].y) }
      const wPrev = baseWallMap.get(cycle[(k + n - 1) % n].wallId)
      const wCur = baseWallMap.get(cycle[k].wallId)
      const candidates = new Set<string>()
      if (wPrev) { candidates.add(wPrev.a); candidates.add(wPrev.b) }
      if (wCur) { candidates.add(wCur.a); candidates.add(wCur.b) }
      let bestId: string | null = null
      let bestDist = CORNER_NODE_TOL_CM
      for (const nid of candidates) {
        const bn = baseNodeMap.get(nid)
        if (!bn) continue
        const d = Math.hypot(bn.x - p0.x, bn.y - p0.y)
        if (d <= bestDist) {
          bestDist = d
          bestId = nid
        }
      }
      if (bestId !== null) {
        const list = nodeObs.get(bestId)
        if (list) list.push(p1)
        else nodeObs.set(bestId, [p1])
      }
    }
  }

  let nextNodes: StoredNode[] = base.nodes.map((n) => {
    const obs = nodeObs.get(n.id)
    if (!obs || !obs.length) return n
    const mx = obs.reduce((s, p) => s + p.x, 0) / obs.length
    const my = obs.reduce((s, p) => s + p.y, 0) / obs.length
    return { ...n, x: snap(mx), y: snap(my) }
  })

  // Project interior T-junction nodes onto their moved host wall at the same fractional parameter.
  // Consider ALL base walls (moved and unmoved) so a node lying closer to an unmoved wall is never
  // pulled onto a nearby moved wall.
  const solvedPosMap = new Map(nextNodes.map((n) => [n.id, { x: n.x, y: n.y }]))
  const tJunctionBest = new Map<string, { perp: number; moved: boolean; pos: Vec; dx0: number; dy0: number }>()
  for (const w of base.walls) {
    const a0 = baseNodeMap.get(w.a)
    const b0 = baseNodeMap.get(w.b)
    const a1 = solvedPosMap.get(w.a)
    const b1 = solvedPosMap.get(w.b)
    if (!a0 || !b0 || !a1 || !b1) continue
    const moved = Math.hypot(a1.x - a0.x, a1.y - a0.y) > 1e-9 || Math.hypot(b1.x - b0.x, b1.y - b0.y) > 1e-9
    const len0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
    const len1 = Math.hypot(b1.x - a1.x, b1.y - a1.y)
    if (len0 < 1e-6 || len1 < 1e-6) continue
    const dx0 = (b0.x - a0.x) / len0
    const dy0 = (b0.y - a0.y) / len0
    for (const n0 of base.nodes) {
      if (n0.id === w.a || n0.id === w.b || nodeObs.has(n0.id)) continue
      const rx = n0.x - a0.x
      const ry = n0.y - a0.y
      const perp = Math.abs(dx0 * ry - dy0 * rx)
      if (perp > ON_LINE_TOL_CM) continue
      const u = rx * dx0 + ry * dy0
      if (u <= 1e-6 || u >= len0 - 1e-6) continue
      const prevBest = tJunctionBest.get(n0.id)
      const isCloser =
        !prevBest
        || perp < prevBest.perp - 1e-9
        || (Math.abs(perp - prevBest.perp) <= 1e-9 && !moved && prevBest.moved)
      if (isCloser) {
        const t = u / len0
        tJunctionBest.set(n0.id, {
          perp,
          moved,
          dx0,
          dy0,
          pos: { x: snap(a1.x + (b1.x - a1.x) * t), y: snap(a1.y + (b1.y - a1.y) * t) },
        })
      }
    }
  }
  if (tJunctionBest.size) {
    // Do not project a node that is an endpoint of an unmoved wall running parallel to the host wall.
    const hasParallelUnmovedWall = (nid: string, hostDx: number, hostDy: number): boolean => {
      for (const w of base.walls!) {
        if (w.a !== nid && w.b !== nid) continue
        const a0 = baseNodeMap.get(w.a)
        const b0 = baseNodeMap.get(w.b)
        const a1 = solvedPosMap.get(w.a)
        const b1 = solvedPosMap.get(w.b)
        if (!a0 || !b0 || !a1 || !b1) continue
        const moved = Math.hypot(a1.x - a0.x, a1.y - a0.y) > 1e-9 || Math.hypot(b1.x - b0.x, b1.y - b0.y) > 1e-9
        if (moved) continue
        const len = Math.hypot(b0.x - a0.x, b0.y - a0.y)
        if (len < 1e-6) continue
        const align = Math.abs(((b0.x - a0.x) / len) * hostDx + ((b0.y - a0.y) / len) * hostDy)
        if (align > 0.98) return true
      }
      return false
    }
    nextNodes = nextNodes.map((n) => {
      const hit = tJunctionBest.get(n.id)
      if (!hit || !hit.moved || hasParallelUnmovedWall(n.id, hit.dx0, hit.dy0)) return n
      return { ...n, x: hit.pos.x, y: hit.pos.y }
    })
  }

  // Map solved wall thicknesses from applied.doc.rooms back to stored wall ids.
  const appliedRoomMap = new Map(applied.doc.rooms.map((r) => [r.id, r]))
  const nextThickMap = new Map<string, number>()
  for (const r of base.rooms) {
    if (r.storage) continue
    const ar = appliedRoomMap.get(r.id)
    if (!ar || !r.cycle) continue
    for (const f of r.cycle) {
      if (heldThickSet.has(f.wallId)) continue
      const cm = ar.walls[f.cornerId]?.thicknessCm
      const oldCm = baseWallMap.get(f.wallId)?.thicknessCm
      if (cm && cm > 0 && oldCm !== undefined && Math.abs(cm - oldCm) >= MOVE_TOL_CM) {
        nextThickMap.set(f.wallId, cm)
      }
    }
  }

  const nextWalls: StoredWall[] = base.walls.map((w) => {
    const cm = nextThickMap.get(w.id)
    return cm !== undefined ? { ...w, thicknessCm: cm } : w
  })

  // Move built-in storage nodes in place with their solved host wall so every node and wall id
  // stays stable and baseNodes covers them for exact solverOff restoration.
  const nonStorageWallIds = new Set<string>()
  for (const r of base.rooms) {
    if (r.storage) continue
    for (const f of r.cycle ?? []) nonStorageWallIds.add(f.wallId)
  }
  const storageOnlyWallIds = new Set<string>()
  for (const s of storages) {
    for (const f of s.cycle ?? []) {
      if (!nonStorageWallIds.has(f.wallId)) storageOnlyWallIds.add(f.wallId)
    }
  }

  if (storages.length) {
    const prelimDoc = applyGraphUpdate(base, nextNodes, nextWalls)
    const nextPosMap = new Map(nextNodes.map((n) => [n.id, { x: n.x, y: n.y }]))
    const nextWallThickMap = new Map(nextWalls.map((w) => [w.id, w.thicknessCm]))
    const nonStorageNodeIds = new Set<string>()
    for (const w of base.walls) {
      if (!nonStorageWallIds.has(w.id)) continue
      nonStorageNodeIds.add(w.a)
      nonStorageNodeIds.add(w.b)
    }
    const isHostSplitNode = (nid: string, hostRunWallIds: Set<string>) =>
      base.walls!.every((w) => (w.a !== nid && w.b !== nid) || !nonStorageWallIds.has(w.id) || hostRunWallIds.has(w.id))

    const storageNodePos = new Map<string, Vec>()
    for (const s of storages) {
      const p = savedParams.get(s.id)
      const cycle = s.cycle
      if (!p || !cycle || cycle.length < 4) continue
      const parentId = s.storage?.parentRoomId
      const parent = base.rooms.find((r) => r.id === parentId)
      const solvedParent = prelimDoc.rooms.find((r) => r.id === parentId)
      if (!parent?.cycle || !solvedParent?.cycle) continue

      const frontWallId = cycle[0].wallId
      const parentFaceIdx = parent.cycle.findIndex((f) => f.wallId === frontWallId)
      if (parentFaceIdx < 0) continue
      const baseMetrics = wallRunMetrics(parent, parentFaceIdx)
      const solvedMetrics = wallRunMetrics(solvedParent, parentFaceIdx)
      const solvedPw = roomWalls(solvedParent)[parentFaceIdx]
      const frontWall = baseWallMap.get(frontWallId)
      if (!baseMetrics || !solvedMetrics || !solvedPw || !frontWall) continue

      const baseA = baseNodeMap.get(frontWall.a)
      const baseB = baseNodeMap.get(frontWall.b)
      if (!baseA || !baseB) continue
      const dotA = dot(sub(baseA, baseMetrics.startCentre), baseMetrics.dir)
      const dotB = dot(sub(baseB, baseMetrics.startCentre), baseMetrics.dir)
      const nA = dotA <= dotB ? frontWall.a : frontWall.b
      const nB = dotA <= dotB ? frontWall.b : frontWall.a

      const wSide1 = baseWallMap.get(cycle[1].wallId)
      const wSide2 = baseWallMap.get(cycle[cycle.length - 1].wallId)
      const otherEnd = (w: StoredWall | undefined, nid: string) =>
        !w ? null : w.a === nid ? w.b : w.b === nid ? w.a : null
      const nC = otherEnd(wSide1, nB) ?? otherEnd(wSide2, nB)
      const nD = otherEnd(wSide1, nA) ?? otherEnd(wSide2, nA)

      const hostRunWallIds = new Set(baseMetrics.faceIndices.map((fi) => parent.cycle![fi].wallId))
      const h1 = nextWallThickMap.get(frontWallId) ?? DEFAULT_WALL_CM
      const { A, B } = storageCorners(
        solvedMetrics.startCentre,
        solvedMetrics.endCentre,
        solvedPw.inward,
        h1,
        p,
        solvedMetrics.cornerInset,
      )
      if (isHostSplitNode(nA, hostRunWallIds)) storageNodePos.set(nA, { x: snap(A.x), y: snap(A.y) })
      if (isHostSplitNode(nB, hostRunWallIds)) storageNodePos.set(nB, { x: snap(B.x), y: snap(B.y) })

      const posA = storageNodePos.get(nA) ?? nextPosMap.get(nA)
      const posB = storageNodePos.get(nB) ?? nextPosMap.get(nB)
      if (!posA || !posB) continue

      const out = mul(solvedPw.inward, -1)
      const depthOut = h1 / 2 + p.depthCm + p.backCm / 2
      if (nC && !nonStorageNodeIds.has(nC)) {
        storageNodePos.set(nC, { x: snap(posB.x + out.x * depthOut), y: snap(posB.y + out.y * depthOut) })
      }
      if (nD && !nonStorageNodeIds.has(nD)) {
        storageNodePos.set(nD, { x: snap(posA.x + out.x * depthOut), y: snap(posA.y + out.y * depthOut) })
      }

      // Interpolate any intermediate back-wall nodes between nC and nD.
      if (nC && nD && cycle.length > 4) {
        const c0 = baseNodeMap.get(nC)
        const d0 = baseNodeMap.get(nD)
        const c1 = storageNodePos.get(nC) ?? nextPosMap.get(nC)
        const d1 = storageNodePos.get(nD) ?? nextPosMap.get(nD)
        if (c0 && d0 && c1 && d1) {
          const backLen0 = Math.hypot(d0.x - c0.x, d0.y - c0.y)
          if (backLen0 > 1e-6) {
            const bdx = (d0.x - c0.x) / backLen0
            const bdy = (d0.y - c0.y) / backLen0
            for (const bf of cycle.slice(2, -1)) {
              const bw = baseWallMap.get(bf.wallId)
              if (!bw) continue
              for (const nid of [bw.a, bw.b]) {
                if (nid === nC || nid === nD || nonStorageNodeIds.has(nid)) continue
                const bn = baseNodeMap.get(nid)
                if (!bn) continue
                const frac = Math.min(Math.max(((bn.x - c0.x) * bdx + (bn.y - c0.y) * bdy) / backLen0, 0), 1)
                storageNodePos.set(nid, {
                  x: snap(c1.x + (d1.x - c1.x) * frac),
                  y: snap(c1.y + (d1.y - c1.y) * frac),
                })
              }
            }
          }
        }
      }
    }

    if (storageNodePos.size) {
      nextNodes = nextNodes.map((n) => {
        const p = storageNodePos.get(n.id)
        return p ? { ...n, x: p.x, y: p.y } : n
      })
    }
  }

  // Apply updated nodes and walls in place (keeping all ids stable).
  const nextDoc = applyGraphUpdate(base, nextNodes, nextWalls)

  // Diff base vs solved to record baseNodes, baseThickness, and SolverChange list.
  const nextNodeMap = new Map((nextDoc.nodes ?? []).map((n) => [n.id, n]))
  const nextWallMap = new Map((nextDoc.walls ?? []).map((w) => [w.id, w]))

  const baseNodes: Record<string, { x: number; y: number }> = {}
  for (const n0 of base.nodes) {
    const n1 = nextNodeMap.get(n0.id)
    if (n1 && Math.hypot(n1.x - n0.x, n1.y - n0.y) > MOVE_TOL_CM) {
      baseNodes[n0.id] = { x: n0.x, y: n0.y }
    }
  }

  const baseThickness: Record<string, number> = {}
  for (const w0 of base.walls) {
    const w1 = nextWallMap.get(w0.id)
    if (
      w1
      && w0.thicknessCm !== undefined
      && w1.thicknessCm !== undefined
      && Math.abs(w1.thicknessCm - w0.thicknessCm) >= MOVE_TOL_CM
    ) {
      baseThickness[w0.id] = w0.thicknessCm
    }
  }

  const changes: SolverChange[] = []
  for (const w0 of base.walls) {
    if (storageOnlyWallIds.has(w0.id)) continue
    const label = wallLabel(base, w0.id)
    const a0 = baseNodeMap.get(w0.a)
    const b0 = baseNodeMap.get(w0.b)
    const a1 = nextNodeMap.get(w0.a)
    const b1 = nextNodeMap.get(w0.b)
    if (a0 && b0 && a1 && b1) {
      const len0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
      const len1 = Math.hypot(b1.x - a1.x, b1.y - a1.y)
      if (len0 > 1e-6) {
        const ux = (b0.x - a0.x) / len0
        const uy = (b0.y - a0.y) / len0
        const nx = -uy
        const ny = ux
        const pa = (a1.x - a0.x) * nx + (a1.y - a0.y) * ny
        const pb = (b1.x - b0.x) * nx + (b1.y - b0.y) * ny
        const pMax = Math.abs(pa) >= Math.abs(pb) ? pa : pb
        const moveCm = Math.abs(pMax)
        if (moveCm > MOVE_TOL_CM) {
          changes.push({
            kind: 'position',
            wallId: w0.id,
            label,
            moveCm: round1(moveCm),
            dir: compassDir(pMax * nx, pMax * ny),
            lengthFromCm: round1(len0),
            lengthToCm: round1(len1),
          })
        }
      }
    }
    if (w0.id in baseThickness) {
      const w1 = nextWallMap.get(w0.id)!
      changes.push({
        kind: 'thickness',
        wallId: w0.id,
        label,
        fromCm: round1(baseThickness[w0.id]),
        toCm: round1(w1.thicknessCm!),
      })
    }
  }

  changes.sort((a, b) => changeSize(b) - changeSize(a) || a.wallId.localeCompare(b.wallId))

  const rmsCm = planRmsCm(nextDoc)

  return {
    doc: {
      ...nextDoc,
      solver: {
        enabled: true,
        solvedAt,
        rmsCm,
        changes,
        revoked,
        baseNodes,
        baseThickness,
      },
    },
    report: { ...applied.report, rmsCm },
  }
}

/**
 * Revoke one solver change: hold that wall's position or thickness at its base value.
 * If the solver is On, re-solves immediately with the hold active. If Off, only edits `revoked`.
 */
export function revokeChange(
  doc: PlanDoc,
  key: SolverKey,
  opts: SolverOptions = {},
): { doc: PlanDoc; report: GlobalReport | null } {
  const prev = doc.solver
  const existing = prev?.revoked ?? []
  const matched = prev?.changes.find((c) => sameKey(c, key))
  const label = matched?.label || wallLabel(doc, key.wallId)
  const nextRevoked: SolverHold[] = [
    ...existing.filter((h) => !sameKey(h, key)),
    { ...key, by: 'revoke', ...(label ? { label } : {}) },
  ]
  if (!prev?.enabled) {
    return {
      doc: {
        ...doc,
        solver: prev
          ? { ...prev, revoked: nextRevoked }
          : { enabled: false, changes: [], revoked: nextRevoked, baseNodes: {}, baseThickness: {} },
      },
      report: null,
    }
  }
  const withHold: PlanDoc = { ...doc, solver: { ...prev, revoked: nextRevoked } }
  return solverOn(withHold, opts)
}

/**
 * Restore a revoked/edited hold so the solver may move that wall again.
 * If the solver is On, re-solves immediately. If Off, only edits `revoked`.
 */
export function restoreChange(
  doc: PlanDoc,
  key: SolverKey,
  opts: SolverOptions = {},
): { doc: PlanDoc; report: GlobalReport | null } {
  const prev = doc.solver
  if (!prev) return { doc, report: null }
  const nextRevoked = prev.revoked.filter((h) => !sameKey(h, key))
  if (!prev.enabled) {
    return {
      doc: { ...doc, solver: { ...prev, revoked: nextRevoked } },
      report: null,
    }
  }
  const withoutHold: PlanDoc = { ...doc, solver: { ...prev, revoked: nextRevoked } }
  return solverOn(withoutHold, opts)
}

/**
 * Detect stored walls whose node positions or thickness changed between `prev` and `next`.
 * Ignores solver writes (`next.solver !== prev.solver`).
 */
export function userEditedWalls(prev: PlanDoc, next: PlanDoc): EditedWalls {
  if (next.solver !== prev.solver) return { position: [], thickness: [], movedNodes: [] }
  if (next.nodes === prev.nodes && next.walls === prev.walls) return { position: [], thickness: [], movedNodes: [] }

  const prevNodes = new Map((prev.nodes ?? []).map((n) => [n.id, n]))
  const movedNodeSet = new Set<string>()
  for (const n of next.nodes ?? []) {
    const p = prevNodes.get(n.id)
    if (!p || Math.hypot(n.x - p.x, n.y - p.y) > EDIT_EPS_CM) movedNodeSet.add(n.id)
  }

  const posSet = new Set<string>()
  const thickSet = new Set<string>()
  const prevWalls = new Map((prev.walls ?? []).map((w) => [w.id, w]))
  const nextNodes = new Map((next.nodes ?? []).map((n) => [n.id, n]))
  for (const w of next.walls ?? []) {
    const pw = prevWalls.get(w.id)
    if (movedNodeSet.has(w.a) || movedNodeSet.has(w.b)) {
      const a0 = pw ? prevNodes.get(pw.a) : prevNodes.get(w.a)
      const b0 = pw ? prevNodes.get(pw.b) : prevNodes.get(w.b)
      const a1 = nextNodes.get(w.a)
      const b1 = nextNodes.get(w.b)
      if (a0 && b0 && a1 && b1) {
        const len0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
        if (len0 > 1e-6) {
          const nx = -(b0.y - a0.y) / len0
          const ny = (b0.x - a0.x) / len0
          const pa = Math.abs((a1.x - a0.x) * nx + (a1.y - a0.y) * ny)
          const pb = Math.abs((b1.x - b0.x) * nx + (b1.y - b0.y) * ny)
          if (Math.max(pa, pb) > EDIT_EPS_CM) posSet.add(w.id)
        } else {
          posSet.add(w.id)
        }
      } else {
        posSet.add(w.id)
      }
    }
    if (
      pw
      && pw.thicknessCm !== undefined
      && w.thicknessCm !== undefined
      && Math.abs(w.thicknessCm - pw.thicknessCm) > EDIT_EPS_CM
    ) {
      thickSet.add(w.id)
    }
  }

  return {
    position: [...posSet],
    thickness: [...thickSet],
    movedNodes: [...movedNodeSet],
  }
}

/**
 * Pure drop-on-edit transition (store-free, used by both `solver/rule.ts` and `core/commands.ts`).
 * When a user edit changes wall positions or thicknesses while the solver is On, drops the
 * recorded changes for edited walls (perpendicular-only for positions), treats the user's new
 * value as base (removing from `baseNodes` / `baseThickness`), holds edited walls with
 * `by: 'edit'`, and prunes any entries referencing deleted walls or nodes.
 * Solver writes (`next.solver !== prev.solver`) are ignored.
 */
export function applySolverEdit(prev: PlanDoc, next: PlanDoc): PlanDoc {
  const s = next.solver
  if (!s?.enabled) return next
  if (next.solver !== prev.solver) return next

  const edited = userEditedWalls(prev, next)
  const hasGraph = next.nodes !== undefined && next.walls !== undefined
  const liveNodeIds = hasGraph ? new Set(next.nodes!.map((n) => n.id)) : null
  const liveWallIds = hasGraph ? new Set(next.walls!.map((w) => w.id)) : null
  const hasDeleted =
    liveNodeIds !== null
    && liveWallIds !== null
    && (
      s.changes.some((c) => !liveWallIds.has(c.wallId))
      || Object.keys(s.baseNodes).some((nid) => !liveNodeIds.has(nid))
      || Object.keys(s.baseThickness).some((wid) => !liveWallIds.has(wid))
      || s.revoked.some((h) => !liveWallIds.has(h.wallId))
    )

  if (!edited.position.length && !edited.thickness.length && !edited.movedNodes.length && !hasDeleted) return next

  const posSet = new Set(edited.position)
  const thickSet = new Set(edited.thickness)
  const movedNodeSet = new Set(edited.movedNodes)

  const changes = s.changes.filter(
    (c) =>
      (!liveWallIds || liveWallIds.has(c.wallId))
      && !(c.kind === 'position' && posSet.has(c.wallId))
      && !(c.kind === 'thickness' && thickSet.has(c.wallId)),
  )

  const baseNodes: Record<string, { x: number; y: number }> = {}
  for (const [nid, pt] of Object.entries(s.baseNodes)) {
    if ((!liveNodeIds || liveNodeIds.has(nid)) && !movedNodeSet.has(nid)) baseNodes[nid] = pt
  }

  const baseThickness: Record<string, number> = {}
  for (const [wid, cm] of Object.entries(s.baseThickness)) {
    if ((!liveWallIds || liveWallIds.has(wid)) && !thickSet.has(wid)) baseThickness[wid] = cm
  }

  const revoked: SolverHold[] = liveWallIds ? s.revoked.filter((h) => liveWallIds.has(h.wallId)) : [...s.revoked]
  const addEditHold = (kind: 'position' | 'thickness', wallId: string) => {
    if (liveWallIds && !liveWallIds.has(wallId)) return
    const prevChange = s.changes.find((c) => c.kind === kind && c.wallId === wallId)
    const prevHold = revoked.find((h) => h.kind === kind && h.wallId === wallId)
    const label = prevChange?.label || prevHold?.label || wallLabel(next, wallId)
    const hold: SolverHold = { kind, wallId, by: 'edit', ...(label ? { label } : {}) }
    const idx = revoked.findIndex((h) => h.kind === kind && h.wallId === wallId)
    if (idx >= 0) revoked[idx] = hold
    else revoked.push(hold)
  }
  for (const wallId of edited.position) addEditHold('position', wallId)
  for (const wallId of edited.thickness) addEditHold('thickness', wallId)

  return {
    ...next,
    solver: {
      ...s,
      changes,
      revoked,
      baseNodes,
      baseThickness,
    },
  }
}
