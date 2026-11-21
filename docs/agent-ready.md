# Making Simple Floorplan Agent-Ready

> Design document and implementation plan to make **Simple Floorplan** (`src`, `functions`) first-class for AI agents (Claude Code, Claude in Chrome, MCP clients, and scripts) as well as humans.

---

## 1. Research: How Other Design & CAD Tools Expose Themselves to Agents

AI agents fail when forced to simulate human mouse drags on raw pixel coordinates. Across modern 2D/3D design tools, six patterns consistently make visual editors usable by agents:

| Tool / Standard | How Agents Interact With It | Key Lesson for Simple Floorplan |
|---|---|---|
| **tldraw Agent SDK** | High-level typed canvas actions (`createShape`, `align`, `moveTo`) validated with Zod, paired with structured viewport JSON **and** a screenshot of the canvas so multimodal models can visually verify edits. | Pair structured JSON state with an on-demand visual render (SVG/PNG) so agents can self-check geometry. |
| **Excalidraw JSON + `mermaid-to-excalidraw` + Excalidraw+ MCP** | Official Streamable HTTP MCP server with OAuth; concise text-to-diagram conversion; automated layout checks + visual feedback loop. | Provide a concise text DSL that compiles to `PlanDoc` (far fewer tokens than raw JSON) plus a remote Streamable HTTP MCP endpoint. |
| **Figma MCP / Plugin API** | Official desktop & remote MCP exposing structured layout trees, design tokens, and write-back actions directly to coding agents. | Expose semantic domain objects (rooms, bearing walls, openings, survey IDs), not raw SVG primitives. |
| **Penpot MCP** | Open-source plugin bridge translating agent tool calls into layout queries and design-system validation checks. | Expose read-only semantic queries and rule checks (area, squareness, wall overflow) as first-class tools. |
| **draw.io XML** | Declarative, diffable XML text format that LLMs can read, patch, and version-control directly. | Keep a deterministic, diffable text representation alongside JSON. |
| **Blender / FreeCAD MCP** | Local bridge + parameterized high-level tools. Best practice: **keep math on the server, language on the model**; use transaction checkpoints and progressive tool discovery. | Never ask an LLM to compute polygon clipping or vertex offsets by hand; expose `slice_room`, `cutout_room`, `merge_rooms`, and `apply_measurements`. |
| **OpenSCAD / CadQuery** | Code-as-CAD: deterministic, parametric, human-readable text scripts. | Support deterministic IDs and a compact floorplan DSL for reproducible generation and git diffs. |
| **IFC / BIM & DXF** | IFC provides a building ontology (`IfcSpace`, `IfcWall`, `IfcDoor`, `IfcWindow`, `Pset_WallCommon.LoadBearing`). DXF is the universal 2D CAD exchange format for architects and kitchen planners. | Map `Room`, `WallProps.type`, and `WallElement` cleanly to DXF layers and IFC-lite JSON/STEP exports. |
| **GeoJSON Indoor (IMDF)** | OGC/Apple RFC 7946 standard (`venue`, `building`, `level`, `unit`, `opening`, `fixture`) in `.geojson`. | Export `PlanDoc` as IMDF-compatible GeoJSON for mapping and spatial analysis tools. |
| **`llms.txt` & MCP Spec** | `/llms.txt` gives agents a root Markdown index of docs, schemas, and endpoints. MCP separates **Tools** (verbs/mutations), **Resources** (nouns/read-only URIs), and **Prompts** (workflow templates), returning dual JSON + concise Markdown summaries. | Publish `/llms.txt` + `/api/openapi.json` and structure MCP with Tools, Resources, and Prompts. |

---

## 2. Current State Assessment

Based on `src/model/{types,store,geometry,survey}.ts`, `functions/app.ts`, `src/sync/{api,sync}.ts`, `src/features/rooms/{ops,RoomsLayer}.tsx`, `src/features/elements/geometry.ts`, and `src/features/measure/{logic,index,RoomCard}.tsx`.

### What Works for Agents Today
1. **Clean, flat centimeter coordinate system (`src/model/types.ts`):** All world units are `cm` (x right, y down) with no nested affine transforms. `PlanDoc` is already a clean, serializable JSON document.
2. **Pure, React-free domain logic already exists:**
   - `model/geometry.ts`: `roomAreaM2`, `roomWalls`, `centroid`, `pointInPolygon`, `projectOnSegment`.
   - `model/survey.ts`: `surveyIds`, `allSurveyIds`, `roomsInWalkOrder`, `nextRoomCode`.
   - `features/rooms/ops.ts`: `makeRoom`, `sliceDoc`, `cutDoc`, `insertVertex`, `removeVertex`, `deleteRoom`, `setRoomCode` (using `polygon-clipping`).
   - `features/elements/geometry.ts`: `clampOffset`, `overflows`, `nearestWall`, `defaultElement`.
   - `features/measure/logic.ts`: `discrepancy`, `squarenessCheck`, `oppositeWallNotes`, `roomProgress`, `docProgress`, `adjacentItems`.
3. **Granular Hono REST API (`functions/app.ts`):**
   - Supports project CRUD, optimistic concurrency (`baseVersion` + `409 version_conflict`) on `PUT /api/projects/:id/snapshot`, atomic per-value writes for measurements, items, and notes, R2 image upload/fetch, and `GET /api/projects/:id/changes?since=`.
