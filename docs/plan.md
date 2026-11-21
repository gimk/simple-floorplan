# Simple Floorplan — Project Plan

> **Note:** The Measuring Mode section (2.5) is based on a working prototype: a phone survey page already used on site (single HTML file, kept locally and not in this repo). Features marked *(prototype)* exist in it; features marked *(new)* extend it.

---

## 1. Vision & Core Goal

A lightweight, web-based 2D floorplan editor and on-site measuring companion built for apartment renovation and interior design:

1. **Desktop / Tablet (Setup Mode):** Import an existing floorplan image, calibrate its scale, trace/cut/reshape rooms, mark load-bearing walls, and snap doors, windows, and built-in storage to walls.
2. **Phone (Measuring Mode):** Walk through the apartment with a tape measure or laser meter, tap walls/openings/clearances, record exact real-world dimensions, and track what has been verified vs. estimated.

---

## 2. Core Features (MVP Scope)

### 2.1 Background Image Import & Calibration
- **Import:** Upload PNG, JPG, WebP (or render first page of a PDF) as a background layer.
- **Controls:**
  - Opacity slider (e.g., 10%–80%) and visibility toggle.
  - Lock/unlock toggle so the image is never moved accidentally while tracing.
  - Pan, scale, and fine rotation (helpful when working from a photo of a paper plan).
- **2-Point Scale Calibration:**
  - Click two points on the image (e.g., a known wall or scale bar) and enter the real-world length (in `cm` or `m`).
  - Automatically sets the `pixels-per-meter` ratio for the entire canvas.

### 2.2 Room Tracing, Cutting & Reshaping
- **Tracing Tools:**
  - **Rectangle Tool:** Click-and-drag to create rectangular rooms quickly.
  - **Polygon Tool:** Click vertex-by-vertex to trace irregular rooms, angled walls, or alcoves.
- **Reshaping Tools:**
  - Drag vertices to move corners; drag wall segments to shift a wall parallel to itself.
  - Click an edge to insert a new vertex; delete a vertex to simplify.
  - **Snapping:** Snap to 90°/45° angles, existing vertices, wall extensions, and an optional grid (e.g., 5 cm / 10 cm).
- **Cutting / Splitting Tools:**
  - **Slice Tool:** Draw a line across a room polygon to split it into two rooms (e.g., separating an entry hallway from a living room).
  - **Cutout / Subtract Tool:** Carve out shafts, chimneys, columns, or closets from a room polygon.
- **Live Readouts:** Display room name, area (`m²`), and wall lengths (`cm` / `m`) directly on the canvas.

### 2.3 Wall Identification (Bearing vs. Partition)
- **Wall Properties:**
  - `type`: `bearing` (load-bearing) | `partition` (non-bearing) | `exterior`
  - `thickness`: e.g., `20–35 cm` for bearing/exterior walls, `7–10 cm` for partitions.
- **Visual Distinction:**
  - Bearing walls rendered thicker with a distinct fill/hatch pattern (e.g., dark solid or diagonal hatch).
  - Partition walls rendered thinner and lighter.
  - Quick toggle button or keyboard shortcut to flip a selected wall between bearing and partition.

### 2.4 Wall-Snapped Elements (Doors, Windows, Storage)
- **Snap-to-Wall Placement:** Elements automatically align to the host wall's angle and clamp within its length.
- **Supported Element Types (MVP):**
  - **Doors:** Single swing (with configurable hinge side & swing direction inward/outward), double door, sliding door, pocket door, open archway.
  - **Windows:** Standard window, French window/balcony door, fixed glazing (with optional sill height).
  - **Storage / Built-ins:** Wall-mounted cabinets, recessed closets, wardrobes (with width and depth).
- **Precise Positioning:**
  - Drag along the wall or edit exact numeric values: `width`, `depth`, and `offset from left/right corner`.

