// End-to-end API smoke test. Usage: BASE_URL=http://localhost:8788 [SFP_TOKEN=...] node scripts/smoke.mjs
const BASE = (process.env.BASE_URL ?? 'http://localhost:8788').replace(/\/+$/, '')
const TOKEN = process.env.SFP_TOKEN ?? process.env.API_TOKEN
const headers = {}
if (TOKEN) {
  if (TOKEN.startsWith('sfp_')) headers.Authorization = `Bearer ${TOKEN}`
  else headers['x-api-token'] = TOKEN
}

let failed = 0
async function step(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
async function req(method, path, body) {
  const init = { method, headers: { ...headers } }
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, init)
  return { res, text: await res.text() }
}
const parse = (text) => JSON.parse(text)

let id = null
let roomId = null
try {
  await step('GET /llms.txt', async () => {
    const { res, text } = await req('GET', '/llms.txt')
    assert(res.status === 200, `status ${res.status}`)
    assert(text.includes('ProjectDoc'), 'missing ProjectDoc')
  })
  await step('GET /api/openapi.json', async () => {
    const { res, text } = await req('GET', '/api/openapi.json')
    assert(res.status === 200, `status ${res.status}`)
    assert(parse(text).openapi, 'missing openapi field')
  })
  await step('GET /api/schema/project.v3.json', async () => {
    const { res, text } = await req('GET', '/api/schema/project.v3.json')
    assert(res.status === 200, `status ${res.status}`)
    assert(JSON.stringify(parse(text)).includes('schemaVersion'), 'missing schemaVersion')
  })
  await step('POST /api/projects', async () => {
    const { res, text } = await req('POST', '/api/projects', { title: 'smoke-test' })
    assert(res.status === 201, `status ${res.status}: ${text}`)
    id = parse(text).id
    assert(id, 'no id returned')
  })
  if (id) {
    await step('POST commands (room + door)', async () => {
      const room = await req('POST', `/api/projects/${id}/commands`, {
        command: { type: 'add_room_rect', xCm: 0, yCm: 0, widthCm: 400, heightCm: 300 },
      })
      assert(room.res.status === 200, `room status ${room.res.status}: ${room.text}`)
      roomId = parse(room.text).result?.roomId
      assert(roomId, 'no roomId in result')
      const door = await req('POST', `/api/projects/${id}/commands`, {
        command: { type: 'add_opening_on_wall', roomId, edgeIndex: 0, offsetCm: 200, kind: 'door' },
      })
      assert(door.res.status === 200, `door status ${door.res.status}: ${door.text}`)
    })
    await step('POST query summary + validate', async () => {
      const s = await req('POST', `/api/projects/${id}/query`, { kind: 'summary' })
      assert(s.res.status === 200, `summary status ${s.res.status}`)
      const abs = parse(s.text).summary.artboards
      const rooms = abs.reduce((n, a) => n + a.rooms.length, 0)
      const openings = abs.reduce((n, a) => n + a.openings.length, 0)
      assert(rooms === 1, `expected 1 room, got ${rooms}`)
      assert(openings === 1, `expected 1 opening, got ${openings}`)
      const v = await req('POST', `/api/projects/${id}/query`, { kind: 'validate' })
      assert(v.res.status === 200, `validate status ${v.res.status}`)
      assert(parse(v.text).valid === true, 'valid is not true')
    })
    await step('GET render.svg', async () => {
      const { res, text } = await req('GET', `/api/projects/${id}/render.svg`)
      assert(res.status === 200, `status ${res.status}`)
      assert(/^(<\?xml[^?]*\?>\s*)?<svg\b/.test(text.trimStart()), 'body is not valid SVG')
    })
  }
} finally {
  if (id) {
    await step('DELETE /api/projects/:id', async () => {
      const { res, text } = await req('DELETE', `/api/projects/${id}`)
      assert(res.status === 200, `status ${res.status}: ${text}`)
    })
  }
}
console.log(failed === 0 ? 'All smoke checks passed' : `${failed} smoke check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
