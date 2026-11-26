// Shared helpers for Cloudflare Pages Functions. Self-contained: functions/ is not part of
// the tsc -b project, so the minimal Cloudflare types are declared here.

export interface D1Result<T> { results: T[] }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<unknown>
}
export interface D1Database { prepare(query: string): D1PreparedStatement }
export interface R2ObjectBody {
  body: ReadableStream
  httpMetadata?: { contentType?: string }
}
export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  delete(key: string): Promise<void>
}

export interface Env {
  DB: D1Database
  IMAGES: R2Bucket
  API_TOKEN?: string
}

export interface Ctx<P extends string = string> {
  request: Request
  env: Env
  params: Record<P, string | string[]>
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Returns an error Response when a token is required and wrong, otherwise null. */
export function checkAuth(request: Request, env: Env): Response | null {
  if (!env.API_TOKEN) return null
  if (request.headers.get('x-api-token') === env.API_TOKEN) return null
  return json({ error: 'Unauthorized' }, 401)
}
