# Phase 5 Extension Points: Finishes and 3D Doll-House View

This document describes how to add floor/wall finishes and a simple 3D view to Simple Floorplan 2. It is a design note. No code in this document exists yet.

Source of truth: `src/model/types.ts`, `src/model/schema.ts`, `src/features/furniture/presets.ts`. Current `schemaVersion` is **3**. Units: cm and degrees. 2D walls have zero thickness.

---

## 1. Schema readiness (schemaVersion 3)

All fields that 3D needs are already in the schema. No migration is needed to start 3D.

| Field | Type | Default when omitted | Notes |
|---|---|---|---|
| `Artboard.ceilingHeightCm` | `number > 0` | **250** (Zod `.default(250)`, `createArtboard`) | Always present after parse. |
| `Room.fill` | `string?` | none (canvas look) | CSS color. Swatches are in `FLOOR_SWATCHES`. |
| `Opening.heightCm` | `number > 0 ?` | by `kind`: door **205**, window **120**, opening **210** | Not filled by Zod. The reader applies the default. |
| `Opening.sillCm` | `number >= 0 ?` | by `kind`: door **0**, window **90**, opening **0** | Same rule. |
| `Opening.variant` | `string?` | none = plain/default style | Free string. Reserved for door/window variants (section 4). |
| `FurnitureItem.heightCm` | `number > 0 ?` | **80** | Presets set their own value (for example bed 50, wardrobe 200, rug 1). |

Rule: put the defaults in one pure helper (for example `src/model/defaults.ts`). Do not copy them into the 2D code and the 3D code.

```ts
export const openingHeightCm = (o: Opening) => o.heightCm ?? { door: 205, window: 120, opening: 210 }[o.kind]
export const openingSillCm   = (o: Opening) => o.sillCm   ?? { door: 0,   window: 90,  opening: 0   }[o.kind]
export const furnitureHeightCm = (f: FurnitureItem) => f.heightCm ?? 80
```

Also make sure a window cannot go over the ceiling: clamp `sill + height <= ceilingHeightCm` when you read.

---

## 2. Future Floor and Wall Finishes

Principle: add **optional** fields only. Old files stay valid. Do not bump `schemaVersion` for additive optional fields. Zod object schemas strip unknown keys, so add each new key to `roomSchema` in the same change.

### 2.1 Floor: `Room.fill` evolves to `Room.floorFinish`

```ts
export type FloorFinish = {
  kind: 'color' | 'material'
  value: string        // kind 'color': CSS color. kind 'material': material id, e.g. 'oak-herringbone'
  tileCm?: number      // repeat size of one texture tile, in cm (default 60)
}
export type RoomShape = { /* existing */ fill?: string; floorFinish?: FloorFinish }
```

Read rule (one helper, used by 2D and 3D):

```ts
export function resolveFloor(r: Room): FloorFinish | undefined {
  return r.floorFinish ?? (r.fill ? { kind: 'color', value: r.fill } : undefined)
}
```

Backward compatibility:
- Old files only have `fill`. They still render, with no conversion.
- New writes: the Design-mode picker writes `floorFinish`. For a plain color it also keeps `fill` the same, so an older build still shows the color. Stop this double write when the old builds are gone.
- `kind: 'material'` has no meaning for an old build. It shows `fill` (if set) or nothing. This is safe.
- Materials live in a static registry (like `FLOOR_SWATCHES` in `presets.ts`): `{ id, label, color, textureUrl? }`. `color` is the 2D fallback and the average color. 2D keeps drawing a flat color at about 0.28 opacity. Only 3D (and optional 2D `<pattern>`) uses `textureUrl` with `tileCm`.
- Texture UV in 3D: use artboard-local cm divided by `tileCm`. Then the pattern is continuous across rooms that touch.

### 2.2 Wall paint without a wall graph

Rooms stay independent polygons. Do not add shared wall objects. Key the paint to a room edge, because `Selection` already has `{ kind: 'wall', roomId, edgeIndex }`.

```ts
export type RoomShape = { /* existing */
  wallColor?: string                       // default paint for all edges of this room
  wallColors?: Record<number, string>      // edgeIndex -> color (accent walls). JSON key is a string.
}
```

Edge `i` runs from `vertices[i]` to `vertices[(i + 1) % n]`.

Resolve rule: `wallColors?.[i] ?? wallColor ?? DEFAULT_WALL` (default: light neutral, for example `#d9d6d0`).

Why this is simple and safe:
- The paint belongs to the **inside face** of the room that owns the edge. Two touching rooms keep two separate paints. This is correct for a doll-house (each room has its own side).
- No topology is needed. If an edge index changes, apply these rules in the room edit operations (vertex insert, delete, cutout, merge):
  - vertex insert at edge `i`: copy `wallColors[i]` to `i` and `i+1`, shift higher keys by 1.
  - vertex delete: drop the removed edge key and shift higher keys.
  - cutout/merge create new polygons: drop `wallColors` (keep `wallColor`). Accept this loss. It is the cheap choice.