4. **Accessible Measuring Mode DOM (`src/features/measure/`):**
   - Uses deterministic IDs (`#room-CODE`, `#m-CODE-1`, `#note-CODE`), `<section aria-label={room.name}>`, `role="progressbar"`, `role="status"` for squareness and opposite-wall warnings, and URL hash navigation (`#room-CODE`).
5. **Vector SVG canvas (`src/canvas/Viewport.tsx`):** Elements are DOM nodes rather than an opaque `<canvas>` bitmap.

### What Blocks Agents Today
1. **No shared command layer:** High-level edits (`slice`, `cutout`, `setWallType`, `placeElement`) live in frontend files and React handlers. An agent using the HTTP API must download the full snapshot, re-implement geometry math and element re-parenting, and `PUT` the entire snapshot back—risking `409` conflicts and data corruption.
2. **Random vertex IDs as wall keys:** `uid()` in `store.ts` uses `Date.now()` + `Math.random()`. Walls and `WallElement.wallStart` are keyed by random vertex IDs (`v1a2b3c`) instead of human/survey labels (`SE-2` or `{ roomCode: "SE", wallIndex: 2 }`). Agents must parse the full vertex list just to refer to a wall.
3. **No schema version or runtime validation:** `PlanDoc` has no `schemaVersion`. `functions/app.ts` uses minimal manual checks (`isObj`, `Array.isArray`); an agent can write invalid polygons, negative widths, or dangling `wallStart` references without error.
4. **No MCP server, CLI, OpenAPI spec, or `/llms.txt`:** Agents cannot discover capabilities or invoke typed tools.
5. **No server-side semantic queries or validation:** Areas, bearing-wall lists, unmeasured IDs, discrepancy reports, squareness checks, and shared-wall detection only run in the browser.
6. **Missing renovation operations:** `mergeRooms` (knock down a partition wall between two rooms) and `applyMeasurements` (re-solve room polygons from verified lengths) do not exist yet.
7. **No headless export or visual render endpoint:** Agents cannot export SVG, PDF, DXF, CSV, or IMDF from the API, nor render an image of the plan to visually verify their own edits.
8. **Edit Mode is opaque to browser agents:**
   - `RoomsLayer.tsx` SVG `<path>` and `<line>` nodes lack `data-room-code`, `data-wall-label`, `data-wall-type`, and `aria-label`.
   - `App.tsx` toolbar buttons rely on `title` only (no `aria-label` or `data-tool`).
   - No `window.__floorplan` bridge exists for browser agents (Claude in Chrome / Playwright).
   - URL does not encode `projectId`, `mode`, or viewport state.
9. **Auth, idempotency, and history gaps:**
   - Single shared `x-passcode` header (no scoped API tokens, no read-only tokens).
   - No `Idempotency-Key` and no `dryRun` preview.
   - No structured event log: `floorplan_snapshots` stores full blobs, and `/changes` omits geometry changes and deleted measurements.

---

## 3. Recommended Architecture

```text
  [ Claude Code / MCP Clients ]   [ CLI / Scripts ]   [ Browser / Claude in Chrome ]
               │                          │                         │
      MCP (Streamable HTTP)         HTTPS + Bearer          React UI + window.__floorplan
               │                          │                         │
               └──────────────┬───────────┴─────────────────────────┘
                              ▼
             [ Hono API on Cloudflare Pages Functions ]
               ├── /api/openapi.json, /llms.txt, /api/schema/plan.v1.json
               ├── /api/mcp (MCP Tools, Resources, Prompts)
               ├── /api/projects/:id/commands  (idempotent, dryRun, event-logged)
               ├── /api/projects/:id/query     (areas, unmeasured, validate, shared-walls)
               ├── /api/projects/:id/export    (svg, pdf, dxf, imdf, ifc-lite, csv, dsl)
               └── /api/projects/:id/events    (append-only audit log)
                              │
                              ▼
        [ Shared Pure Core (`src/core/`) — zero React, zero DOM ]
          ├── schema.ts    (Zod schemas -> TS types, JSON Schema, OpenAPI)
          ├── commands.ts  (pure reducer: (doc, cmd, ctx) -> { doc, diff, warnings })
          ├── queries.ts   (summary, unmeasured, validate, sharedWalls, quantities)
          ├── dsl.ts       (bidirectional PlanDoc <-> concise .sfp text format)
          └── export.ts    (pure SVG, DXF, IMDF GeoJSON, IFC-lite, CSV generators)
                              │
                              ▼
             [ Cloudflare D1 (SQLite) ] + [ Cloudflare R2 (Images) ]
```

### 3.1 Shared Pure Command Layer (`src/core/commands.ts`)
Move pure operations out of `features/rooms/ops.ts` and `features/measure/` into a single shared core imported by **both** the React frontend (`useDoc` + `zundo`) and the Hono Worker (`POST /api/projects/:id/commands`).

- **Signature:**
  ```ts
  type CommandResult =
    | { ok: true; doc: PlanDoc; diff: PlanDiff; warnings: ValidationIssue[]; createdIds: string[] }
    | { ok: false; error: { code: string; message: string; path?: string } }
  ```
