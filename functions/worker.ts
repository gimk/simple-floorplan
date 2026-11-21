// Cloudflare Worker entry for Simple Floorplan.
//
// Two things are served from this one Worker (see wrangler.toml):
//   - /api/*  → the Hono app in functions/app.ts (D1 + R2 + MCP + REST).
//   - everything else → the static SPA built into dist/ through the ASSETS binding
//     (not_found_handling = "single-page-application" gives the client-side router
//     every unknown path).
//
// `run_worker_first = ["/api/*"]` in wrangler.toml sends API traffic here first;
// static asset requests are answered by the assets layer and normally never reach
// this fetch handler. The ASSETS fallback below keeps non-/api paths correct when
// the Worker is invoked directly (for example `wrangler dev`, or a path outside
// the run_worker_first patterns).
import { app, type Env as ApiEnv } from './app'

/** API bindings and vars, plus the static-assets binding added by the Worker. */
export type Env = ApiEnv & {
  ASSETS: Fetcher
}

const isApiPath = (pathname: string): boolean =>
  pathname === '/api' || pathname.startsWith('/api/')

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (isApiPath(url.pathname)) {
      return app.fetch(request, env, ctx)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