### 2.5 Measuring Mode (Mobile-First)
- **Mode Switch:** One-tap toggle between **Edit Mode** and **Measuring Mode** (with automatic mobile layout optimization when opened on a phone).
- **Safe Read-Only Geometry:** Prevents accidental dragging of rooms or walls while panning/zooming with one hand. Measuring Mode only records values; it never moves geometry.

#### 2.5.1 Survey Structure *(prototype)*
- **Room codes:** Each room gets a short code (`EN` Entrée, `SE` Séjour, `C1` Chambre 1…) and the rooms are ordered in **walking order** through the apartment.
- **Auto-generated measurement IDs per room** (generated from the traced polygon in Setup Mode):
  - `CODE-1 … CODE-n` — one per wall segment, numbered in polygon order.
  - `CODE-D` — one **diagonal** (corner 1 → corner 3) for rectangular / main rooms, to check if the room is square.
  - `CODE-H` — **ceiling height** (or "height" for outdoor spaces like a terrace).
- **Wall direction arrows:** Each wall shows a small arrow that marks its **start corner**. All "from start" offsets are measured from that corner, so there is no left/right ambiguity.
- **Outdoor spaces** (terrace, balcony) are drawn with a dashed outline and use the same workflow.

#### 2.5.2 Navigation & Progress *(prototype)*
- **Sticky header:** Project title (address · floor), counter `done / total`, green progress bar, and a sync status line.
- **Overview plan:** Small full-apartment plan where each room is colored by progress: **none** (grey), **partial** (orange), **complete** (green). Tap a room to scroll to its card (URL hash `#room-CODE` keeps the position on reload).
- **Room chips:** One chip per room with its count (e.g., `Cuisine 3/6`), same color states, as a fast jump list.

#### 2.5.3 Room Card & Tap-to-Measure *(prototype)*
- One card per room, in walking order, containing:
  - **Mini room drawing** with wall IDs written along each wall (rotated to the wall angle) and the dashed diagonal.
  - **Two-way link drawing ↔ input:** Tap a wall label to focus its input; focus an input to highlight that wall (orange) on the drawing.
  - When a value is entered, the label turns **green** and shows the value (`SE-2 · 412,5`).
  - **Grid of numeric inputs** (one per ID), labelled `SE-D · diagonal`, `SE-H · ceiling height`.
- **Input behavior:**
  - Unit is always `cm`; numeric keypad (`inputmode="decimal"`), comma or dot accepted as decimal separator (`412,5`).
  - Inline validation: a non-number shows a status message (`SE-2: type a number in cm, for example 412 or 412,5`) and is not saved.
  - **Enter / "Next" key jumps to the next measurement ID** in walking order, so the user can measure the whole apartment without touching the plan.
  - Empty field = not measured (value removed).
- **Free-text room notes** (radiators, pipes, electrical panel, etc.).

#### 2.5.4 Doors, Windows & Fixtures per Wall *(prototype)*
- **"+ Add item"** per room. Each item has: `type`, host `wall` (select `on SE-2`), dimension fields, and a short note (opening side, handle…).
- **Item types and fields:**

  | Type | Fields |
  |---|---|
  | Window | from start, width, height, sill height |
  | Door | from start, width, height |
  | Opening (no door) | from start, width, height |
  | Cupboard | from start, width, depth, height |
  | Radiator | from start, width, height |
  | Other | from start, width |

- **"From start"** = distance along the wall from the start corner (arrow) to the near edge of the item.
- **Live drawing on the mini plan** (once wall length, offset, and width are known): color-coded segments (window blue, door violet, radiator red, other grey), cupboard drawn as a rectangle with its depth (default 60 cm), door swing arc into the room, opening shown as a gap with end ticks.
- **Shared-wall propagation:** A door is entered once, in the room it opens into; it is drawn automatically (dashed) on the same wall segment in the adjacent room. Openings show in both rooms.
- **Safe delete:** Two-tap confirm ("Tap to confirm", resets after 3 s).