- **Human-friendly addressing:** Every command accepts either internal IDs (`roomId`, `wallStart`) **or** stable semantic references (`roomCode: "SE"`, `wallLabel: "SE-2"`, or `{ roomCode: "SE", wallIndex: 2 }`). The core resolves them deterministically.
- **Deterministic IDs:** Commands accept an optional `id` or `idStrategy: "slug"` (e.g., `room_SE`, `v_SE_1`, `el_SE_2_door_1`) so scripts and retries produce predictable IDs.
- **Batching, Dry-Run, and Idempotency:** `POST /api/projects/:id/commands` accepts an array of commands executed atomically in one snapshot version, supports `dryRun: true` (returns `diff`, updated areas, and `warnings` without writing to D1), and honors `Idempotency-Key` (stored in D1 for 24 h).
- **Undo compatibility:** In the browser, dispatching one command (or batch) maps to one `zundo` undo step. On the server, each commit increments `version` and appends an event to `project_events`, enabling `revert_to_version`.

### 3.2 Versioned Document Schema (`PlanDoc` v1)
- Add `schemaVersion: 1` to `PlanDoc`.
- Define all types in `src/core/schema.ts` with **Zod** (`zod`), then derive TypeScript types (`z.infer`), JSON Schema (`GET /api/schema/plan.v1.json`), and OpenAPI 3.1 (`@hono/zod-openapi` at `GET /api/openapi.json`).
- Enforce invariants at the boundary:
  - Room polygons have `>= 3` vertices, non-zero area (`> 100 cm²`), and unique `code`.
  - `WallElement.roomId` and `wallStart` exist; `widthCm > 0`; `offsetCm >= 0`.
  - `Measurement.actualCm > 0` and finite.

### 3.3 MCP Server (Tools + Resources + Prompts)
Expose an MCP server directly from Hono at **`POST /api/mcp`** (Streamable HTTP transport, Bearer token auth) plus a thin local `npx @simple-floorplan/mcp` stdio wrapper for local files or remote proxying.

- **Tools (Verbs):** The 18 tools listed in Section 4 (mutations, semantic queries, exports, renders).
- **Resources (Nouns — read-only URIs):**
  - `floorplan://projects` — list of projects.
  - `floorplan://projects/{id}/plan` — full `PlanDoc` JSON (v1).
  - `floorplan://projects/{id}/dsl` — concise `.sfp` text representation (ideal for LLM context windows).
  - `floorplan://projects/{id}/summary` — rooms, areas, progress, warnings.
  - `floorplan://projects/{id}/render.svg` — clean vector render of current plan.
  - `floorplan://projects/{id}/events?limit=50` — recent change history.
- **Prompts (Workflow Templates):**
  - `trace-from-image` — guides a vision agent through calibration, room proposal, overlay verification, and commit.
  - `on-site-audit` — lists unmeasured IDs in walking order and checks discrepancies/squareness.
  - `renovation-check` — checks whether target walls are bearing vs. partition before simulating removal with `dryRun`.
  - `contractor-handoff` — validates plan completeness and exports PDF/DXF/CSV bundle.
- **Dual responses:** Every MCP tool returns structured JSON (`structuredContent`) **plus** a 1–3 line plain-text summary so models stay accurate without parsing huge payloads.

### 3.4 CLI (`sfp`)
A lightweight Node/Bun CLI wrapping the same `core` and HTTP API:
```bash
sfp projects list --json
sfp pull <projectId> --format dsl > apartment.sfp
sfp diff apartment.sfp <projectId>
sfp apply <projectId> --file commands.json --dry-run
sfp query <projectId> unmeasured --json
sfp export <projectId> --format dxf --out plan.dxf
```
Works both against the remote Cloudflare API (via `SFP_API_URL` + `SFP_TOKEN`) and offline against local `.json` / `.sfp` files.

### 3.5 Concise Text / DSL Format (`.sfp`)
Raw `PlanDoc` JSON for a 6-room apartment is ~12–20 KB (~4,000+ tokens). A line-oriented, git-diffable `.sfp` DSL represents the same apartment in ~30 lines (~350 tokens) and is lossless for geometry, walls, elements, measurements, and notes:

```text
plan "Apartment 4B" version=1 unit=cm

room EN "Entry" rect(0,0 180x240) ceiling=265 walk=1
  wall EN-1 exterior 30cm
  wall EN-3 partition 10cm
  door EN-1 at=40 w=90 h=204 single hinge=start swing=in
  measure EN-1=181 EN-2=239 EN-H=265
  note "Electrical panel near EN-4"

room SE "Living Room" poly(180,0 600,0 600,420 180,420) ceiling=265 walk=2
  wall SE-1 exterior 30cm
  wall SE-2 bearing 25cm
  wall SE-4 partition 10cm
  window SE-1 at=80 w=160 h=140 sill=90 french
  opening SE-4 at=50 w=110 h=204
  measure SE-1=421 SE-2=419 SE-D=594
```
- **Bidirectional:** `planToDsl(doc)` and `dslToPlan(text)` live in `src/core/dsl.ts`.
- **Use cases:** Fast LLM plan generation, human-readable PR diffs, low-token MCP resource reads.