- Segment-level paint (half of a wall) is **not** planned. If it is needed later, use a `{ edge, fromCm, toCm, color }[]` list. Do not do this now.
- Zod: `z.record(z.string(), z.string()).optional()` for `wallColors`. Parse the keys with `Number()` when you read them.

UI: in Design mode, a selected wall (Inspect panel) gets a color field. A selected room gets "all walls" color. 2D does not draw wall paint (1px line stays). Optional: a small color tick on the inside of the edge.

---

## 3. Future 3D Doll-House View

The view is **read-only**. All edits stay in 2D. 3D reads the active artboard and rebuilds geometry when the artboard changes.

### 3.1 Coordinate mapping

2D artboard-local cm (x right, y **down**) → 3D right-handed (X right, Y **up**, Z toward the viewer):

```
X = xCm
Y = height above floor (cm)
Z = yCm
```

- Seen from above (+Y looking down), X is right and Z is down. This is the same picture as the plan. No mirror.
- Scale: keep cm as the 3D unit, or multiply by 0.01 for meters. Choose one at the scene root (`scale.setScalar(0.01)`). Do not mix.
- Artboard origin: use artboard-local coordinates. Do **not** add `Artboard.xCm/yCm` (those are canvas positions). Center the camera on the bounds of all rooms.
- Rotation: plan `rotationDeg` is clockwise on screen (y-down). A positive rotation about +Y in a right-handed system looks counter-clockwise from above. So use **`rotation.y = -deg * Math.PI / 180`** (the same for `angleDeg`).
- Winding: a plan polygon can be clockwise or counter-clockwise (y-down flips the sign). Compute the signed area once. Reverse the vertex order if needed so that floor normals point +Y and wall normals point to the room inside.

### 3.2 Floor and walls

Floor: triangulate `room.vertices` (for example `THREE.ShapeGeometry` with `Shape` from `(x, y)`; then rotate it to the XZ plane, or build with `(x, 0, y)` directly). Material from `resolveFloor(room)`.

Walls: for each edge `i` from `A = v[i]` to `B = v[i+1]`:
- Height: `y = 0` to `y = artboard.ceilingHeightCm` (default 250).
- Thickness: **visual only**, 6–10 cm (start with 8). Offset the wall quad **inward** (toward the room) by `t`, by the edge normal. Build a thin box (outer face on the plan line, inner face offset). Inward offset keeps the room outline exact, so the 2D numbers stay true.
  - Option: center the thickness on the line (`±t/2`). This is simpler, but walls of touching rooms then overlap. Prefer inward.
- At corners, extend each wall box by `t` at the ends, or use a mitered corner. Small gaps are acceptable for a first version.
- 2D does not change: 1px line, zero thickness.
- Color: `wallColors?.[i] ?? wallColor ?? DEFAULT_WALL`.
- Doll-house cut-away: render back-face culling on the walls, so a wall seen from the outside (camera side) disappears. Or let the user choose "low walls" (for example 100 cm) as a view toggle. Do not store it in the document.

### 3.3 Opening cut-outs

Each `Opening` stores a world position, not an edge index. So match it to a host wall in 3D:

1. For each room edge, project the opening center `(xCm, yCm)` on segment `AB`. Get distance `d` and parameter `s` in `[0, 1]`.
2. Choose the edge with the smallest `d`. Accept if `d <= ~5 cm`. Several rooms can match (touching rooms): cut **every** matching edge.
3. Opening center along the edge: `u = s * |AB|`. Interval: `[u - widthCm/2, u + widthCm/2]`, clamped to `[0, |AB|]`.
4. Vertical interval: `y0 = openingSillCm(o)`, `y1 = y0 + openingHeightCm(o)` (clamped to ceiling).
5. Build the wall as pieces (no CSG library is needed): for a wall of length `L` and height `H`:
   - left piece `[0, u0] × [0, H]`, right piece `[u1, L] × [0, H]`,
   - below piece `[u0, u1] × [0, y0]` (only if `y0 > 0`; windows),
   - above piece `[u0, u1] × [y1, H]` (only if `y1 < H`).
   For many openings on one edge: sort by `u0` and sweep. Skip overlapping intervals.
6. Defaults:

| `kind` | `sillCm` | `heightCm` | Visible result |
|---|---|---|---|
| `door` | 0 | 205 | Full-height gap to floor, lintel above. |
| `window` | 90 | 120 | Gap with wall below and above. Add a glass pane (transparent, `opacity ~0.25`). |
| `opening` | 0 | 210 | Like a door, no leaf. |

7. Door leaf, swing (`hinge`, `swing`): not drawn in v1 of the 3D view. The gap is enough. Variants add leaves later (section 4).

### 3.4 Furniture solids