#### 2.5.5 Offline-First Saving & Multi-Device Sync *(prototype)*
- **Every keystroke saves locally first** (localStorage in prototype → IndexedDB in the app), then uploads after a short debounce (~0.7 s).
- **Dirty tracking:** Each change gets a sequence number and stays "dirty" until the server confirms that exact version. Dirty changes are never overwritten by incoming server updates.
- **Retry strategy:** 15 s timeout per write; retry 15 s after a failure, every 20 s while changes are pending, and also on `online`, on tab hide (`visibilitychange`), and on `pagehide`.
- **Live updates:** Changes from other devices (e.g., one person measures, another reads on desktop) appear in real time. Merge rule: **server wins, except local changes not yet uploaded**.
- **Clear status line:** `All saved online · 14:32` / `3 changes waiting to upload. They are safe on this phone…` / `Online saving is not available here.` (with last error).

#### 2.5.6 Mobile UX Details *(prototype)*
- Single narrow column (max 560 px), large touch targets (≥ 40 px), safe-area insets for notched phones, light and dark themes, tabular monospaced numbers.

#### 2.5.7 Extensions for the Full App *(new)*
- **Estimated vs. Verified status:** The traced plan gives an *estimated* value for each ID; an on-site entry marks it *verified* (green). This replaces the prototype's simple "filled / empty" state.
- **Discrepancy indicator:** `Plan: 340 cm | Real: 336 cm (-4 cm)`, with a highlight when the difference exceeds a threshold (e.g., 2 cm).
- **Squareness check:** Compare `CODE-D` with the diagonal computed from the measured walls; warn when the room is out of square.
- **Consistency checks:** Opposite walls of a rectangle should match; items must fit inside their wall (`offset + width ≤ wall length`).
- **Apply to plan:** In Setup Mode, one action re-solves the room polygon from verified lengths and locks those walls (see 5.4).
- **Custom point-to-point tape tool:** Tap two points to record ad-hoc measurements (wall-to-column clearance, etc.).
- **Survey export:** CSV / PDF list of all IDs with values, items, and notes for contractors.

---

## 3. Suggested Tech Stack

### 3.1 Frontend
- **Framework:** **React + TypeScript + Vite** (fast build, simple deployment to Cloudflare Pages).
- **2D Canvas Engine:** **SVG with custom pan/zoom** OR **Konva.js (`react-konva`)**
  - *Recommendation:* **SVG** for a single-apartment scale. It gives crisp vector rendering at any zoom, native DOM/pointer events on walls/handles, easy CSS styling for bearing vs. partition walls, and trivial SVG/PDF export. (Switch to `react-konva` only if rendering hundreds of complex objects causes lag.)
- **Geometry Math:** Lightweight helper library or custom 2D vector utils + `polygon-clipping` (for room cutting/splitting/boolean subtraction).
- **State Management:** **Zustand** + `zundo` (for instant Undo/Redo in Edit Mode).
- **UI & Styling:** **Tailwind CSS** + **Lucide Icons** (clean floating toolbars on desktop, bottom-sheet controls on mobile).

### 3.2 Backend & Database (Cloudflare Stack)
- **Hosting:** **Cloudflare Pages** (serves the React SPA + API routes via Pages Functions).
- **API:** **Hono** running on Cloudflare Workers / Pages Functions (lightweight, type-safe, great D1 ergonomics).
- **Database:** **Cloudflare D1** (SQLite).
  - *Schema approach:* Keep it simple with a hybrid model:
    - `projects` (`id`, `name`, `scale_px_per_m`, `bg_image_key`, `bg_opacity`, `bg_transform_json`, `updated_at`)
    - `floorplan_snapshots` (`id`, `project_id`, `data_json`, `version`, `created_at`) — stores rooms, walls, openings, and storage as structured JSON for fast full-state load/save and easy undo/versioning.
    - `measurements` (`id`, `project_id`, `target_id`, `label`, `planned_cm`, `actual_cm`, `verified`, `note`, `updated_at`) — makes mobile measurement updates atomic and fast without rewriting the whole plan. `label` holds the survey ID (`SE-2`, `SE-D`, `SE-H`); `target_id` links to the wall / room in the snapshot.
    - `survey_items` (`id`, `project_id`, `room_code`, `wall_label`, `type`, `offset_cm`, `width_cm`, `height_cm`, `sill_cm`, `depth_cm`, `note`, `created_at`, `updated_at`) — doors, windows, openings, cupboards, radiators recorded on site (prototype `items` collection).
    - `room_notes` (`project_id`, `room_code`, `text`, `updated_at`) — free-text notes per room.
    - One row per value (not one big JSON) so two devices can edit different values at the same time without conflicts, like the prototype.