### 3.6 Import / Export Formats
All exports are generated by pure functions in `src/core/export.ts` (usable in browser, Worker, CLI, and MCP):
- **SVG (`export_plan` format `svg`):** Crisp vector with layers (`walls`, `openings`, `dimensions`, `labels`, `legend`, `scale-bar`). Optional `overlayBackground: true` embeds the calibrated background image for visual alignment checks.
- **PDF (`pdf`):** Multi-option sheet (full plan or single-room focus, e.g., kitchen) with scale bar, dimension table, and notes. (Browser uses existing `jspdf`; Worker/CLI can generate SVG-to-PDF or HTML print sheet.)
- **DXF (`dxf`):** ASCII DXF R12/R2000 (pure string generator, zero heavy deps) with standard CAD layers: `WALLS_BEARING`, `WALLS_PARTITION`, `WALLS_EXTERIOR`, `OPENINGS`, `DIMENSIONS`, `ROOM_LABELS`.
- **GeoJSON / IMDF (`imdf`):** RFC 7946 `FeatureCollection` with `unit` polygons (rooms), `opening` linestrings (doors/windows), and `fixture` polygons (cupboards/radiators) in local meter coordinates (or georeferenced if an origin lat/lng + heading is set).
- **IFC-lite (`ifc-lite`):** Structured BIM JSON (and optional minimal IFC4 STEP) mapping `Room -> IfcSpace`, `Wall -> IfcWall` (with `Pset_WallCommon.LoadBearing`), `door -> IfcDoor`, `window -> IfcWindow`.
- **CSV (`csv`):** Survey checklist (`label, roomCode, kind, plannedCm, actualCm, diffCm, status`) and material takeoff (`roomCode, floorAreaM2, wallAreaNetM2, baseboardLinearM`).
- **Import:** `PlanDoc` JSON, `.sfp` DSL, DXF closed polylines → rooms, and GeoJSON `unit` features → rooms.

### 3.7 Semantic Queries & Consistency Checks
Expose pure query functions over HTTP (`POST /api/projects/:id/query`) and MCP:
- **Summary & Quantities:** Per-room area (`m²`), total indoor/outdoor area, perimeter, ceiling height, gross & net wall surface area (minus doors/windows, for paint/wallpaper), and baseboard length (perimeter minus door/opening widths).
- **Structural & Adjacency Analysis:** `find_shared_walls` detects collinear overlapping wall segments between two rooms (within tolerance, e.g. 3–35 cm depending on wall thickness), reporting whether the shared wall is `bearing`, `partition`, or `exterior`.
- **Survey Progress:** `get_unmeasured` returns missing survey IDs in `walkOrder` with estimated `plannedCm`.
- **Consistency Validator (`validate_plan`):** Returns typed issues (`severity: "error" | "warning"`):
  - Discrepancies `|actual - planned| > 2 cm`
  - Out-of-square rooms (`squarenessCheck`)
  - Opposite-wall mismatches (`oppositeWallNotes`)
  - Elements overflowing host wall (`overflows`)
  - Overlapping room polygons (via `polygon-clipping.intersection`)
  - Door-swing collisions with cupboards/radiators or opposite walls
  - Uncalibrated background image or missing ceiling heights.

### 3.8 Image-Understanding Hooks (Agent-Assisted Tracing)
Enable multimodal agents (Claude, Gemini) to trace a scanned plan or phone photo reliably:
1. `get_background_image` returns the image (base64/URL), `naturalWidth`, `naturalHeight`, and current calibration (`cmPerPx`, `xCm`, `yCm`, `rotationDeg`).
2. `calibrate_scale` accepts two pixel points `(pxA, pxB)` and `realCm`, computing `cmPerPx` deterministically.
3. `add_rooms_batch` with `dryRun: true` (or `draft: true`) lets the agent propose rooms in pixel coordinates (auto-converted to world `cm` via `cmPerPx`) or world `cm`.
4. `render_plan` with `includeBackground: true` returns an SVG (or rasterized PNG) with semi-transparent colored rooms overlaid on the background image, so the vision agent can visually inspect drift and adjust vertices in 1–2 refinement loops before committing.

### 3.9 Browser-Agent Friendliness (Claude in Chrome / Playwright)
1. **Semantic DOM & SVG attributes:**
   - Toolbar buttons: `aria-label={label}`, `data-tool={id}`, `aria-pressed={tool === id}`.
   - SVG `<svg data-testid="floorplan-canvas">`.
   - Room `<path>`: `data-room-id={r.id}`, `data-room-code={r.code}`, `aria-label="${r.name} (${r.code})"`.
   - Wall `<line>`: `data-wall-label="${r.code}-${w.index + 1}"`, `data-wall-type={p.type}`, `data-wall-length-cm={Math.round(w.length)}`.
   - Element `<g>`: `data-element-id={el.id}`, `data-element-kind={el.kind}`.
2. **`window.__floorplan` stable browser API:**
   ```ts
   window.__floorplan = {
     version: 1,
     getDoc: () => PlanDoc,
     getDsl: () => string,
     dispatch: (cmd: Command | Command[], opts?: { dryRun?: boolean }) => CommandResult,
     query: (q: QueryRequest) => QueryResult,
     setMode: (m: 'edit' | 'measure') => void,
     setView: (v: { x: number; y: number; zoom: number } | 'fit') => void,
     select: (s: Selection) => void,
     exportSvg: (opts?: ExportOpts) => string,
     undo: () => void,
     redo: () => void,
   }
   ```
   A browser agent can call `window.__floorplan.dispatch(...)` directly instead of guessing pointer drag pixels, while the human sees live visual updates and full Undo/Redo.
