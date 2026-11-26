import { checkAuth, json, type Ctx } from '../_shared'

const SEGMENT = /^[A-Za-z0-9._-]+$/

/** Returns the R2 object key, or null when any path segment is unsafe. */
function keyOf(ctx: Ctx): string | null {
  const raw = ctx.params.key
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : []
  if (parts.length === 0) return null
  for (const p of parts) {
    if (!SEGMENT.test(p) || p === '.' || p.includes('..')) return null
  }
  return 'images/' + parts.join('/')
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const denied = checkAuth(ctx.request, ctx.env)
  if (denied) return denied
  const key = keyOf(ctx)
  if (!key) return json({ error: 'Invalid key' }, 400)
  const obj = await ctx.env.IMAGES.get(key)
  if (!obj) return json({ error: 'Not found' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

export const onRequestPut = async (ctx: Ctx): Promise<Response> => {
  const denied = checkAuth(ctx.request, ctx.env)
  if (denied) return denied
  const key = keyOf(ctx)
  if (!key) return json({ error: 'Invalid key' }, 400)
  const contentType = ctx.request.headers.get('content-type') ?? 'application/octet-stream'
  await ctx.env.IMAGES.put(key, await ctx.request.arrayBuffer(), { httpMetadata: { contentType } })
  return json({ ok: true, key })
}

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const denied = checkAuth(ctx.request, ctx.env)
  if (denied) return denied
  const key = keyOf(ctx)
  if (!key) return json({ error: 'Invalid key' }, 400)
  await ctx.env.IMAGES.delete(key)
  return json({ ok: true })
}
