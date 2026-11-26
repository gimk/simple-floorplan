# Simple Floorplan 2 — Product Reset & Migration Plan

## 1. Vision & Reset

Simple Floorplan grew into a heavy architectural survey tool (~50k LOC, wall-thickness graph, non-linear least-squares solver, on-site laser measuring mode, Carrez/DPE references, demolition diffs, 13 canvas tools, 3-tab inspector, MCP/CLI/DXF). It became too complex to maintain and too rigid to use.

**Simple Floorplan 2** resets the product to a fast, Figma-like **interior design tool**:

- **What it is:** Draw rooms as clean 1px shapes, tweak wall lengths, drop in doors and windows, duplicate artboards to explore layout options, and arrange furniture with simple colors (with a path to a simple 3D view later).
- **What it is NOT:** An architectural CAD tool, a laser-survey app, a wall-thickness or load-bearing analyzer, or a constraint solver.

---

## 2. Organized Feature Spec

### 2.1 Canvas & Artboards
- **Infinite 2D canvas** (pan, zoom, metric grid, cm units).
- **Artboards (Figma-style):** An artboard holds one complete floorplan version (`rooms`, `openings`, `furniture`).
  - Displayed with a clean title bar above the frame and a one-click **Duplicate** action to create a side-by-side layout variant on the same canvas.
  - Multiple artboards can be compared visually at once.
- **Reference images:** Uploaded images (and optionally PDFs) live directly on the canvas background layer. They can be moved, scaled/calibrated, rotated, faded (opacity), locked, or deleted—just like any canvas object, with no dedicated modal or tab.

### 2.2 Top-Level Mode Switch: `Plan` | `Design`
Located prominently in the top center bar:
- **Plan mode:** Edit rooms, wall lengths, doors/windows, reference images, and artboards. Furniture is dimmed or hidden (optional toggle) and non-interactive.
- **Design mode:** Plan geometry (rooms, walls, doors, windows) is **locked**. Only furniture (and later floor/paint finishes) can be added, moved, rotated, resized, or styled.

### 2.3 Plan Mode — Rooms & Walls
- **1px lines, zero wall thickness:** Rooms are closed 2D polygons rendered like Figma vector shapes. Every wall has **one** length measurement.
- **Drawing & reshaping rooms:**
  - **Rectangle (`R`)** and **Pen / Polygon (`P`)** to trace rooms.
  - **Vertex & edge editing:** Drag vertices or walls directly; click an edge with Pen (or double-click a room) to insert/move/delete points.
  - **Cutout (`X`):** Subtract a rectangle or polygon from a room.
  - **Merge:** Combine 2+ selected touching/overlapping rooms into one shape.
- **Direct measurement editing:**
  - Click a wall on the canvas to type its exact length inline, **or** edit it in the right Inspect panel.

### 2.4 Plan Mode — Architectural Objects (Left Panel)
Replaces the Layers panel when in Plan mode:
- **Object library:** `Door`, `Window` (and optionally `Opening / Arch`).
- **2-click placement:**
  1. Pick an object from the left panel and hover any wall -> snaps cleanly to the wall.
  2. **Click 1:** Places the object on the wall.
  3. **Move mouse:** Flips hinge side and swing direction (for doors).
  4. **Click 2:** Confirms placement.
- **Post-placement editing:** Select to drag along the wall, drag endpoints to resize width, flip hinge/swing, or delete.
- **Rendering:** 1px stroke matching walls; doors show a thin 1px quarter-circle swing arc.

### 2.5 Design Mode — Furniture & Finishes (Left Panel)
Replaces the architectural picker when in Design mode:
- **Furniture (MVP):** Simple shapes (`rect` or `circle`) with a custom **name**, **width × depth (cm)**, **rotation**, and **color**.
  - Starter presets (Bed, Sofa, Dining Table, Desk, Wardrobe, Chair, Rug, etc.) are just pre-filled custom shapes.
  - Users can create any custom shape in seconds.
- **Ground & paint (TBD / Phase 4+):** Simple room floor fill color/swatch (and later wall accent color or textures).