3. **URL state sync:** Encode `?project=<id>&mode=edit|measure&room=<code>` in the URL so agents can deep-link directly to any project, mode, or room.

### 3.10 Discovery, Auth, Idempotency & Event Log
- **`/llms.txt` and `/llms-full.txt`:** Static Markdown files at site root linking to `/api/openapi.json`, `/api/schema/plan.v1.json`, `/api/mcp`, the `.sfp` DSL spec, and example workflows.
- **Scoped API Tokens:** Add D1 table `api_tokens (id, project_id, name, token_hash, scopes, created_at, revoked_at)`. Support `Authorization: Bearer sfp_<token>` with scopes `read`, `measure`, `edit`, `admin`. Keep `x-passcode` for simple personal browser sessions.
- **Idempotency table:** `idempotency_keys (key, project_id, response_json, created_at)` in D1 (24 h TTL) so retried agent tool calls return the exact prior result.
- **Append-only Event Log:** Add D1 table `project_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id, actor, command_type, payload_json, diff_json, snapshot_version, created_at)`. Expose `GET /api/projects/:id/events?sinceSeq=` so agents and humans can audit every edit and roll back cleanly.

---

## 4. Concrete API & MCP Tool Specification (18 Tools)

All MCP tools map 1:1 to Hono API endpoints. Every mutation tool accepts optional `dryRun?: boolean` and `idempotencyKey?: string`.

### A. Project & Discovery

#### 1. `list_projects` — `GET /api/projects`
- **Input:** `{}`
- **Output:**
  ```json
  {
    "projects": [
      { "id": "proj_apt_4b", "name": "Apartment 4B", "title": "Apt 4B · 3rd floor", "version": 14, "updatedAt": "2026-11-21T10:15:00Z" }
    ]
  }
  ```

#### 2. `get_plan` — `GET /api/projects/:id?format=json|dsl|summary`
- **Input:** `{ "projectId": "proj_apt_4b", "format": "summary" }`
- **Output:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "schemaVersion": 1,
    "version": 14,
    "title": "Apt 4B · 3rd floor",
    "totalIndoorAreaM2": 58.4,
    "totalOutdoorAreaM2": 6.2,
    "rooms": [
      { "id": "room_SE", "code": "SE", "name": "Living Room", "areaM2": 22.1, "ceilingCm": 265, "wallCount": 4, "measured": "4/6" },
      { "id": "room_CU", "code": "CU", "name": "Kitchen", "areaM2": 9.8, "ceilingCm": 265, "wallCount": 4, "measured": "5/6" }
    ],
    "elementCount": 11,
    "warningCount": 2
  }
  ```

#### 3. `get_events` — `GET /api/projects/:id/events`
- **Input:** `{ "projectId": "proj_apt_4b", "sinceSeq": 40, "limit": 10 }`
- **Output:**
  ```json
  {
    "events": [
      { "seq": 41, "actor": "agent:claude-code", "commandType": "set_measurement", "summary": "Set CU-2 = 342 cm", "snapshotVersion": 14, "createdAt": "2026-11-21T10:12:00Z" }
    ]
  }
  ```

### B. Geometry & Walls

#### 4. `add_room` — `POST /api/projects/:id/commands` (`add_room`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "code": "CU",
    "name": "Kitchen",
    "shape": { "kind": "rect", "x": 180, "y": 420, "widthCm": 280, "heightCm": 350 },
    "ceilingCm": 265,
    "outdoor": false,
    "coordSpace": "world_cm",
    "idempotencyKey": "add-cu-1"
  }
  ```
  *(Also accepts `shape: { "kind": "polygon", "points": [{ "x": 0, "y": 0 }, ...] }` and `coordSpace: "image_px"` when background is calibrated.)*
- **Output:**
  ```json
  {
    "ok": true,
    "version": 15,
    "room": { "id": "room_CU", "code": "CU", "name": "Kitchen", "areaM2": 9.8, "walls": ["CU-1", "CU-2", "CU-3", "CU-4"] },
    "warnings": []
  }
  ```

#### 5. `slice_room` — `POST /api/projects/:id/commands` (`slice_room`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "roomCode": "SE",
    "line": { "a": { "x": 360, "y": -10 }, "b": { "x": 360, "y": 430 } },
    "newRoomCode": "EN",
    "newRoomName": "Entry"
  }
  ```
- **Output:**
  ```json
  {
    "ok": true,
    "version": 16,
    "rooms": [
      { "code": "SE", "name": "Living Room", "areaM2": 14.5 },
      { "code": "EN", "name": "Entry", "areaM2": 7.6 }
    ],
    "elementsMoved": 2,
    "elementsDropped": 0
  }
  ```

#### 6. `cutout_room` — `POST /api/projects/:id/commands` (`cutout_room`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "roomCode": "CU",
    "cut": { "kind": "rect", "x": 180, "y": 420, "widthCm": 60, "heightCm": 45 },
    "label": "Plumbing shaft"
  }
  ```