- **Image Storage:** **Cloudflare R2** (free tier is generous) to store imported background images so a plan started on desktop loads immediately on your phone.
- **Auth (Simple):** Passcode / magic-link or Cloudflare Access so your personal apartment data stays private without heavy auth boilerplate.

---

## 4. Architecture & Data Model (High-Level)

```text
[ Desktop / Phone Browser ]
  ├── React + Vite + Tailwind + SVG Canvas
  ├── Zustand Store (local state + Undo/Redo)
  └── IndexedDB Cache (offline resilience)
          │
          ▼  (HTTPS / JSON)
[ Cloudflare Pages Functions (Hono) ]
  ├── /api/projects/:id        -> Read/Save plan snapshot
  ├── /api/measurements        -> Patch / delete individual on-site measurements
  ├── /api/survey-items        -> Create / update / delete doors, windows, fixtures
  ├── /api/room-notes          -> Save room notes
  ├── /api/changes?since=      -> Poll (or SSE/WebSocket) for live updates from other devices
  └── /api/images              -> Upload/fetch background blueprint (R2)
          │
          ▼
[ Cloudflare D1 (SQLite) ] + [ Cloudflare R2 ]
```

---

## 5. Additional Suggestions & Ideas

### Practical / High-Value Additions
1. **Offline-First / PWA Support:** Apartments under renovation often have poor cellular reception. Cache the active project and background image in **IndexedDB** via a Service Worker, and sync queued measurements to D1 once back online. Reuse the prototype's dirty-tracking and merge logic (section 2.5.5).
2. **Ceiling Height & Wall Surface Calculator:** Store a per-room ceiling height so the app automatically calculates wall surface area (`m²`) minus doors/windows—super useful for ordering paint, primer, or wallpaper.
3. **Photo & Note Pins in Measuring Mode:** Tap any wall or corner on your phone to attach a quick note or photo (e.g., *"radiator pipes here"*, *"electrical panel 140 cm from floor"*).
4. **Lock Verified Dimensions:** Once a wall is marked `Verified` in Measuring Mode, allow locking its length so future room edits don't accidentally shift known measurements.
5. **Layer Toggles:** Quick checkboxes for `Background Image`, `Dimensions`, `Bearing Walls Highlight`, `Openings`, and `Notes`.
6. **Clean Export:** Export to **PNG / SVG / PDF** (with a clean legend and scale bar) to share with contractors, architects, or kitchen planners.

### Future Feature Ideas (Post-Draft)
- **Furniture & Appliance Library:** Drag-and-drop standard beds, sofas, tables, kitchen modules (`60 cm` depth) with door-swing collision warnings.
- **Electrical & Plumbing Layer:** Place outlets, switches, ceiling lights, water supply/drainage points.
- **Material & Cost Estimator:** Flooring `m²` (+10% waste margin), baseboard linear meters (auto-subtracting door widths!).
- **Multi-Floor / Version Comparison:** Compare "Current Layout" vs. "Renovation Option A / B" (especially for knocking down non-bearing partition walls).

---

## 6. Suggested Build Phases