For each `FurnitureItem`:
- Center: `(xCm, heightCm/2, yCm)` where height is `furnitureHeightCm(f)`. Base on the floor (`y = 0`).
- `shape: 'rect'` → `BoxGeometry(widthCm, h, depthCm)`. `widthCm` is along local X, `depthCm` along local Z (same as the 2D rule in `presets.ts`).
- `shape: 'circle'` → `CylinderGeometry(r, r, h, 32)` with `r = widthCm / 2`. (`depthCm` equals `widthCm` for a circle.) Use `widthCm` for `r` and ignore `depthCm` when they differ.
- Rotation: `rotation.y = -rotationDeg * Math.PI / 180`.
- Color: `item.color` (`MeshStandardMaterial`). Optional small darker edge lines (`EdgesGeometry`) so shapes read well.
- Thin items (rug, `heightCm: 1`): draw as a flat slab above the floor. Raise it by 0.5 cm to avoid z-fighting.
- Furniture is a plain solid. No model files in this phase.

### 3.5 UI integration path

- Add a third mode next to the existing switch: `Plan | Design | 3D`. The 3D mode is read-only: it hides the tool and object panels. The Inspect panel can show the artboard (ceiling height).
- **Lazy load**. Do not import the 3D library at the top level. Use `React.lazy(() => import('./features/view3d/View3D'))` inside `<Suspense>`. Vite then makes a separate chunk that loads only when the user opens 3D. The 2D bundle size does not change.
- Library: `three` directly, or `@react-three/fiber` + `@react-three/drei` (`OrbitControls`). R3F is shorter to write. Both go in the lazy chunk only. Pin exact versions.
- Suggested files (all new):
  - `src/features/view3d/View3D.tsx` – canvas, lights, `OrbitControls`.
  - `src/features/view3d/buildScene.ts` – pure functions: artboard → mesh data (floor, wall pieces, furniture). No React. Test this with Vitest.
  - `src/model/defaults.ts` – default heights (section 1).
- Camera: perspective, 45° elevation, target = bounds center, distance from bounds size. Orbit and zoom only. No selection and no editing in v1.
- Lights: one ambient + one directional. No shadows in v1 (cost).
- Data: read the active artboard from the store. Rebuild geometry with `useMemo` on the artboard object. Dispose geometry and materials on unmount.
- Verify: unit tests for (a) the mapping `(xCm, yCm) → (X, Z)`, (b) the wall piece split with a window and a door, (c) default heights. Visual check with a Chrome test.

---

## 4. Door and Window Variants roadmap (`Opening.variant`)

`variant` is a free `string`. A missing value = the standard hinged door, the standard fixed/casement window. Unknown values must fall back to the default symbol (do not fail a parse). Suggested ids:

| Variant id | `kind` | 2D symbol (1px) | Inspect options | 3D effect | Notes |
|---|---|---|---|---|---|
| `pocket-sliding` | `door` | Gap in wall + thin dashed rectangle inside the wall line, along the wall, showing where the leaf slides. No swing arc. | Slide side (`hinge`: left/right). | Gap as normal. Optional leaf box beside the gap. | Needs free wall length of about `widthCm` beside the opening. Show a warning if there is no space. |
| `bypass-sliding` | `door` | Two overlapping thin rectangles on the wall line (offset). No arc. | Which panel is in front (`swing`: in/out). | Two thin panels, each half the width, in front of each other. | Width is usually 2 panels; each panel is about `widthCm / 2`. |
| `french` | `door` | Two leaves, two quarter-circle arcs, each of radius `widthCm / 2`. | Swing (`in`/`out`). `hinge` has no effect. | Gap as normal. Optional two thin leaves. | Arc clearance is half-width, not full width. |
| `sliding-window` | `window` | Window symbol (double line) + short arrow or offset second line to show the slide. | Slide side (`hinge`). | Glass pane in the gap with a mid-bar. | Same `sillCm` / `heightCm` defaults as a window. |

Implementation rules:
- A small registry maps `variant` → `{ draw2D, defaults, inspectFields }`. Look up with `registry[o.variant ?? 'default']`.
- Reuse `hinge` and `swing` for side options. Do not add new fields until a variant really needs one.
- Add the id to a Zod `z.enum` **only** if you want strict files. Keep `z.string()` for forward compatibility.
- Variants can change default `heightCm` (for example sliding door: 210). Put this in the registry `defaults`, below the explicit `heightCm` and above the `kind` default.

---

## 5. Suggested order of work

1. `src/model/defaults.ts` with the helpers in section 1 (+ tests).
2. `floorFinish` and `resolveFloor` (+ Zod, + swatch registry change).
3. `wallColor` / `wallColors` (+ edge index fix-up in vertex insert/delete).
4. `buildScene.ts` (pure, tested), then the lazy `View3D` and the `3D` toggle.
5. Variants, one at a time (2D symbol first, 3D after).

Each step is additive and keeps `schemaVersion: 3`.