- **Output:**
  ```json
  { "ok": true, "version": 17, "roomCode": "CU", "oldAreaM2": 9.8, "newAreaM2": 9.53 }
  ```

#### 7. `merge_rooms` — `POST /api/projects/:id/commands` (`merge_rooms`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "roomCodes": ["SE", "CU"],
    "keepCode": "SE",
    "newName": "Living Room + Open Kitchen",
    "allowBearingRemoval": false,
    "dryRun": true
  }
  ```
- **Output:**
  ```json
  {
    "ok": true,
    "dryRun": true,
    "sharedWall": { "labels": ["SE-3", "CU-1"], "type": "partition", "lengthCm": 280, "thicknessCm": 10 },
    "beforeAreaM2": { "SE": 22.1, "CU": 9.8, "sum": 31.9 },
    "afterAreaM2": 32.18,
    "deltaAreaM2": 0.28,
    "elementsRemovedOnSharedWall": [{ "id": "el_door_3", "kind": "door", "widthCm": 80 }],
    "warnings": []
  }
  ```
  *(If the shared wall is `bearing` and `allowBearingRemoval` is `false`, returns `ok: false, error: { code: "BEARING_WALL_BLOCKED", message: "Shared wall SE-3 / CU-1 is marked bearing (25 cm)." }`.)*

#### 8. `set_wall_props` — `POST /api/projects/:id/commands` (`set_wall_props`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "wallLabel": "SE-2",
    "type": "bearing",
    "thicknessCm": 25,
    "locked": true
  }
  ```
- **Output:**
  ```json
  { "ok": true, "version": 18, "wallLabel": "SE-2", "props": { "type": "bearing", "thicknessCm": 25, "locked": true } }
  ```

#### 9. `move_wall_or_vertex` — `POST /api/projects/:id/commands` (`move_vertex` / `shift_wall`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "wallLabel": "CU-3",
    "shiftInwardCm": -15
  }
  ```
- **Output:**
  ```json
  { "ok": true, "version": 19, "roomCode": "CU", "oldAreaM2": 9.53, "newAreaM2": 9.95, "warnings": [] }
  ```

### C. Wall Elements (Doors, Windows, Storage, Fixtures)

#### 10. `place_element` — `POST /api/projects/:id/commands` (`place_element`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "wallLabel": "CU-2",
    "kind": "window",
    "variant": "standard",
    "offsetCm": 65,
    "widthCm": 120,
    "heightCm": 135,
    "sillCm": 95,
    "note": "Above sink"
  }
  ```
- **Output:**
  ```json
  {
    "ok": true,
    "version": 20,
    "element": { "id": "el_CU_2_win_1", "roomCode": "CU", "wallLabel": "CU-2", "kind": "window", "offsetCm": 65, "widthCm": 120, "overflows": false }
  }
  ```

#### 11. `update_or_delete_element` — `POST /api/projects/:id/commands` (`update_element` / `delete_element`)
- **Input:**
  ```json
  { "projectId": "proj_apt_4b", "action": "update", "elementId": "el_CU_2_win_1", "patch": { "offsetCm": 70, "widthCm": 115 } }
  ```
- **Output:**
  ```json
  { "ok": true, "version": 21, "elementId": "el_CU_2_win_1", "overflows": false }
  ```

### D. Measuring & Survey

