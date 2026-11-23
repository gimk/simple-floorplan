// Format routes for Simple Floorplan: .sfp text DSL and DXF export.
// Mounted from functions/app.ts via registerFormatsRoutes(app) — this file is
// owned by the "formats" agent; keep route edits here, not in app.ts.
//
//   GET /api/projects/:id/plan.sfp          -> text/plain .sfp DSL of the current plan
//   PUT /api/projects/:id/plan.sfp          -> replace geometry from a .sfp body (text/plain);
//                                               ?dryRun=1 returns a diff summary without writing;
//                                               ?baseVersion=N gives optimistic concurrency (409 on mismatch)
//   GET /api/projects/:id/plan.dxf          -> ASCII DXF R12 attachment (application/dxf)
import { Hono } from 'hono'
import { DslParseError, dslToPlan, planToDsl } from '../../src/core/dsl'
import { planToDxf } from '../../src/core/dxf'
import { querySummary } from '../../src/core/queries'
import { commitDoc, loadProjectDoc, UPDATE_REQUIRED_MESSAGE, UpdateRequiredError } from '../store'
import type { PlanDoc, Room, WallElement } from '../../src/model/types'

type Env = {
  DB: D1Database
  IMAGES: R2Bucket
  PASSCODE?: string
}

// ---------- diff summary ----------

const roomSig = (r: Room) =>
  JSON.stringify({
    code: r.code,
    name: r.name,
    vertices: r.vertices.map((v) => [v.x, v.y]),
    holes: r.holes ?? [],
    walls: r.vertices.map((v, i) => {
      const p = r.walls[v.id]
      return p ? [i, p.type, p.thicknessCm, Boolean(p.locked)] : null
    }),
    ceilingCm: r.ceilingCm ?? null,
    outdoor: Boolean(r.outdoor),
    walkOrder: r.walkOrder,
    diagonal: r.diagonal ?? null,
  })

const elSig = (e: WallElement) =>
  JSON.stringify([e.roomId, e.wallStart, e.kind, e.variant ?? null, e.offsetCm, e.widthCm, e.heightCm ?? null, e.sillCm ?? null, e.depthCm ?? null])

export function diffDocs(prev: PlanDoc, next: PlanDoc) {
  const prevRooms = new Map(prev.rooms.map((r) => [r.code, r]))
  const nextRooms = new Map(next.rooms.map((r) => [r.code, r]))
  const rooms = {
    added: [...nextRooms.keys()].filter((c) => !prevRooms.has(c)),
    removed: [...prevRooms.keys()].filter((c) => !nextRooms.has(c)),
    changed: [...nextRooms.keys()].filter((c) => prevRooms.has(c) && roomSig(prevRooms.get(c)!) !== roomSig(nextRooms.get(c)!)),
  }
  const prevEls = new Set((prev.elements ?? []).map(elSig))
  const nextEls = new Set((next.elements ?? []).map(elSig))
  const elements = {
    added: [...nextEls].filter((s) => !prevEls.has(s)).length,
    removed: [...prevEls].filter((s) => !nextEls.has(s)).length,
  }
  const prevM = prev.measurements ?? {}
  const nextM = next.measurements ?? {}
  const measurements = {
    added: Object.keys(nextM).filter((l) => !(l in prevM)),
    removed: Object.keys(prevM).filter((l) => !(l in nextM)),
    changed: Object.keys(nextM).filter((l) => l in prevM && prevM[l].actualCm !== nextM[l].actualCm),
  }
  const prevN = prev.roomNotes ?? {}
  const nextN = next.roomNotes ?? {}
  const notes = {
    added: Object.keys(nextN).filter((c) => !(c in prevN)),
    removed: Object.keys(prevN).filter((c) => !(c in nextN)),
    changed: Object.keys(nextN).filter((c) => c in prevN && prevN[c] !== nextN[c]),
  }
  return {
    rooms,
    elements,
    measurements,
    notes,
    tapes: { prev: prev.tapes?.length ?? 0, next: next.tapes?.length ?? 0 },
    pins: { prev: prev.pins?.length ?? 0, next: next.pins?.length ?? 0 },
  }
}

// ---------- routes ----------

export function registerFormatsRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/projects/:id/plan.sfp', async (c) => {
    const id = c.req.param('id')
    const loaded = await loadProjectDoc(c.env.DB, id)
    if (!loaded) return c.json({ error: 'not_found' }, 404)
    return new Response(planToDsl(loaded.doc), {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  })

  app.put('/projects/:id/plan.sfp', async (c) => {
    const id = c.req.param('id')
    const loaded = await loadProjectDoc(c.env.DB, id)
    if (!loaded) return c.json({ error: 'not_found' }, 404)

    const baseVersionParam = c.req.query('baseVersion')
    if (baseVersionParam !== undefined) {
      const baseVersion = Number(baseVersionParam)
      if (!Number.isInteger(baseVersion) || baseVersion !== loaded.version) {
        return c.json({ error: 'version_conflict', latestVersion: loaded.version }, 409)
      }
    }

    const text = await c.req.text()
    let next: ReturnType<typeof dslToPlan>
    try {
      next = dslToPlan(text, loaded.doc)
    } catch (err) {
      if (err instanceof DslParseError) {
        return c.json({ error: 'dsl_parse_error', message: err.message, line: err.line }, 400)
      }
      throw err
    }
    next.projectId = id

    const diff = diffDocs(loaded.doc, next)
    const summary = querySummary(next)
    const dryRun = c.req.query('dryRun') === '1'

    if (dryRun) {
      return c.json({ dryRun: true, version: loaded.version, diff, summary })
    }
    const baseVersion = baseVersionParam !== undefined ? Number(baseVersionParam) : undefined
    let version: number
    try {
      ;({ version } = await commitDoc(c.env.DB, id, loaded, next, baseVersion))
    } catch (err) {
      // Safety (docs/walls-plan.md 5c): a .sfp body that would go back to v1 on a v2 project.
      if (err instanceof UpdateRequiredError) {
        return c.json({ error: 'update_required', message: UPDATE_REQUIRED_MESSAGE }, 409)
      }
      throw err
    }
    return c.json({ version, diff, summary })
  })

  app.get('/projects/:id/plan.dxf', async (c) => {
    const id = c.req.param('id')
    const loaded = await loadProjectDoc(c.env.DB, id)
    if (!loaded) return c.json({ error: 'not_found' }, 404)
    const filename = `${loaded.doc.title || id}.dxf`.replace(/[^\w.-]+/g, '_')
    return new Response(planToDxf(loaded.doc), {
      status: 200,
      headers: {
        'content-type': 'application/dxf; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    })
  })
}
