# Backend — Hono + Cloudflare D1 + R2

Cloudflare Pages serves the built SPA from `dist/` (`pages_build_output_dir` in
`../wrangler.toml`) and this Hono app from `functions/api/[[route]].ts` under
`/api/*`. Data lives in D1 (binding `DB`, database `simple-floorplan`) and images
in R2 (binding `IMAGES`, bucket `simple-floorplan-images`).

## Setup (once)

```bash
cd app
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
| GET | `/projects/:id` | Latest snapshot + measurements + items + notes merged into a PlanDoc-shaped JSON (+ `version`) |
| PUT | `/projects/:id/snapshot` | Save snapshot (PlanDoc minus measurements/roomNotes + `baseVersion`); 409 `{latestVersion}` on version conflict |
| PUT / DELETE | `/projects/:id/measurements/:label` | Upsert / delete one measurement (LWW by `updatedAt`) |
| PUT / DELETE | `/projects/:id/items/:id` | Upsert / soft-delete one survey item (LWW by `updatedAt`) |
| PUT | `/projects/:id/notes/:code` | Upsert one room note (LWW by `updatedAt`) |
| GET | `/projects/:id/changes?since=ISO` | Measurements/items/notes updated after `since` (deleted items included) |
| POST | `/projects/:id/images` | Multipart upload (`file` field) to R2 → `{key, url}` |
| GET | `/images/:key` | Stream image from R2 with immutable cache headers |