#### 12. `set_measurement` — `PUT /api/projects/:id/measurements/:label` (or batch via `/commands`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "measurements": [
      { "label": "CU-1", "actualCm": 281.5 },
      { "label": "CU-2", "actualCm": 348.0 },
      { "label": "CU-H", "actualCm": 264.0 }
    ]
  }
  ```
- **Output:**
  ```json
  {
    "ok": true,
    "results": [
      { "label": "CU-1", "plannedCm": 280, "actualCm": 281.5, "diffCm": 1.5, "flagged": false },
      { "label": "CU-2", "plannedCm": 350, "actualCm": 348.0, "diffCm": -2.0, "flagged": false },
      { "label": "CU-H", "plannedCm": 265, "actualCm": 264.0, "diffCm": -1.0, "flagged": false }
    ],
    "progress": { "done": 19, "total": 24 }
  }
  ```

#### 13. `apply_measurements` — `POST /api/projects/:id/commands` (`apply_measurements`)
- **Input:**
  ```json
  { "projectId": "proj_apt_4b", "roomCode": "CU", "lockVerifiedWalls": true, "dryRun": true }
  ```
- **Output:**
  ```json
  {
    "ok": true,
    "dryRun": true,
    "roomCode": "CU",
    "maxResidualCm": 0.4,
    "oldAreaM2": 9.8,
    "newAreaM2": 9.79,
    "lockedWalls": ["CU-1", "CU-2", "CU-3", "CU-4"],
    "warnings": []
  }
  ```

### E. Semantic Queries & Validation

#### 14. `get_unmeasured` — `POST /api/projects/:id/query` (`unmeasured`)
- **Input:** `{ "projectId": "proj_apt_4b", "roomCode": null }`
- **Output:**
  ```json
  {
    "done": 19,
    "total": 24,
    "remaining": [
      { "label": "C1-3", "roomCode": "C1", "roomName": "Bedroom 1", "kind": "wall", "plannedCm": 310 },
      { "label": "C1-D", "roomCode": "C1", "roomName": "Bedroom 1", "kind": "diagonal", "plannedCm": 468.2 },
      { "label": "C1-H", "roomCode": "C1", "roomName": "Bedroom 1", "kind": "height", "plannedCm": null }
    ]
  }
  ```

#### 15. `validate_plan` — `POST /api/projects/:id/query` (`validate`)
- **Input:** `{ "projectId": "proj_apt_4b" }`
- **Output:**
  ```json
  {
    "valid": false,
    "errors": [
      { "code": "ELEMENT_OVERFLOW", "roomCode": "CU", "wallLabel": "CU-3", "elementId": "el_cup_2", "message": "Cupboard (offset 210 + width 90 = 300 cm) exceeds wall length 280 cm." }
    ],
    "warnings": [
      { "code": "DISCREPANCY", "label": "SE-2", "plannedCm": 420, "actualCm": 414.5, "diffCm": -5.5 },
      { "code": "NOT_SQUARE", "roomCode": "SE", "expectedDiagCm": 590.1, "actualDiagCm": 593.0, "diffCm": 2.9 }
    ]
  }
  ```

#### 16. `find_shared_walls` — `POST /api/projects/:id/query` (`shared_walls`)
- **Input:** `{ "projectId": "proj_apt_4b", "roomCodes": ["SE", "CU"] }`
- **Output:**
  ```json
  {
    "sharedWalls": [
      { "wallA": "SE-3", "wallB": "CU-1", "overlapCm": 280, "gapCm": 0, "typeA": "partition", "typeB": "partition", "isBearing": false }
    ]
  }
  ```

### F. Tracing, Visual Verification & Export

#### 17. `calibrate_background` — `POST /api/projects/:id/commands` (`calibrate_scale`)
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "pointAPx": { "x": 120, "y": 400 },
    "pointBPx": { "x": 820, "y": 400 },
    "realCm": 420
  }
  ```
- **Output:**
  ```json
  { "ok": true, "version": 22, "cmPerPx": 0.6, "pxPerMeter": 166.67 }
  ```

#### 18. `export_plan` — `POST /api/projects/:id/export`
- **Input:**
  ```json
  {
    "projectId": "proj_apt_4b",
    "format": "pdf",
    "roomCodes": ["CU"],
    "includeLegend": true,
    "includeMeasurementsTable": true,
    "includeBackground": false
  }
  ```
  *(Supports `format`: `"svg" | "pdf" | "dxf" | "imdf" | "ifc-lite" | "csv" | "dsl" | "png"`.)*
- **Output:**
  ```json
  {
    "format": "pdf",
    "filename": "apt-4b-CU.pdf",
    "contentType": "application/pdf",
    "url": "/api/projects/proj_apt_4b/exports/exp_91a2.pdf",
    "summary": "1-room kitchen sheet (CU, 9.80 m², 4 walls, 3 elements, 0 overflows)."
  }
  ```

---

## 5. Phased Implementation Plan

Effort scale: **S** (0.5–1 day), **M** (2–4 days), **L** (5+ days). Build in this order so each phase immediately unlocks real agent workflows.

### Phase 1 — Core Schema, Command Layer & Semantic Queries (Foundation)
1. **Zod `PlanDoc` v1 schema + JSON Schema endpoint** (`S`): Add `schemaVersion: 1`, `src/core/schema.ts`, and `GET /api/schema/plan.v1.json`. Validate all API writes.
2. **Pure Command Layer + `POST /api/projects/:id/commands`** (`M`): Move room/element/measurement mutations into `src/core/commands.ts` with semantic wall addressing (`SE-2`), `dryRun`, and `Idempotency-Key`. Add `merge_rooms` and `apply_measurements`.
3. **Semantic Query Engine + `POST /api/projects/:id/query`** (`S`): Expose `summary` (areas, paint/baseboard takeoff), `unmeasured`, `validate`, and `shared_walls` using existing pure logic from `geometry.ts` and `measure/logic.ts`.
4. **Browser-agent DOM attributes + `window.__floorplan` + URL state** (`S`): Add `data-room-code`, `data-wall-label`, `data-tool`, `aria-label` in `App.tsx` and `RoomsLayer.tsx`, plus `window.__floorplan` bridge.

### Phase 2 — MCP Server, Discovery & Headless Visual Render (Agent Usability)
5. **Headless SVG renderer (`exportSvg`)** (`S`): Pure TS SVG generator in `src/core/export.ts` (with optional background overlay) so agents can visually inspect plans without a browser.
6. **Remote MCP Server (`/api/mcp`) + stdio wrapper** (`M`): Expose the 18 tools, 6 resources, and 4 prompts over Streamable HTTP.
7. **OpenAPI 3.1 (`/api/openapi.json`) + `/llms.txt`** (`S`): Auto-generate OpenAPI from Zod routes and publish `/llms.txt` at site root.
8. **Scoped API Tokens + Event Log (`project_events`)** (`M`): Add `api_tokens` and `project_events` D1 migrations, `Authorization: Bearer` middleware, and `GET /api/projects/:id/events`.

