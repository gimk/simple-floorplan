// Tests of the sync sender (docs/walls-plan.md phase 5c, Safety): a snapshot job for a project that
// is not the active one must go out in the v2 format. On an old v1 app the user could queue a
// snapshot for project A, switch to project B, then update the app: project A stays a v1 document in
// IndexedDB while the server already holds it as v2. A v1 payload would get `409 update_required`
// and the reload guard would block the whole outbox.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDoc, Room } from '../model/types'
import { emptyDoc, useDoc } from '../model/store'

const docs = new Map<string, PlanDoc>()

vi.mock('./idb', async (orig) => ({
  ...(await orig<object>()),
  getDoc: vi.fn(async (projectId: string) => docs.get(projectId) ?? null),
}))

import * as idb from './idb'
import { __test } from './sync'

/** A v1 document: one room, no wall graph, no schemaVersion. */
const v1Doc = (projectId: string): PlanDoc => {
  const room: Room = {
    id: 'A',
    code: 'A',
    name: 'A',
    vertices: [
      { id: 'A-v0', x: 0, y: 0 },
      { id: 'A-v1', x: 400, y: 0 },
      { id: 'A-v2', x: 400, y: 300 },
      { id: 'A-v3', x: 0, y: 300 },
    ],
    holes: [],
    walls: {},
    walkOrder: 1,
  }
  return { ...emptyDoc(), projectId, rooms: [room] }
}

const snapshotJob = { seq: 1, kind: 'snapshot' as const, key: '', payload: null, enqueuedAt: '2026-11-24T10:00:00.000Z' }

/** The body of every PUT request, in order. */
let sent: { url: string; body: Record<string, unknown> }[]

/** The server: a project in v2 refuses a v1 snapshot with 409 update_required. */
function stubServer() {
  sent = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    sent.push({ url, body })
    if (body.schemaVersion !== 2) {
      return new Response(JSON.stringify({ error: 'update_required' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ version: 7 }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  docs.clear()
  useDoc.setState({ doc: emptyDoc() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(idb.getDoc).mockClear()
})

describe('the snapshot sender', () => {
  it('converts a v1 document of a project that is not active before it goes out', async () => {
    stubServer()
    const v1 = v1Doc('proj-A')
    docs.set('proj-A', v1)
    // The app is on another project, so the doc comes from IndexedDB.
    useDoc.setState({ doc: { ...emptyDoc(), projectId: 'proj-B' } })

    await __test.sender(snapshotJob, 'proj-A', new AbortController().signal)

    // One PUT, in the v2 format: the server does not answer 409 update_required.
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('/api/projects/proj-A/snapshot')
    expect(sent[0].body.schemaVersion).toBe(2)
    // The conversion is the load step: walls, nodes and a cycle for the room, and the report.
    expect(Array.isArray(sent[0].body.walls)).toBe(true)
    expect(Array.isArray(sent[0].body.nodes)).toBe(true)
    const rooms = sent[0].body.rooms as Room[]
    expect(rooms[0].cycle?.length).toBe(4)
    expect(sent[0].body.conversion).toBeDefined()
    // The saved document in IndexedDB is not changed by the send.
    expect(docs.get('proj-A')).toBe(v1)
  })

  it('sends the active project as it is when it is already v2', async () => {
    stubServer()
    const doc: PlanDoc = { ...v1Doc('proj-B'), schemaVersion: 2 }
    useDoc.setState({ doc })
    await __test.sender(snapshotJob, 'proj-B', new AbortController().signal)
    expect(sent).toHaveLength(1)
    expect(sent[0].body.schemaVersion).toBe(2)
    expect(idb.getDoc).not.toHaveBeenCalled()
  })

  it('sends nothing for a project that is not stored on this device', async () => {
    stubServer()
    await __test.sender(snapshotJob, 'proj-gone', new AbortController().signal)
    expect(sent).toHaveLength(0)
  })
})