1. **Phase 1 — Canvas & Tracing:** Vite + React + SVG viewport (pan/zoom), background image upload, 2-point scale calibration, rectangle & polygon room drawing, vertex dragging.
2. **Phase 2 — Walls, Cuts & Openings:** Room slice/cutout tools, bearing vs. partition wall styling, snapping doors/windows/storage to walls with numeric dimension inputs.
3. **Phase 3 — Persistence (D1 + R2):** Hono API + Cloudflare D1 schema + R2 image upload so plans sync seamlessly between desktop and phone.
4. **Phase 4 — Mobile Measuring Mode:** Port the prototype: room codes and auto-generated IDs from traced polygons, overview + chips progress, room cards with linked drawing/inputs, Enter-to-next flow, per-wall items with live drawing and shared-wall doors, room notes, offline-first dirty queue with live sync. Then add the *(new)* extensions: verified/estimated badges, discrepancy view, squareness and consistency checks, apply-to-plan.
5. **Phase 5 — Polish & Exports:** PDF/SVG export, note/photo pins, paint & flooring calculators.

---

## 7. Review & Inspiration (2026-11-21)

### 7.1 Inspiration

- **magicplan:** Universal Bluetooth laser meter pairing (PrecisionLink) fills the selected wall field immediately. Borrow the "select wall, shoot laser, auto-advance" loop and clean per-room estimate exports.
- **Bosch MeasureOn:** Infinite workspace, wall-elevation views for windows/doors, and direct photo-to-dimension overlays ("sketch on photo"). Borrow wall-elevation snippets and dimensions drawn on site photos.
- **Leica DISTO Plan:** *Sketch Plan* (draw a rough shape, then assign real lengths to auto-scale) and *Smart Room* (walk clockwise to build a room). Borrow rough-trace-then-solve scaling and clockwise room capture.
- **Floorplanner:** Fast orthogonal wall snapping, automatic room fill on close, and click-to-type exact wall lengths on the canvas. Borrow inline click-to-edit wall length labels.
- **RoomSketcher:** Automatic interior/exterior dimension strings, inner-vs-outer wall measurement toggle, and polished client-ready 2D PDF exports. Borrow clean exterior/interior dimension layers and export presets.
- **Planner 5D:** Friendly room templates and quick drag-and-drop placement with immediate visual feedback. Borrow starter room templates for users who do not have a blueprint to trace.
- **Sweet Home 3D:** Strict blueprint scaling, locked background image calibration, and predictable constraint updates when you edit a wall length numerically. Borrow manual point-to-point dimension lines and reliable numeric wall edits.
- **SketchUp / LayOut 2D:** Mnemonic single-key shortcuts (`Space`, `L`, `R`), strict axis/endpoint/midpoint inference locking, and scale-accurate 2D sheets. Borrow midpoint snapping and print-ready scale bars.
- **Homestyler:** Clear docked inspector panels and structured fixture/appliance catalogs. Borrow consistent inspector grouping and standard kitchen/appliance footprint presets.
- **CubiCasa:** Snapshot reports that pin site photos directly to locations on the 2D floorplan, plus Gross Living Area (GLA) summaries. Borrow photo pins anchored to walls/corners and summary area tables.
- **Canvas (Occipital):** Remodeler-focused export directly into trade CAD formats (DXF/DWG/PDF). Borrow clean layered SVG/DXF export for kitchen planners and contractors.
- **Polycam:** Instant browser-based share links that contractors can open without an account, plus on-site dimension review before leaving. Borrow zero-login read-only share links and an on-site "review missing values" checklist.
- **Moasure:** Single-person capture of irregular shapes, curves, and outdoor spaces with direct CSV/DXF/PDF sharing to field crews. Borrow simple CSV/PDF field reports for irregular rooms and terraces.
- **Archisketch:** Clean presentation aesthetics and fast mobile sketch-plus-laser workflow. Borrow lightweight presentation mode (hide edit chrome for client/contractor review).
- **Excalidraw:** Floating minimal toolbar, subtle dot/grid canvas background, helpful empty-state hints, and a `?` keyboard shortcut modal. Borrow the empty-state guide, subtle grid, and shortcut sheet.
- **Figma / tldraw:** Smart alignment guides, bottom zoom/fit controls (`0` to fit, `+`/`-`), and context-aware right sidebar that stays out of the way. Borrow the zoom/fit pill, live tool hint bar, and collapsible inspector.

