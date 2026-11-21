# Backend — Hono + Cloudflare D1 + R2

Cloudflare Pages serves the built SPA from `dist/` (`pages_build_output_dir` in
`../wrangler.toml`) and this Hono app from `functions/api/[[route]].ts` under
`/api/*`. Data lives in D1 (binding `DB`, database `simple-floorplan`) and images
in R2 (binding `IMAGES`, bucket `simple-floorplan-images`).

## Setup (once)

```bash
npm install

# 1. Create the D1 database and paste the returned database_id into wrangler.toml
wrangler d1 create simple-floorplan

# 2. Create the R2 bucket
wrangler r2 bucket create simple-floorplan-images

# 3. Apply the schema (local dev DB used by `wrangler pages dev`)
npm run db:migrate:local
#    wrangler d1 migrations apply simple-floorplan --local

# 4. Optional passcode auth (if unset, the API is open)
wrangler pages secret put PASSCODE --project-name simple-floorplan
```

## Local development

```bash
npm run dev:api
# = wrangler pages dev --port 8788 -- npx vite
# Vite (proxied at /api -> :8788, see vite.config.ts) runs through wrangler,
# which executes functions/ for /api/* against the LOCAL D1/R2.
```

If you prefer running Vite directly (port 5173), start the API separately with
`wrangler pages dev --port 8788` — Vite already proxies `/api` to `:8788`.

## Deploy

```bash
npm run build                                        # SPA -> dist/
wrangler d1 migrations apply simple-floorplan --remote
wrangler pages deploy dist --project-name simple-floorplan
```

## API summary

All routes are under `/api` and require header `x-passcode: <PASSCODE>` when the
`PASSCODE` secret is set (401 otherwise).

| Method | Route | Description |
|---|---|---|
| GET | `/projects` | List projects |
| POST | `/projects` | Create project `{name?, title?}` |
| PATCH | `/projects/:id` | Rename `{name?, title?}` |
| DELETE | `/projects/:id` | Delete the project, its rows and its R2 images |
| GET | `/projects/:id` | Latest snapshot + measurements + items + notes merged into a PlanDoc-shaped JSON (+ `version`) |
| PUT | `/projects/:id/snapshot` | Save snapshot (PlanDoc minus measurements/roomNotes + `baseVersion`); only the last 50 snapshots per project are kept; 409 `{latestVersion}` on version conflict |
| PUT / DELETE | `/projects/:id/measurements/:label` | Upsert / delete one measurement (LWW by `updatedAt`) |
| PUT / DELETE | `/projects/:id/items/:id` | Upsert / soft-delete one survey item (LWW by `updatedAt`) |
| PUT | `/projects/:id/notes/:code` | Upsert one room note (LWW by `updatedAt`) |
| GET | `/projects/:id/changes?since=ISO` | Measurements/items/notes updated after `since` (deleted items included) |
| POST | `/projects/:id/images` | Multipart upload (`file` field) to R2 → `{key, url}` |
| GET | `/images/:key` | Stream image from R2 with immutable cache headers |

## Cloudflare Access (recommended)

The passcode is a shared secret. For real protection, put Cloudflare Access in
front of the whole site. Access checks who the user is before any request reaches
Pages, so the SPA, the API and the images are all protected.

One-time setup (Zero Trust dashboard, free for up to 50 users):

1. Open **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Application domain: your Pages domain, for example `simple-floorplan.pages.dev`.
   To protect the preview deployments too, add `*.simple-floorplan.pages.dev`
   (the wildcard covers `<hash>.simple-floorplan.pages.dev`).
3. **Identity providers**: enable **One-time PIN**. Access sends a 6-digit code to
   the email address of the user. No password is needed.
4. **Policy**: action **Allow**, rule **Emails** (or **Emails ending in**), and list
   the people who may use the app.
5. Save. Open the site in a private window to test: you must see the email prompt.

Notes:

- Keep the **passcode** (`PASSCODE` secret) as a second layer. If the Access policy
  is wrong or removed, the API still refuses requests without `x-passcode`.
- The session cookie of Access lasts as long as the session duration of the
  application (set it to 24 h or more for field work). When it expires while the
  device is offline, the app keeps working from its local copy (PWA cache and
  IndexedDB). Uploads wait in the outbox and go out after the user signs in again.
- API calls from the app are same-origin, so the Access cookie is sent
  automatically. No code change is needed in the app.
- There is no magic-link code in this repository. Access does the email login.

## Agent access with API tokens (migration 0003)

Besides `x-passcode` (full admin, used by the web app), agents can authenticate
with a scoped bearer token:

```
Authorization: Bearer sfp_...
```

Tokens live in the `api_tokens` table (migration `0003_access.sql`); only the
SHA-256 hash is stored, and the plaintext is returned exactly once at creation.

| Scope | Allows |
|---|---|
| `read` | All GET routes, `POST /projects/:id/query`, `render.svg`, `events` |
| `measure` | `read` + measurement/item/note writes + commands `set_measurement`, `clear_measurement`, `set_room_note`, `add_pin`, `add_tape` |
| `edit` | Everything except token admin and project delete |
| `admin` | Everything, including token admin and `DELETE /projects/:id` |

Scope checks are per route and per command type (the commands batch needs the
strongest scope of its commands). A token with `project_id` set can only access
that project. Errors: `401` for missing/invalid credentials, `403` with
`{ "error": "forbidden", "requiredScope": "...", "message": "..." }` when the
token is valid but lacks the scope.

| Method | Route | Scope | Description |
|---|---|---|---|
| POST | `/api/tokens` | admin | Create token `{name, scopes, projectId?}` → plaintext token ONCE |
| GET | `/api/tokens` | admin | List tokens (no secrets) |
| DELETE | `/api/tokens/:id` | admin | Revoke a token |
| GET | `/api/projects/:id/events?since=ISO&limit=100` | read | Append-only event log |

Every successful write route appends to `project_events` (one row per command
inside a commands batch): `actor` is the token name or `web`, `kind` is
`snapshot` / `measurement` / `item` / `note` / `command` / `image` / `rename` /
`project_create` / `project_delete`, plus a short `summary` and a `payload`.
`Idempotency-Key` cache entries older than 24 h are deleted when the commands
route reads the cache.


## MCP server (`/api/mcp`)

Simple Floorplan exposes a stateless Model Context Protocol (MCP) Streamable HTTP endpoint at `POST /api/mcp` (`GET /api/mcp` returns `405`). It sits behind the same `/api` authentication middleware (`Authorization: Bearer <token>` or `x-passcode`).

- **Protocol versions:** `2025-06-18` (default) and `2025-03-26`.
- **Transport:** JSON-RPC 2.0 over `POST /api/mcp` (`application/json`, batch arrays supported, notifications return `202`).
- **Tools:** `list_projects`, `create_project`, `get_plan`, `get_unmeasured`, `validate_plan`, `find_shared_walls`, `run_commands`, `set_measurement`, `place_element`, `add_room`, `slice_room`, `merge_rooms`, `set_wall_props`, `apply_measurements`, `render_svg`.
- **Resources:** `floorplan://projects`, `floorplan://projects/{id}/plan.json`, `/summary.json`, `/unmeasured.json`, `/render.svg`.
- **Prompts:** `trace_plan_image`, `finish_survey`, `renovation_option`, `contractor_export`.
- **Stdio wrapper:** See `mcp-stdio/README.md` for Claude Code and Claude Desktop configuration using `mcp-stdio/index.mjs`.