### Phase 3 — Concise DSL, CLI & Contractor Exports (Power Workflows)
9. **Floorplan DSL (`.sfp`) parser & formatter** (`M`): Bidirectional `planToDsl` / `dslToPlan` in `src/core/dsl.ts`, wired into `get_plan`, MCP resources, and CLI.
10. **CLI (`sfp`)** (`S`): Thin CLI for `pull`, `apply --dry-run`, `query`, `export`, and local `.sfp` workflows.
11. **Export suite: PDF, CSV, DXF** (`M`): Kitchen/contractor PDF sheet, CSV survey/takeoff export, and layered ASCII DXF export.

### Phase 4 — Vision Tracing Loop & BIM/Mapping Interop
12. **Vision-tracing overlay & batch pixel-space import** (`M`): `coordSpace: "image_px"` in `add_room`, `render_plan` with `includeBackground: true` (PNG via Workers/Canvas or SVG data-URI embed), and `trace-from-image` MCP prompt.
13. **IMDF GeoJSON + IFC-lite export/import** (`L`): OGC IMDF `FeatureCollection` and IFC-lite JSON/STEP export + DXF polyline importer.

---

## 6. Example End-to-End Agent Workflows

### Workflow 1: "Trace this photo of a plan"
1. User drops `apartment-scan.jpg` into Claude Code / MCP client.
2. Agent calls `POST /api/projects` → gets `proj_new`, then uploads image to `POST /api/projects/proj_new/images`.
3. Agent inspects the image visually, finds a printed scale bar or known wall (e.g., `"4,20 m"` from pixel `(120, 400)` to `(820, 400)`), and calls `calibrate_background`.
4. Agent reads room outlines from the image and calls `add_room` (batch, `coordSpace: "image_px"`, `dryRun: false`) for `EN`, `SE`, `CU`, `C1`, `SDB`, plus `set_wall_props` for thick dark walls (`bearing` / `exterior`) and `place_element` for visible doors/windows.
5. Agent calls `export_plan(format: "svg", includeBackground: true)` (or PNG render), visually inspects the overlay, sees `CU-3` is shifted 12 cm left, calls `move_wall_or_vertex`, and runs `validate_plan`.
6. Agent replies with room areas, total m², and a link to open the plan in Measuring Mode (`/?project=proj_new&mode=measure`).

### Workflow 2: "What's left to measure?"
1. User asks from phone or desktop chat: *"What is still left to measure in Apt 4B?"*
2. Agent calls `get_unmeasured(projectId: "proj_apt_4b")` and `validate_plan(projectId: "proj_apt_4b")`.
3. Agent replies with a concise walking-order checklist:
   - `C1` (Bedroom 1): `C1-3` (est. 310 cm), `C1-D` (diagonal), `C1-H` (ceiling height).
   - Flags 1 existing issue to re-check on site: `SE-2` differs by `-5.5 cm` from the traced plan and `SE` is out of square by `+2.9 cm`.
4. User dictates values (`"C1-3 is 312, C1-D is 469, C1-H is 264"`). Agent calls `set_measurement` batch, confirms `24/24` complete, and asks whether to run `apply_measurements` (showing a `dryRun` area diff first).

### Workflow 3: "Export a PDF for the kitchen planner"
1. User asks: *"Export a PDF for the kitchen planner."*
2. Agent calls `validate_plan(projectId: "proj_apt_4b")` and filters issues for room `CU`.
3. Agent catches a blocker: cupboard `el_cup_2` overflows wall `CU-3` by 20 cm, and `CU-H` (ceiling height) is still estimated.
4. Agent warns the user, offers a quick fix (or proceeds with a disclaimer if requested), then calls:
   - `export_plan(format: "pdf", roomCodes: ["CU"], includeLegend: true, includeMeasurementsTable: true)`
   - `export_plan(format: "dxf", roomCodes: ["CU"])` (for the planner's CAD software)
   - `export_plan(format: "csv", roomCodes: ["CU"])` (exact wall lengths, window sill height `95 cm`, and plumbing-shaft cutout dimensions).
5. Agent returns the download links and a 5-line summary of the kitchen dimensions (`9.80 m²`, ceiling `264 cm`, window `CU-2` sill `95 cm`).

### Workflow 4: "Knock down the partition between kitchen and living room and show me the new area"
1. User asks: *"Knock down the partition between kitchen and living room and show me the new area."*
2. Agent calls `find_shared_walls(projectId: "proj_apt_4b", roomCodes: ["SE", "CU"])`.
   - Confirms `SE-3` / `CU-1` is `type: "partition"` (`10 cm`, `isBearing: false`). *(If it were `bearing`, the agent stops immediately and warns the user that a structural engineer is required.)*
3. Agent calls `merge_rooms(roomCodes: ["SE", "CU"], keepCode: "SE", allowBearingRemoval: false, dryRun: true)`.
4. Agent presents the preview:
   - Before: Living Room `22.10 m²` + Kitchen `9.80 m²` = `31.90 m²`.
   - After: `32.18 m²` (`+0.28 m²` reclaimed from the 10 cm × 280 cm partition footprint).
   - Removes 1 interior door (`el_door_3`, 80 cm) on the removed wall.
5. Once user confirms (or if they asked to apply it directly), agent calls `merge_rooms(..., dryRun: false)`, then `export_plan(format: "svg")` to display the updated open-plan layout.