### 7.2 Usability Fixes

#### P0 (Critical — fix first)
1. **Remove or implement the dead Tape tool (`src/App.tsx`):** `tape` (`T`) is in the toolbar, but `ToolOverlay()` returns `null`. Test: click Tape or press `T`; either draw a point-to-point measurement or hide the button until implemented.
2. **Add Edit Mode empty state and editable project title (`src/App.tsx`, `src/canvas/Viewport.tsx`):** New projects open to a blank canvas and a read-only `<h1>` title. Add a subtle grid, a centered onboarding card ("Import a plan image", "Draw a rectangle room", or "Load demo"), and an inline-editable title. Test: open a fresh project, rename it, and start from the prompt.
3. **Add Zoom controls, Fit-to-Plan, and a scale bar (`src/canvas/Viewport.tsx`):** Users can pan/zoom off-screen with no recovery. Add a bottom-left floating bar (`-`, `100%`, `+`, `Fit` / key `0`) and a dynamic metric scale bar. Test: pan far away, click `Fit`, and verify all rooms center in view.
4. **Fix off-screen Calibration prompts (`src/features/background/index.tsx`):** Instructions render in world SVG coordinates near `(0, 0)` and vanish when panned. Move them to a fixed screen-space banner. Test: pan 2000 cm away, activate Calibrate, and confirm the prompt stays visible.
5. **Enlarge touch targets on `MiniDrawing` labels (`src/features/measure/MiniDrawing.tsx`):** Only the 12 px `<text>` receives clicks. Add transparent hit rects (at least 40×40 px equivalent) and clickable wall hit lines with `role="button"` and `tabIndex={0}`. Test: tap near any wall ID on a 375 px viewport and verify the matching input focuses.
6. **Prevent silent `localStorage` quota failure (`src/model/store.ts`, `src/features/background/index.tsx`):** Full base64 background images are saved in `localStorage` on every change and can exceed the 5 MB limit silently. Store background blobs in IndexedDB (not `localStorage`) and show a warning banner if local persistence fails. Test: import a 4 MB image, draw a room, reload, and verify both persist.
7. **Show Undo/Redo disabled states (`src/App.tsx`):** Subscribe to `useDoc.temporal` to disable Undo/Redo buttons when `pastStates`/`futureStates` are empty and add `aria-label` attributes. Test: open a fresh doc and verify both buttons are disabled until an edit occurs.
8. **Add safe-area insets and remove duplicate Measuring Mode header (`src/App.tsx`, `src/features/measure/index.tsx`, `src/index.css`):** Measuring Mode renders a second sticky header under the app header, repeating title and sync status and consuming ~110 px on phones. Merge them into one compact sticky header with `env(safe-area-inset-top/bottom)` padding. Test: open Measuring Mode on a 375×667 viewport and confirm one header with progress bar and mode switch.

