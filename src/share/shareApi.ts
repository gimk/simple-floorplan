// Bearer-token client of the read-only share viewer (./ShareViewer.tsx).
// The token is read from location.hash by the viewer, kept in memory, and sent only
// as an `Authorization: Bearer` header. It is never put in a query string, never
// logged, and never stored in localStorage.
import type { PlanDoc } from '../model/types'

export type WhoAmI = {
  projectId: string | null
  scopes: string[]
  actor: string
  viaToken: boolean
  canRead: boolean
}

/** GET /api/projects/:id answer: the PlanDoc plus the snapshot version. */
export type SharePlan = PlanDoc & { version?: number }

/** A failed share request, with the HTTP status kept for the error screens. */
export class ShareApiError extends Error {
  status: number
  constructor(status: number) {
    super(`share request failed with status ${status}`)
    this.name = 'ShareApiError'
    this.status = status
  }
}

/** Same-origin API base: one Worker serves the SPA and the API. */
const BASE = '/api'

async function shareGet(path: string, token: string, accept: string): Promise<Response> {
  const res = await fetch(BASE + path, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, accept },
    // A revoked link must stop working at once, so no HTTP cache and no cookies.
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  if (!res.ok) throw new ShareApiError(res.status)
  return res
}

/** GET /api/share/whoami — which project may this token read? */
export async function whoAmI(token: string): Promise<WhoAmI> {
  const res = await shareGet('/share/whoami', token, 'application/json')
  const body = (await res.json()) as Partial<WhoAmI>
  return {
    projectId: typeof body.projectId === 'string' && body.projectId ? body.projectId : null,
    scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
    actor: typeof body.actor === 'string' ? body.actor : '',
    viaToken: body.viaToken === true,
    canRead: body.canRead === true,
  }
}

/** GET /api/projects/:id — the plan, with the token as the only credential. */
export async function fetchPlan(token: string, projectId: string): Promise<SharePlan> {
  const res = await shareGet(`/projects/${encodeURIComponent(projectId)}`, token, 'application/json')
  return (await res.json()) as SharePlan
}

/** GET /api/projects/:id/plan.dxf — the DXF file as a blob, ready to download. */
export async function fetchDxf(token: string, projectId: string): Promise<Blob> {
  const res = await shareGet(`/projects/${encodeURIComponent(projectId)}/plan.dxf`, token, 'application/dxf')
  return await res.blob()
}