### 2.6 Unified Right Panel — Inspect Only
No tabs (`Solve`, `Plan`, `Layers`, and `Measure` are all gone). One calm, context-sensitive **Inspect** panel:
- **Nothing selected -> Apartment / Active Artboard:** Name, total area (m²), room list, ceiling height (optional, for future 3D), Duplicate artboard button.
- **Room selected -> Room:** Name, area (m²), fill color (in Design mode), list of its walls with editable length inputs.
- **Wall selected -> Wall:** Exact length input, openings hosted on that wall.
- **Opening selected -> Door / Window:** Width, offset along wall, flip hinge / flip swing, delete.
- **Furniture selected (Design mode) -> Furniture:** Name, shape (`rect`/`circle`), width, depth, rotation, color, duplicate, delete.
- **Reference Image selected -> Image:** Opacity, scale / 2-point calibrate, rotation, lock, delete.

---

## 3. Challenges & Design Decisions

These are the hardest trade-offs hidden inside the new spec. Resolving them before writing code prevents v2 from accumulating the same complexity as v1.

### Challenge 1: Independent room polygons vs. shared walls
- **The tension:** In v1, trying to maintain a single topological wall graph (`src/model/v2/`, 28 files) caused massive repair/dedupe/sync complexity. However, if rooms are purely independent polygons (like Figma shapes), two touching rooms have two overlapping 1px edges—editing a wall length in Room A will not automatically move Room B's edge.
- **Recommendation:** Keep rooms as **independent polygons** (simple, bug-free data model). Solve the adjacency UX with **magnetic edge/vertex snapping** during drag, plus an optional **"Move touching edges together"** behavior when dragging a shared line (or Shift-selecting both rooms). For typing a wall length on a rectangle, shift the whole opposite parallel edge so the room stays rectangular; on an arbitrary polygon, move the second vertex along the wall vector.

### Challenge 2: Who owns a door/window between two rooms?
- **The tension:** If Room A and Room B are separate polygons sharing a boundary, attaching a door strictly to `(roomId, edgeIndex)` breaks whenever you merge, cutout, or delete one of the rooms.
- **Recommendation:** Store openings in **artboard-local coordinates** `(xCm, yCm, angleDeg, widthCm, kind, hinge, swing)` rather than hard-binding them to a polygon edge index. During placement and drag, openings snap to the nearest wall segment. When a wall moves, any opening currently sitting on that segment can move with it by geometric hit-test. Result: cutouts, merges, and vertex edits never corrupt or orphan doors.

### Challenge 3: What happens to the existing backend, CLI, MCP, and 180 tests?
- **The tension:** The repo currently has ~450 source files, 180 test files, a Cloudflare Worker (`functions/`), 23 MCP tools, `cli/sfp.mjs`, `src/core/commands.ts` (2,126 LOC), and `src/core/dsl.ts` (1,389 LOC). Keeping all of those synced during a product pivot will triple the work and re-introduce friction.
- **Recommendation:** **Freeze or remove** the agent surface (`cli/`, `mcp-stdio/`, `functions/mcp/`, `src/core/dsl.ts`, `src/core/queries.ts`, `src/core/commands.ts`, `src/share/`) for now. Keep local-first **IndexedDB** (`src/sync/idb.ts`) and optionally a minimal JSON-blob save endpoint if cloud sync is still wanted. Start with a clean schema (`schemaVersion: 3` or fresh `v2-simple`) with **no legacy migration** from the thick-wall/solver format.

### Challenge 4: Artboards vs. Reference Images
- **The tension:** If you duplicate an artboard to try 3 kitchen layouts, you usually do **not** want 3 duplicate copies of a 5 MB scanned floorplan image stacked under them.
- **Recommendation:** Store `refImages[]` at the **canvas (project) level**, not inside each artboard. You upload and trace once over the reference image, then duplicate clean artboards beside it.

### Challenge 5: Mode-switching friction (`Plan` <-> `Design`)
- **The tension:** Locking the plan in Design mode prevents accidental wall drags when placing a sofa, which is great—but users frequently notice a door needs to move 10 cm while placing furniture.
- **Recommendation:** Make toggling `Plan <-> Design` instant (top pill + keyboard shortcut like `1` / `2` or `Tab`) while keeping exact viewport pan/zoom.

### Challenge 6: 1px 2D walls vs. future 3D view
- **The tension:** 1px walls have zero thickness in 2D, but a 3D doll-house view needs walls to have height and some minimal visual extrusion.
- **Recommendation:** Keep 2D strictly 1px and zero-thickness in the UI and math. Store just one optional `ceilingHeightCm` (default `250`) on the artboard and optional `heightCm` on openings/furniture (with sensible defaults: door 205 cm, window 120 cm + sill 90 cm, sofa 80 cm). Zero UI clutter now, ready for 3D later.

