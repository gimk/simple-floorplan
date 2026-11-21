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
