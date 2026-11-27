// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain JS module without types
import { runCli } from './sfp.mjs'

type Call = { url: string; init: RequestInit }

function setup(status = 200, body: unknown = { ok: true }, env: Record<string, string> = {}) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  })
  let stdout = ''
  let stderr = ''
  const io = { fetch, env, stdout: (t: string) => (stdout += t), stderr: (t: string) => (stderr += t) }
  return { calls, io, out: () => stdout, errText: () => stderr }
}

describe('sfp runCli', () => {
  it('prints help', async () => {
    const t = setup()
    expect(await runCli(['help'], t.io)).toBe(0)
    expect(t.out()).toContain('Usage: sfp')
    expect(t.calls).toHaveLength(0)
  })

  it('lists projects', async () => {
    const t = setup(200, { projects: [] })
    expect(await runCli(['projects'], t.io)).toBe(0)
    expect(t.calls[0].url).toBe('http://localhost:8788/api/projects')
    expect(t.calls[0].init.method).toBe('GET')
    expect(JSON.parse(t.out())).toEqual({ projects: [] })
  })

  it('creates a project with a title and honours --url', async () => {
    const t = setup(201, { id: 'a' })
    expect(await runCli(['create', 'My plan', '--url', 'https://x.test/'], t.io)).toBe(0)
    expect(t.calls[0].url).toBe('https://x.test/api/projects')
    expect(JSON.parse(String(t.calls[0].init.body))).toEqual({ title: 'My plan' })
  })

  it('queries', async () => {
    const t = setup()
    expect(await runCli(['query', 'p1', 'rooms', '--artboard', 'ab1'], t.io)).toBe(0)
    expect(t.calls[0].url).toBe('http://localhost:8788/api/projects/p1/query')
    expect(JSON.parse(String(t.calls[0].init.body))).toEqual({ kind: 'rooms', artboardId: 'ab1' })
  })

  it('execs a single command, an array, and a dry run', async () => {
    const t = setup()
    await runCli(['exec', 'p1', '{"type":"set_title","title":"T"}'], t.io)
    expect(JSON.parse(String(t.calls[0].init.body))).toEqual({ command: { type: 'set_title', title: 'T' } })
    await runCli(['exec', 'p1', '[{"type":"set_title","title":"T"}]', '--dry-run', '--base-version', '3'], t.io)
    expect(JSON.parse(String(t.calls[1].init.body))).toEqual({
      commands: [{ type: 'set_title', title: 'T' }],
      dryRun: true,
      baseVersion: 3,
    })
    expect(t.calls[1].url).toBe('http://localhost:8788/api/projects/p1/commands')
  })

  it('renders svg to stdout', async () => {
    const t = setup(200, '<svg></svg>')
    expect(await runCli(['render', 'p1', '--artboard', 'a b'], t.io)).toBe(0)
    expect(t.calls[0].url).toBe('http://localhost:8788/api/projects/p1/render.svg?artboard=a%20b')
    expect(t.out()).toContain('<svg>')
  })

  it('deletes', async () => {
    const t = setup()
    expect(await runCli(['delete', 'p1'], t.io)).toBe(0)
    expect(t.calls[0].init.method).toBe('DELETE')
  })

  it('picks the auth header from the token shape', async () => {
    const a = setup(200, {}, { SFP_TOKEN: 'sfp_abc' })
    await runCli(['projects'], a.io)
    expect(a.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer sfp_abc' })
    const b = setup()
    await runCli(['projects', '--token', 'secret'], b.io)
    const h = b.calls[0].init.headers as Record<string, string>
    expect(h['x-api-token']).toBe('secret')
    expect(h.Authorization).toBeUndefined()
  })

  it('exits non-zero on HTTP errors and bad args', async () => {
    const t = setup(404, { error: 'Not found' })
    expect(await runCli(['delete', 'nope'], t.io)).toBe(1)
    expect(t.errText()).toContain('404')
    const u = setup()
    expect(await runCli(['query', 'p1', 'bogus'], u.io)).toBe(1)
    expect(await runCli(['exec', 'p1', '{bad'], u.io)).toBe(1)
    expect(await runCli(['nope'], u.io)).toBe(1)
    expect(await runCli(['pull'], u.io)).toBe(1)
    expect(u.calls).toHaveLength(0)
  })
})
