# Simple Floorplan

A web-based 2D floorplan editor for apartment renovation. It runs in the browser,
can be installed as a PWA, and works offline. Projects are saved in IndexedDB. An
optional Cloudflare Worker adds cloud sync (D1 for project documents, R2 for images)
and a programmatic API for scripts and AI agents.

## Features

- **Two modes** — **Plan** (key `1`) draws the structure. **Design** (key `2`) places
  furniture and uses the tape tool.
- **Artboards** — frames that hold one plan each. Each artboard has a ceiling height,
  a drawing precision (0.1, 0.5 or 1 cm), and a wall thickness (0 to 50 cm, default 10).
- **Rooms** — polygons whose vertices are the interior. Walls are drawn outward. Floor
  patterns (wood, parquet, tile, stone, carpet) and per-wall accent colours.
- **Openings** — doors, windows and plain openings on walls, with style variants
  (for example pocket, french, sliding, casement).
- **Furniture** — rectangles and circles with position, size, rotation, colour and an
  optional front-direction arrow.
- **Reference images** — PNG, JPG, WebP, SVG or PDF placed on the plan in Plan mode,
  with scale, rotation and opacity.
- **Export** — SVG (per artboard), PNG, and the whole project as JSON. Copy JSON and
  Copy SVG copy them to the clipboard.
- **Import** — project JSON files, or Paste JSON. Older v1 exports are converted on import.
- **Storage** — local IndexedDB, with optional cloud sync through the Worker API.

All units are centimetres and degrees. The x axis points right and the y axis points down.

## Data format

A project is a `ProjectDoc` with `schemaVersion: 3`. The JSON Schema is served at
`/api/schema/project.v3.json` and the TypeScript types are in `src/model/types.ts`.
The zod validator is in `src/model/schema.ts`.

## Quick start

```bash
npm install
npm run dev        # the UI (Vite), with /api proxied to http://localhost:8788
```

The Vite dev server proxies `/api` to `http://localhost:8788` (see `vite.config.ts`). To use
cloud sync and the API locally, start the Worker on that port in a second terminal. It
serves `dist/` and `/api/*`:

```bash
npm run db:migrate:local   # apply D1 migrations to the local database (once, and after new migrations)
npm run dev:api            # npm run build, then npx wrangler dev --port 8788
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (UI). Proxies `/api` to `http://localhost:8788` |
| `npm run build` | Type-check with `tsc -b` (app, node, and Worker configs), then `vite build` into `dist/` |
| `npm run preview` | Serve the built `dist/` with Vite |
| `npm test` | Run the Vitest suite (`vitest run`) |
| `npm run lint` | Run oxlint |
| `npm run db:migrate:local` | Apply D1 migrations to the local database (`wrangler d1 migrations apply --local`) |
| `npm run db:migrate:remote` | Apply D1 migrations to the remote database (`wrangler d1 migrations apply --remote`) |
| `npm run dev:api` | `npm run build`, then `wrangler dev --port 8788` (the Worker, API and built app) |
| `npm run deploy` | `npm run build`, then `wrangler deploy` |
| `npm run smoke` | End-to-end API smoke test (`scripts/smoke.mjs`) against `BASE_URL` (default `http://localhost:8788`) |
| `npm run sfp -- <command>` | The `sfp` command-line client (`cli/sfp.mjs`). See [CLI](#cli) |

## Deploy

The Worker (`functions/worker.ts`) serves `/api/*`. Everything else comes from `dist/`
(Cloudflare Static Assets). The settings are in `wrangler.toml`: the D1 database
`simple-floorplan`, the R2 bucket `simple-floorplan-images`, and the `ASSETS` binding.

Apply the D1 migrations before you deploy the code that needs them:

```bash
npm run db:migrate:remote
npm run deploy             # npm run build, then npx wrangler deploy
```

The D1 migrations are in `migrations/`:

- `0001_projects.sql`: the `projects` table.
- `0002_version_and_tokens.sql`: the project `version` column and the `api_tokens` table.

## Authentication

Send one of these headers on every `/api/*` route except the two discovery routes:

- `Authorization: Bearer <token>`
- `x-api-token: <secret>`

There are two kinds of token:

- **Master secret**: the Worker secret `PASSCODE` (checked first) or `API_TOKEN`. Set it
  with `npx wrangler secret put PASSCODE`. It has the `admin` scope on every project.
- **Scoped token** (`sfp_...`): created with `POST /api/tokens` (admin). The scope is
  `read`, `edit` or `admin` (`read` < `edit` < `admin`). A token can be limited to one project.

When neither secret is set, the API is public (admin). Wrong or missing credentials give
`401`. A scope that is too low, or a project outside the token's limit, gives `403`.
The web app keeps the master secret in local storage under `sfp-cloud-token`.

## Worker API

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/api/openapi.json` | none | OpenAPI 3.1.0 spec |
| GET | `/api/schema/project.v3.json` | none | ProjectDoc v3 JSON Schema |
| GET | `/api/projects` | read | List projects with `version` |
| POST | `/api/projects` | edit | Create a project (`{ id?, title?, doc? }`) |
| GET | `/api/projects/:id` | read | Read one project with its doc and `version` |
| PUT | `/api/projects/:id` | edit | Create or replace (upsert), validated. Accepts `baseVersion` or `If-Match` |
| PATCH | `/api/projects/:id` | edit | Rename a project |
| DELETE | `/api/projects/:id` | edit | Delete a project and its R2 images |
| POST | `/api/projects/:id/commands` | edit | Apply one command or a batch (`command` or `commands`, `dryRun`, `baseVersion`) |
| POST | `/api/projects/:id/query` | read | Read-only `summary`, `validate`, `rooms`, `walls` or `artboard` |
| GET | `/api/projects/:id/render.svg?artboard=<id>` | read | One artboard as SVG |
| GET, PUT, DELETE | `/api/images/:projectId/:imageId` | read / edit | Read, store, or delete an image in R2 |
| GET, POST | `/api/tokens` | admin | List tokens, or create one (the value is shown once) |
| DELETE | `/api/tokens/:id` | admin | Revoke a token |
| POST | `/api/mcp` | read (each tool checks its own scope) | MCP server (Streamable HTTP, JSON-RPC 2.0). See [MCP server](#mcp-server) |

Every project has an integer `version` (starts at 1, +1 on each write). Send
`baseVersion` (or `If-Match`) to get `409 version_conflict` instead of overwriting a
newer change. The full details are in the OpenAPI document and in
[`public/llms.txt`](public/llms.txt).

## MCP server

`POST /api/mcp` is a Model Context Protocol server. It uses the Streamable HTTP transport:
send one JSON-RPC 2.0 message per POST. The code is in `functions/mcp.ts`. Its tools call the
same handlers as the REST routes, so both APIs behave the same. Send the token as in the REST API.

- Methods: `initialize`, `notifications/initialized` (a notification, answered with `202`), `ping`,
  `tools/list` and `tools/call`.
- Tools: `list_projects` (read), `get_project` (read), `create_project` (edit), `query_project`
  (read), `run_commands` (edit, with `dryRun` and `baseVersion`), `render_svg` (read) and
  `delete_project` (edit). A token without the scope gets `Forbidden` as a tool error.
- JSON-RPC errors: `-32700` parse, `-32600` invalid request, `-32601` method not found, `-32602`
  invalid params. Tool errors return a result with `isError: true`.

```bash
curl -s -X POST http://localhost:8788/api/mcp \
  -H "Authorization: Bearer $SFP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## CLI

`cli/sfp.mjs` is a zero-dependency Node 22+ client for the REST API. Run it with
`npm run sfp -- <command>` (the `--` passes the arguments to the script) or `node cli/sfp.mjs <command>`.

- `SFP_URL` sets the API base URL (default `http://localhost:8788`). `SFP_TOKEN` sets the token.
  Flags `--url` and `--token` override them. A token that starts with `sfp_` is sent as a Bearer token.
- Commands: `projects`, `create [title]`, `pull <id> [out.json]`, `push <id> <file.json> [--base-version n]`,
  `query <id> <kind> [--artboard <aid>]`, `exec <id> <jsonOrFile> [--dry-run] [--base-version n]`,
  `render <id> [out.svg] [--artboard <aid>]`, `delete <id>` and `help`.
- Errors print to stderr and exit with code `1`.

```bash
export SFP_URL=http://localhost:8788 SFP_TOKEN=sfp_...
npm run sfp -- projects
npm run sfp -- exec proj_1 '{"type":"add_room_rect","xCm":0,"yCm":0,"widthCm":400,"heightCm":300}' --dry-run
```

## Smoke test

`npm run smoke` runs `scripts/smoke.mjs` against a running Worker. It reads `/llms.txt`
and the OpenAPI document, creates a project, adds a room and a door, checks the summary and
validation, renders the SVG, and deletes the project. Set `BASE_URL` (default
`http://localhost:8788`) and `SFP_TOKEN` (or `API_TOKEN`) when the API is protected.

## Browser URL parameters

The app reads these query parameters at start-up. Invalid values are ignored.

| Parameter | Values | Effect |
|---|---|---|
| `project` | project id | Loads the project from the cloud API |
| `mode` | `plan`, `design` | Sets the mode |
| `tool` | `select`, `rect`, `pen`, `cutout`, `artboard`, `tape` | Sets the tool |
| `artboard` | artboard id | Makes that artboard active, if it exists |
| `nosw` | `1` or `true` | Unregisters service workers, so a stale PWA cache is not used |

Example: `/?project=proj_1&mode=design&tool=tape`

## For AI agents

- [`/llms.txt`](public/llms.txt): what the app is, the Worker API, auth, and an example document.
- `GET /api/openapi.json`: OpenAPI 3.1.0 spec for the Worker API.
- `GET /api/schema/project.v3.json`: JSON Schema (2020-12) for `ProjectDoc` v3.
- `POST /api/mcp`: MCP server for stored projects (see [MCP server](#mcp-server)). The `sfp` CLI is in [CLI](#cli).
- Browser: the app sets `window.sfp`, a bridge to the open project (`getDoc`, `summarize`,
  `validate`, `exec`, `dryRun`, `undo`, `redo`, `loadProject`, `exportSvg`, `subscribe`, and
  more; code in `src/agent/`). Each `exec` is one undo step.
- WebMCP: when the browser has `navigator.modelContext.registerTool`, the app registers the tools
  `sfp_get_project`, `sfp_get_doc`, `sfp_validate`, `sfp_exec`, `sfp_undo`, `sfp_redo`,
  `sfp_set_ui`, `sfp_load_project` and `sfp_export_svg`. Without WebMCP, nothing is registered.
- The plan's SVG elements carry `data-entity`, `data-id` and `data-edge` attributes.

## Project layout

```
├── src/
│   ├── model/      ProjectDoc types, zod schema, store, geometry
│   ├── features/   artboards, rooms, openings, furniture, background, tape, export
│   ├── shell/      toolbar, panels, zoom, theme, modifiers, UI state, URL parameters
│   ├── sync/       cloud client, IndexedDB, JSON import/export, v1 conversion
│   ├── core/       command layer shared by the app and the Worker
│   ├── agent/      window.sfp bridge and WebMCP tools
│   └── canvas/     SVG viewport, canvas keyboard handling
├── functions/
│   ├── worker.ts   Cloudflare Worker: /api routes, auth, OpenAPI spec, JSON Schema
│   └── mcp.ts      POST /api/mcp: MCP server (JSON-RPC 2.0), tools reuse the worker handlers
├── cli/
│   └── sfp.mjs     sfp command-line client (npm run sfp)
├── scripts/
│   └── smoke.mjs   API smoke test (npm run smoke)
├── migrations/     D1 SQL migrations (0001_projects.sql, 0002_version_and_tokens.sql)
├── public/         PWA assets and llms.txt
├── docs/           design notes and review reports
└── wrangler.toml   Worker, D1, R2 and static assets configuration
```

## Tests

```bash
npm run build   # type-check (tsc -b) and build
npm run lint    # oxlint
npm test        # Vitest
```
