# Simple Floorplan

A web-based 2D floorplan editor for apartment renovation, with a phone-friendly
on-site measuring mode. Built to be used by humans **and** AI agents (MCP
clients, CLIs, scripts).

## Features

- **Tracing & calibration** — import a plan image or PDF, calibrate the scale
  with two points.
- **Rooms** — rectangle, polygon, slice and cutout tools; snapping; shared
  corners between rooms.
- **Walls** — bearing, partition and exterior wall types.
- **Doors, windows, storage** — placed on walls.
- **Measuring mode** — on-site survey with stable wall IDs; estimated vs
  verified values; discrepancy and squareness checks; "next unmeasured" jump;
  voice entry (FR/EN); keep-screen-on; sunlight mode.
- **Pins & photos** and **tape measures** on the plan.
- **Offline PWA** — installable, works offline with IndexedDB storage and sync
  when back online.
- **Projects** — multiple floorplans, synced through the API.
- **Exports** — SVG, PNG, PDF, DXF, CSV.
- **Calculators** — flooring, baseboard, paint.

## Quick start

```bash
npm install
npm run dev
```

### Local API (Cloudflare Worker + D1)

```bash
npm run db:migrate:local
npx vite build
npx wrangler dev --port 8788
```

or in one command (`vite build` then `wrangler dev`):

```bash
npm run dev:api
```

`wrangler dev` runs the Worker in `functions/worker.ts` locally: `dist/` is served
as static assets and `/api/*` goes to the Hono app in `functions/app.ts`, backed by
a local D1 database. Vite (`npm run dev`) proxies `/api` to port 8788.

## Deploy

See [functions/README.md](functions/README.md) for the Cloudflare Worker + D1 + R2
deployment.

## For AI agents

- **MCP server** — `POST /api/mcp` (HTTP transport) plus the
  [mcp-stdio wrapper](mcp-stdio/README.md) for stdio-only clients.
- **CLI** — `sfp` ([cli/README.md](cli/README.md)) using the plain-text `.sfp`
  plan format.
- **REST API** — semantic commands at `POST /api/projects/:id/commands` and
  queries at `/api/projects/:id/query`; OpenAPI spec at `/api/openapi.json`.
- **Discovery** — `/llms.txt` describes the whole API surface.
- **Auth** — API tokens with scopes, or passcode; see
  [functions/README.md](functions/README.md).
- **Design doc** — [docs/agent-ready.md](docs/agent-ready.md).

## Project layout

```
├── src/
│   ├── core/       pure logic: schema, commands, DSL, geometry, export (no React/DOM)
│   ├── features/   rooms, elements, measure, background, export, projects, ...
│   ├── shell/      app shell: toolbar, zoom, theme, shortcuts, agent bridge
│   ├── sync/       API client, offline queue, IndexedDB, photos
│   ├── canvas/     SVG viewport
│   └── model/      store, types, survey
├── functions/      Cloudflare Worker entry, Hono API, MCP, OpenAPI
├── migrations/     D1 SQL migrations
├── cli/            sfp command-line client
├── mcp-stdio/      MCP stdio wrapper
├── docs/           plan.md, agent-ready.md
└── public/         PWA assets, llms.txt
```

## Tests

```bash
npx vitest run
```