### Challenge 7: Too many room-drawing tools
- **The tension:** v1 had 13 tools (`select`, `pan`, `rect`, `polygon`, `wall`, `make-room`, `slice`, `cutout`, `place-element`, `place-storage`, `calibrate`, `tape`, `pin`).
- **Recommendation:** Cut Plan mode down to **4 canvas tools** + contextual actions:
  1. `Select (V)` — select, drag rooms/walls/vertices/openings/images; double-click room to edit points.
  2. `Rectangle (R)` — draw rectangular room.
  3. `Pen (P)` — trace custom polygon room, or click an edge to add a vertex.
  4. `Cutout (X)` — subtract a shape from a room.
  - `Merge` is a contextual button in the Inspect panel when 2+ rooms are selected.
  - `Pan` is always available via `Space + drag`, middle-click, or trackpad scroll.
  - `Calibrate` lives on the Image Inspect panel (not a permanent toolbar button).
  - `Tape` can be dropped or kept as a tiny optional quick-measure key (`M`) if you still want ad-hoc distance checks.

### Challenge 8: Are simple furniture rectangles enough to read a layout?
- **The tension:** Plain identical rectangles make it hard to tell which way a bed, sofa, or chair faces.
- **Recommendation:** Add two tiny visual cues that require no complex icons:
  1. A **front-edge indicator** (a thin tick/bar on one side of the rectangle) so orientation is unmistakable.
  2. Support **`rect` and `circle`** shapes (covers round tables, stools, plants, lamps).
  3. Keep door swing arcs visible in Design mode so clearance is visually obvious without any clash-detection engine.

---

## 4. Suggestions to Consider

1. **Figma-style distance guides in Design mode:** While dragging furniture, show thin alignment lines and live distances in cm to the nearest walls (e.g., `65 cm` walkway behind a dining chair). Huge interior-design payoff for very little code.
2. **Light / neutral studio canvas theme:** Right now the app is dark-only. Interior design with colored rooms, rugs, and furniture reads much better on a light/warm-grey canvas (or light/dark toggle).
3. **One-click Artboard Export (PNG / SVG):** Replace the heavy PDF/DXF/CSV/survey export suite with a single "Export PNG / SVG" button per artboard to share design options easily.
4. **Simple Furniture Presets + "Duplicate (`Cmd+D`)":** Ship ~10 starter furniture items (Bed, Sofa, Armchair, Dining Table, Coffee Table, Desk, Wardrobe, Bookshelf, Kitchen Counter, Rug) plus `Cmd+D` to duplicate furniture or artboards quickly.
5. **Simple Floor Colors in Design Mode MVP:** Even before textures/paint, a muted palette of 8–10 floor tints (warm wood, light oak, tile, concrete, carpet, outdoor) per room makes plans feel alive immediately.

---

## 5. Codebase Triage: Keep vs. Delete

Based on the current repo (~450 files in `src/`, plus `functions/`, `cli/`, `mcp-stdio/`):

### Delete completely
- **Solver & constraints:** `src/features/solver/`, `src/features/solve/`, `src/features/rooms/globalSolve*`, `solve.ts`, `applyGlobal.ts`, `autodiff.ts`, `fit.ts`, `apply.ts`, `suggest.ts`, `SolverGhostLayer.tsx`, `measureRules.ts`
- **Thick-wall graph & v2 sync:** `src/model/v2/`, `src/model/wallGraph.ts`, `storedGraph.ts`, `graphRule.ts`, `faces.ts`, `wallSides.ts`, `wallValues.ts`, `relabel.ts`, `oldMeasurements.ts`, `survey.ts`, `measureSource.ts`, `src/features/rooms/thickness.ts`, `wallJoins.ts`, `wallOutline.ts`, `wallSides.ts`, `wallFaces*`, `StoredWallCard.tsx`, `StoredWallGroupCard.tsx`, `NewWallsCard.tsx`, `wallTool*`, `makeRoom*`, `traces*`
- **Measuring mode & outside/survey dims:** `src/features/measure/`, `src/features/rooms/outside/`, `src/features/rooms/dims/valueStates.ts`, `useValueStates.ts`, `storageLabel.ts`, `tagPin.ts`
- **Unneeded features:** `src/features/layers/`, `src/features/clearance/`, `src/features/renovation/`, `src/features/schedule/`, `src/features/storage/`, `src/features/annotations/`, `src/features/photosketch/`, `src/features/apartment/` (conversion & Carrez/DPE/Boutin), `src/features/share/`, `src/share/`
- **Heavy export & agent surface (freeze or delete):** `src/features/export/` (PDF, CSV, survey, material calc), `src/core/commands.ts`, `src/core/queries.ts`, `src/core/dsl.ts`, `src/core/dxf.ts`, `cli/`, `mcp-stdio/`, `functions/mcp/`
- **Sidebar tabs & shell bloat:** `Solve` tab, `Plan` tab, `LayersSection`, `MeasureDisplayControls`, `ViewMenu` bloat, `CommandPalette` (optional to rebuild tiny later)

