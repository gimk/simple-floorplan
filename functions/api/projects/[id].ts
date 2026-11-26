import { checkAuth, json, type Ctx } from '../_shared'

const idOf = (ctx: Ctx): string => {
  const v = ctx.params.id
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const denied = checkAuth(ctx.request, ctx.env)
  if (denied) return denied
  const id = idOf(ctx)
  const row = await ctx.env.DB
    .prepare('SELECT id, title, doc_json, updated_at FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: string; title: string; doc_json: string; updated_at: string }>()
  if (!row) return json({ error: 'Not found' }, 404)
  return json({ id: row.id, title: row.title, doc: JSON.parse(row.doc_json), updatedAt: row.updated_at })
}

export const onRequestPut = async (ctx: Ctx): Promise<Response> => {
  const denied = checkAuth(ctx.request, ctx.env)
  if (denied) return denied
  const id = idOf(ctx)
  let body: { title?: unknown; doc?: unknown }
  try {
    body = (await ctx.request.json()) as { title?: unknown; doc?: unknown }
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!id || typeof body.title !== 'string' || !body.title || !body.doc || typeof body.doc !== 'object') {
    return json({ error: 'id, title and doc are required' }, 400)
  }
  const updatedAt = new Date().toISOString()
  await ctx.env.DB
    .prepare('INSERT OR REPLACE INTO projects (id, title, doc_json, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, body.title, JSON.stringify(body.doc), updatedAt)
    .run()
  return json({ ok: true, updatedAt })
}

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const denied = checkAuth(ctx.request, ctx.env)
  if (denied) return denied
  await ctx.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(idOf(ctx)).run()
  return json({ ok: true })
}
