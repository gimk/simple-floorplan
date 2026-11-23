// D1 + R2 persistence adapter for the MCP server.
// Doc load/commit go through the shared implementation in functions/store.ts
// (same one used by the commands route and the .sfp PUT route).
import { commitDoc, loadProjectDoc, UPDATE_REQUIRED_MESSAGE, UpdateRequiredError } from '../store'
import type { PlanDocV1 } from '../../src/core/schema'
import type { LoadedProject, McpStore, ProjectEvent, ProjectSummaryRow } from './types'

type ProjectRow = { id: string; name: string; title: string | null; updated_at: string }
type EventRow = {
  id: string
  project_id: string
  ts: string
  actor: string
  kind: string
  summary: string
  payload_json: string
}

const nowIso = (): string => new Date().toISOString()

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function createD1McpStore(db: D1Database, images?: R2Bucket): McpStore {
  return {
    async listProjects(): Promise<ProjectSummaryRow[]> {
      const { results } = await db
        .prepare('SELECT id, name, title, updated_at FROM projects ORDER BY updated_at DESC')
        .all<ProjectRow>()
      return results.map((r) => ({
        id: r.id,
        name: r.name,
        title: r.title,
        updatedAt: r.updated_at,
      }))
    },

    async createProject(input: { name: string; title?: string | null }): Promise<ProjectSummaryRow> {
      const name = input.name.trim() || 'New project'
      const title = input.title ?? null
      const id = crypto.randomUUID()
      const now = nowIso()
      await db
        .prepare('INSERT INTO projects (id, name, title, updated_at) VALUES (?, ?, ?, ?)')
        .bind(id, name, title, now)
        .run()
      return { id, name, title, updatedAt: now }
    },

    async loadProject(id: string): Promise<LoadedProject | null> {
      const loaded = await loadProjectDoc(db, id)
      if (!loaded) return null
      return {
        project: {
          id: loaded.project.id,
          name: loaded.project.name,
          title: loaded.project.title,
          updatedAt: loaded.project.updated_at,
        },
        doc: loaded.doc,
        version: loaded.version,
      }
    },

    async commitDoc(id: string, prev: LoadedProject, nextDoc: PlanDocV1): Promise<{ version: number; updatedAt: string }> {
      try {
        return await commitDoc(db, id, { doc: prev.doc, version: prev.version }, nextDoc)
      } catch (err) {
        // Safety (docs/walls-plan.md 5c): a v1 write on a v2 project. Say what to do.
        if (err instanceof UpdateRequiredError) throw new Error(UPDATE_REQUIRED_MESSAGE)
        throw err
      }
    },

    async listEvents(projectId: string, since?: string, limit?: number): Promise<ProjectEvent[]> {
      const sinceIso = since ?? '1970-01-01T00:00:00.000Z'
      const max = limit !== undefined && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100
      const { results } = await db
        .prepare(
          'SELECT id, project_id, ts, actor, kind, summary, payload_json FROM project_events WHERE project_id = ? AND ts > ? ORDER BY ts ASC, id ASC LIMIT ?',
        )
        .bind(projectId, sinceIso, max)
        .all<EventRow>()
      return results.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        ts: r.ts,
        actor: r.actor,
        kind: r.kind,
        summary: r.summary,
        payload: (() => {
          try {
            return JSON.parse(r.payload_json)
          } catch {
            return null
          }
        })(),
      }))
    },

    async getBackgroundHref(doc: PlanDocV1): Promise<string | undefined> {
      const bg = doc.background
      if (!bg) return undefined
      if (bg.r2Key && images) {
        const obj = await images.get(bg.r2Key)
        if (obj) {
          const ct = obj.httpMetadata?.contentType ?? 'image/png'
          const b64 = arrayBufferToBase64(await obj.arrayBuffer())
          return `data:${ct};base64,${b64}`
        }
      }
      if (bg.src && bg.src.startsWith('data:')) return bg.src
      return undefined
    },
  }
}