#### P1 (High-impact friction)
9. **Add a bottom tool-hint bar (`src/App.tsx`, `src/features/rooms/tools.tsx`):** Surface hidden gestures: double-click wall to add vertex, `Shift` in Cutout for polygon mode, `Enter`/`Backspace` in Polygon, `Alt` to bypass snap, `B` for bearing wall. Test: switch tools and verify the hint updates for each tool.
10. **Expose Snap settings in the UI (`src/App.tsx` or `RoomsPanel.tsx`):** `ui.snap` (`grid`, `gridCm`, `angles`, `vertices`) has no UI controls. Add a compact Snap popover (toggle grid/angles/vertices, choose 1/5/10 cm step). Test: change grid step to 10 cm and verify vertex drags snap to 10 cm.
11. **Make the right sidebar collapsible / drawer on narrow viewports (`src/App.tsx`):** Fixed `w-72` sidebar crushes the canvas on tablets and phones in Edit Mode. Add a collapse toggle and render as an overlay drawer below `md` (`768px`). Test: resize to 640 px in Edit Mode and verify the canvas remains usable.
12. **Allow full 360° or ±180° background rotation + 90° rotate buttons (`src/features/background/index.tsx`):** Rotation is currently clamped to `-10°..+10°`, so sideways phone photos cannot be oriented. Add `-90°` / `+90°` buttons and allow fine adjustment around any orientation; also accept comma decimals in calibration input. Test: rotate an image 90° and calibrate with `4,25` m.
13. **Fix `Escape` tool conflict (`src/App.tsx`, `src/features/rooms/tools.tsx`, `src/features/background/index.tsx`):** Pressing `Escape` while placing polygon/slice/calibrate points cancels the points and also switches to `select`. Let the active tool consume `Escape` first to cancel in-progress points; a second `Escape` returns to `select`. Test: place 2 polygon points, press `Escape` once, verify tool stays `polygon` with 0 points.
14. **Add drag threshold on elements and unify `ElementsPanel` styling (`src/features/elements/index.tsx`):** Add a 4 px drag threshold (matching `rooms/interaction.ts`) so selecting an element does not accidentally nudge it. Wrap `ElementsPanel` in the same card border/padding and orange/slate palette as other panels. Test: click an element with 2 px pointer jitter and verify `offsetCm` does not change.
15. **Add Undo toast or two-tap confirm for destructive Edit actions (`src/features/rooms/RoomsPanel.tsx`, `src/features/background/index.tsx`, `src/features/elements/index.tsx`):** Deleting a room, element, or background image happens immediately with no feedback. Show a 5 s toast ("Room deleted · Undo") or use two-tap confirm. Test: delete a room, click Undo in the toast, and verify full restoration.
16. **Fix `SyncBadge` passcode UX (`src/App.tsx`):** Add a visible Submit button next to the passcode input and show an inline error when a passcode is rejected (`401`). Test: submit a wrong passcode and confirm clear error feedback.
17. **Add overflow warning and focus-on-add in Measuring Mode `ItemsEditor` (`src/features/measure/ItemsEditor.tsx`):** Show a warning when `offsetCm + widthCm` exceeds the wall length (using measured length if available, else planned). Auto-focus the new item's first numeric field when tapping `+ Add item`. Test: enter an item wider than the wall and verify the warning appears.
18. **Add "Next unmeasured" jump button in Measuring Mode (`src/features/measure/index.tsx`):** Let users jump straight to the next empty measurement ID across all rooms without scrolling. Test: leave 2 fields empty across 5 rooms, tap "Next unmeasured", and verify focus moves to the first empty field.
19. **Hide or wire the unused `Notes` layer toggle (`src/App.tsx`):** Toggling `Notes` in Layers currently does nothing. Hide it until canvas note pins exist, or render room note badges on the canvas when enabled. Test: toggle every checkbox in Layers and confirm each produces a visible change.

#### P2 (Polish & accessibility)
20. **Add `aria-label` and `aria-pressed` to all icon buttons (`src/App.tsx`, `RoomsPanel.tsx`, `BackgroundPanel`):** Screen readers and keyboard users need accessible names and active states on toolbar and icon buttons. Test: audit with keyboard Tab and accessibility tree; zero unlabeled buttons.
21. **Show locked-wall affordance on canvas (`src/features/rooms/RoomsLayer.tsx`, `interaction.ts`):** Display a small lock badge on locked walls and show `cursor: not-allowed` (or a brief hint) when a user tries to drag a locked wall or adjacent vertex. Test: lock a wall, hover/drag it, and confirm visual feedback.
22. **Show live lengths for attached walls during vertex drag (`src/features/rooms/RoomsLayer.tsx`):** Always display the dimension labels of walls connected to the currently dragged vertex, even when shorter than 55 px on screen. Test: zoom out and drag a vertex; verify its two wall lengths stay readable.
23. **Add a `?` keyboard shortcuts dialog (`src/App.tsx`):** Show all tool, edit, and navigation shortcuts in a clean modal triggered by `?` or a header icon. Test: press `?` outside inputs and verify the modal opens and closes with `Escape`.
24. **Add a Light / Dark / System theme toggle (`src/App.tsx`, `src/index.css`):** Allow forcing high-contrast Light mode on bright job sites even when the phone OS uses Dark mode. Test: toggle theme and verify persistence across reload.
25. **Add keyboard focus support to `Overview` SVG rooms (`src/features/measure/Overview.tsx`):** Add `role="button"`, `tabIndex={0}`, and `Enter`/`Space` handling on room `<g>` elements (or mark the SVG decorative since room chips below already provide keyboard navigation). Test: navigate Measuring Mode with keyboard only.