### Keep & reuse
- **Stack:** React 19, TypeScript, Vite 8, Tailwind v4, Zustand 5 + `zundo`, `lucide-react`, `polygon-clipping`, `zod`, Vitest, oxlint.
- **Core primitives:**
  - `src/canvas/Viewport.tsx` & `src/shell/viewMath.ts` (pan/zoom SVG viewport in cm)
  - `src/shell/CanvasGrid.tsx`, `ZoomControls.tsx`
  - `src/model/geometry.ts` (polygon area, centroid, point-in-polygon, segment projection)
  - `polygon-clipping` cutout & merge helpers (simplified from `src/features/rooms/ops.ts`)
  - `src/shell/panel/` primitives (`PanelSection`, `FieldRow`, `NumberField`, `TextField`, `Segmented`, etc.)
  - `src/features/background/` (image/PDF upload, 2-point calibrate, rotate, opacity)
  - `src/features/toast/`
  - `src/sync/idb.ts` (local IndexedDB persistence)

---

## 6. Multi-Step Migration Plan

### Phase 0 — Backup, Data Export & Clean Cut
**Goal:** Preserve v1 and all Joinville / D1 data safely, then strip deleted subsystems so the repo compiles cleanly with a minimal skeleton.
- Export all D1 measurements and the Joinville plan JSON (plus any needed reference image from R2) into `backups/` and verify the saved files.
- Once verified, wipe the remote D1/R2 databases.
- Create a git tag `archive/v1-survey` so v1 code is never lost.
- Delete the modules listed in Section 5 ("Delete completely"), including the D1/R2/Worker sync layer (use local-first IndexedDB + JSON import/export for v2).
- Simplify `App.tsx` to a minimal dark-UI shell: top bar (`Title` | `Plan / Design` switch | `Undo / Redo`), left panel placeholder, SVG `Viewport`, right `Inspect` panel placeholder.
- Verify: `npx tsc -b`, `npx vite build`, and `npx vitest run` pass with zero broken imports.

### Phase 1 — New Data Model, Multi-Artboard Canvas & Reference Images
**Goal:** Establish the clean v2 data model, local persistence, artboards, and background reference images.
- Define new `ProjectDoc` in `src/model/types.ts` + Zod schema:
  ```ts
  ProjectDoc {
    id, title, schemaVersion: 3,
    refImages: RefImage[],
    artboards: Artboard[]
  }
  Artboard {
    id, name, xCm, yCm, ceilingHeightCm,
    rooms: Room[],
    openings: Opening[],
    furniture: FurnitureItem[]
  }
  Room { id, name, vertices: Vec2[], fill?: string }
  Opening { id, kind: 'door' | 'window' | 'opening', xCm, yCm, angleDeg, widthCm, hinge?: 'left' | 'right', swing?: 'in' | 'out' }
  FurnitureItem { id, name, shape: 'rect' | 'circle', xCm, yCm, widthCm, depthCm, rotationDeg, color }
  ```
- Wire Zustand + `zundo` undo/redo + IndexedDB auto-save.
- Render Artboard frames on the SVG canvas with a header label and **Duplicate Artboard** button (clones rooms, openings, furniture offset to the right).
- Re-attach image upload (drag-and-drop or button) as canvas background objects, selectable and editable in the right Inspect panel (opacity, scale/2-point calibrate, rotate, lock, delete).
- Verify: Create/duplicate artboards, upload/move/scale a reference image, reload page and confirm state persists.

