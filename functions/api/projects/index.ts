import { checkAuth, json, type Ctx } from '../_shared'

export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  const denied = checkAuth(request, env)
  if (denied) return denied
  const { results } = await env.DB
    .prepare('SELECT id, title, updated_at FROM projects ORDER BY updated_at DESC')
    .all<{ id: string; title: string; updated_at: string }>()
  return json({
    projects: results.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })),
  })
}