### 7.3 Missing Necessary Features

- **Project management & local backup (JSON export/import):** Rename project, switch between multiple projects/versions, and export/import a `.json` backup file so renovation data is never trapped in one browser.
- **Contractor-ready export (PDF / SVG / PNG + CSV survey table):** Clean 2D plan export with scale bar, legend (bearing vs. partition walls), room areas, verified dimensions, and a CSV/PDF list of all survey IDs, openings, and notes.
- **Working Point-to-Point Tape Tool:** Record ad-hoc clearances (wall-to-column, radiator-to-door, ceiling-to-beam) in Edit Mode and verify them in Measuring Mode.
- **Apply-to-Plan from Verified Measurements:** One-click (with preview) to re-solve room polygons from verified wall lengths and lock those walls, closing the loop between Setup Mode and Measuring Mode.
- **Photo & Note Pins:** Attach phone photos and short notes directly to a wall or corner so contractors see pipes, electrical panels, and window frames in context.
- **Material & Surface Calculator:** Automatic floor area (`m²` + waste margin), wall surface area minus openings (for paint/wallpaper), and baseboard linear meters minus door widths.
- **True PWA / Offline Caching:** Web app manifest + Service Worker to cache the app shell and IndexedDB-backed background images so Measuring Mode works reliably in basements or apartments with zero signal.

### 7.4 Clever Features

| Feature | Description | Effort |
|---|---|---|
| **Bluetooth Laser Meter Input (Web Bluetooth + HID)** — *low priority (the owner's meter has no Bluetooth)* | Pair Bosch GLM or Leica DISTO meters via Web Bluetooth GATT (or HID keyboard mode) so pressing Measure fills the focused field and jumps to the next ID. | **M** |
| **Voice Measurement Entry** | Hands-free Web Speech API button in Measuring Mode: speak *"342 comma 5"* while holding a tape measure to fill the active field and advance automatically. | **S** |
| **Auto-Straighten Background Plan** | Click two points along a wall that should be horizontal or vertical; compute the exact angle and deskew the background photo in one step. | **S** |
| **Wake Lock + Sunlight Mode** | Use the Screen Wake Lock API and a high-contrast light theme toggle in Measuring Mode so the phone screen stays readable and awake on site. | **S** |
| **Door-Swing & Clearance Collision Check** | Highlight overlapping door arcs, radiators, and cupboards in real time so layout clashes are caught before buying fixtures. | **S** |
| **Read-Only Contractor Share Link** | Generate a tokenized read-only URL showing verified dimensions, opening specs, room notes, and PDF/CSV downloads without requiring login. | **M** |
| **Sketch-on-Photo Dimension Overlays** | Snap a site photo, draw arrows between two points, and attach measured `cm` values or link an existing survey ID directly onto the image. | **M** |
| **Photo-to-Value OCR of Laser/Tape Readings** | Point the phone camera at a laser meter screen (or tape mark) to read the digits with lightweight OCR when the laser lacks Bluetooth. | **M** |
| **Before / After Renovation Diff** | Tag non-bearing partitions as "demolish" or "new" and toggle an overlay that recalculates room areas and highlights structural changes. | **M** |
| **Clockwise Smart-Room Auto-Build** | Walk a room clockwise entering wall lengths (via laser or voice) and 90°/left/right turns to generate and auto-close the room polygon automatically. | **L** |