### Phase 2 — Plan Mode: 1px Rooms, Shape Tools & Wall Measurements
**Goal:** Make drawing and measuring rooms feel as fast and crisp as Figma.
- Render rooms as clean 1px strokes with subtle fill and centered room name + area (m²).
- Implement Plan toolbar: **Select (`V`)**, **Rectangle (`R`)**, **Pen (`P`)**, **Cutout (`X`)**.
- Implement **Merge** in Inspect panel when 2+ rooms are selected (using `polygon-clipping`).
- Implement direct manipulation: drag room, drag wall, drag vertex, add/delete vertex with Pen, magnetic snapping to grid and nearby room edges/vertices.
- Implement **single wall measurement**:
  - Show length label on walls (clean, non-overlapping).
  - Click a wall length on the canvas to edit inline, or edit in Inspect panel.
- Implement context-sensitive **Inspect panel** for:
  - Artboard (default when nothing selected): name, total area, room list, ceiling height, duplicate.
  - Room: name, area, list of walls with inline length inputs.
  - Wall: length input, attached openings list.
- Verify: Trace a 4-room apartment over a reference image, cutout a closet, merge two shapes, adjust wall lengths by clicking walls and via Inspect.

### Phase 3 — Plan Mode: Architectural Objects (Doors & Windows)
**Goal:** Left-panel object picker with smooth 2-click wall-snapping placement.
- Build Left Panel for Plan mode: **Door**, **Window** (and optional **Opening**).
- Implement placement flow:
  - Hover any room wall -> live 1px preview snapped to wall.
  - Click 1 -> anchor position on wall.
  - Move mouse -> dynamically flip hinge (left/right) and swing (in/out) for doors.
  - Click 2 -> finalize.
- Render doors and windows at 1px thickness (white/background gap in wall line + 1px door leaf + 1px swing arc; 1px double-line or tick frame for windows).
- Allow selecting placed openings to drag along the wall, drag endpoints to resize width, or edit width/flip/delete in the Inspect panel.
- Verify: Place, flip, move, and resize doors and windows across multiple rooms and artboards.

### Phase 4 — Design Mode: Furniture & Simple Colors
**Goal:** Lock the floorplan and enable interior layout exploration.
- Wire the top **`Plan` | `Design`** switch:
  - Switching to `Design` locks all rooms, walls, openings, and reference images from editing (still visible, including 1px door arcs).
- Build Left Panel for Design mode:
  - **Custom Shape** creator (Name, `Rect` / `Circle`, Width cm, Depth cm).
  - Starter furniture presets (Bed, Sofa, Table, Desk, Chair, Wardrobe, Rug, etc.).
- Implement furniture canvas interaction:
  - Drag to move with magnetic snap + **live distance-to-nearest-wall guides**.
  - Corner handles to resize, rotation handle (with 15°/45° snap), `Cmd+D` to duplicate.
  - Front-edge tick indicator on rectangles so orientation is clear.
- Add simple **Room floor color** picker (when clicking a room in Design mode, only its fill color/name is editable—not its geometry).
- Wire Inspect panel for Furniture (name, shape, W × D, rotation, color, duplicate, delete).
- Verify: Duplicate an artboard, switch to Design mode, arrange two different furniture layouts side-by-side without accidentally moving a wall.

### Phase 5 — Polish, Export & 3D-Ready Foundation
**Goal:** Clean up rough edges and make the tool pleasant for daily use.
- Refine studio UI styling (decide light vs. dark canvas theme, crisp typography, minimal keyboard shortcuts).
- Add one-click **Export Artboard (PNG / SVG)**.
- Optional: Re-wire lightweight cloud snapshot save (single JSON doc per project in D1 + R2 for reference images) if remote sync is still desired.
- Document the clean extension points for future **Floor/Paint finishes** and a **simple 3D doll-house view** (extruding `room.vertices` by `artboard.ceilingHeightCm`, punching `openings`, and placing `furniture` boxes).

---

## 7. Confirmed Decisions

1. **Canvas theme:** Keep the dark UI.
2. **Persistence:** Use local-first IndexedDB + JSON import/export during the rebuild (no D1/R2 cloud sync overhead). Before removing the Worker/DB layer, export all D1 measurements into a local file in `backups/` so they are preserved, then clear D1/R2.
3. **Old v1 data (Joinville):** Export the Joinville plan (and its reference image, if stored in R2) into `backups/` before wiping D1/R2 so it can be rebuilt cleanly in Simple Floorplan 2. Also tag the v1 codebase as `archive/v1-survey`.
