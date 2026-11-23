# Walls as data, rooms as the survey view

Follows `docs/sidebar-plan-3.md` (Solve tab done). Agreed 2026-11-23.

## Problems today
1. **A wall between two rooms exists two times.** Each room is a polygon with its own wall props
   (`room.walls`, keyed by start vertex). The global solver (`src/features/rooms/globalSolve.ts`)
   must guess which room walls are one wall (`pairTolCm` = 35 cm, `MIN_OVERLAP` = 20 cm). When the
   guess fails, walls overlap, rooms leave thin gaps, or two copies get different thicknesses.
2. **Measurements point to a vertex index.** `SE-2` = wall 2 of room SE. When a wall is split or a
   vertex is added, the index changes and the value can move to another wall.
3. **One value per room wall.** A wall has two faces, a centre line and a thickness. Today only the
   inside face of each room and the thickness (`CODE-n-T`) can hold a value.
4. **The solver does not use the surface references** (DPE, Carrez...) of `apartment.references`.
5. **Doors and windows belong to one room wall** (`roomId` + `wallStart`), so a door between two
   rooms is seen from one room only.

## Decisions
- **Walls are the stored data, rooms are the survey view.** The room stays the unit you measure
  (codes `SE`, `SE-2`, walk order). The wall is the unit you store (one time).
- **Labels stay for the user.** `SE-2` is a display label. The data points to a stable target.
- **Change step by step.** First the wall graph is DERIVED from the rooms (no doc change). Then the
  solver and the measurements use it. Only then is it STORED, with a transition layer that keeps
  `room.vertices` for the features that are not migrated yet.

## Target model

```ts
type Node = { id: string; x: number; y: number }            // centre-line junction, cm
type Wall = {
  id: string; a: string; b: string                          // node ids
  type: WallType; thicknessCm: number
  locked?: boolean; status?: WallStatus; align?: WallAlign
}
/** One side of one wall, seen from one room (or from outside). */
type Face = { wallId: string; side: 'L' | 'R'; roomId?: string }   // L = left of a -> b
type Room = { id; code; name; walkOrder; ceilingCm?; outdoor?; diagonal?
              faces: Face[]       // closed cycle, in order
              holes: ... }
```

- A room is a closed cycle of faces. Its polygon (centre and inside) is CALCULATED.
- One side of a wall can have more than one face (T-junction: two rooms on one side).
- A face with no `roomId` is outside (facade).

### Measurements: several values per wall

```
        room SE (side L)
   ┌─────────────────────────┐   face L : SE-2   = 412 cm
   ╞═════════ wall W12 ══════╡   centre : W12-C  = 424 cm   thickness : W12-T = 12 cm
   └────────────┬────────────┘
     room SB    │   room C1     face R : SB-1 = 236 cm, C1-3 = 168 cm
```

| Target | Label | Meaning |
|---|---|---|
| Face (room side) | `SE-2` | Inside length seen from the room. One per room on that side. |
| Face (outside) | `EXT-4` | Facade length. |
| Centre | `W12-C` | Node to node. Usually from an architect plan, not from site. |
| Thickness | `W12-T` | Belongs to the wall (today `CODE-n-T`). |
| Diagonal | `SE-D` | Between two inside corners of a room. |

```ts
type MeasureTarget =
  | { kind: 'face'; wallId: string; side: 'L' | 'R'; roomId?: string }
  | { kind: 'centre'; wallId: string }
  | { kind: 'thickness'; wallId: string }
  | { kind: 'diagonal'; roomId: string; a: string; b: string }   // node ids
type MeasureSource = 'tape' | 'laser' | 'plan' | 'other'
type Measurement = { label: string; actualCm: number; updatedAt: string
                     target?: MeasureTarget; source?: MeasureSource }
```

- Measurements stay keyed by label (server tables and old docs keep working). `target` is added.
- **Source sets the weight** in the solver. Defaults: laser 0.3 cm, tape 1 cm, plan 3 cm, other 2 cm.
  Missing source = tape.
- **The measured value is always kept.** The solver never writes `doc.measurements` (the plan
  follows the values). One value per target is enough: no history (decided 2026-11-23). A new
  value replaces the old one. Measuring Mode shows "Measured 412 · Solved 410,7 (−1,3)"; the canvas
  shows "✓ 412 · 410,7" when the two differ by more than the plan precision (done).
- When a wall is split, each face value stays on the segment that holds it. A centre value on a
  split wall is marked "to check".

## Solver on the wall graph
- Unknowns: node positions (centre line) and wall thicknesses. No pairing guess: the topology is given.
- Rows: face lengths, centre lengths, thicknesses, diagonals, locked walls, walls in line (as today).
- **Surface references** (option, Solve tab): `Off | Guide | Match`.
  - Guide (one-sided): when the plan surface is already smaller than the reference, the solver must
    not make it smaller (and the opposite). Hinge row, active only when the change goes the wrong way.
  - Match: weak pull to the reference.
  - Sigma about 1.5 % of the surface: a measured wall always wins. A room reference uses the area of
    the inside faces of that room; an apartment reference uses the sum of the rooms.
  - Report: per reference, plan surface before / after / reference, difference in %.
- **Outliers**: list measurements with a large residual (|r| > 3 sigma), with an option to ignore
  them for one run.
- **Snap thicknesses** (option): walls that the data does not determine snap to usual values
  (5, 7, 10, 15, 20, 30 cm). To do: today the snap is applied after the fit, so the corners use
  the thickness before the snap; the fit must run again with the snapped thicknesses fixed.
- **Preview before apply**: list walls that move more than X cm; Apply or Cancel.

### Walls in any direction (phase 4b, agreed 2026-11-23)
Today the solver knows the direction of each wall: one position and one thickness per wall, corners
from one x and one y. This forces exact right angles and skips walls at an angle.
- **Unknowns per wall**: direction (angle of its normal), offset of its centre line, thickness. The
  direction has a prior = the drawn angle (sigma `angleSigmaDeg`, default 3 degrees).
- **Corners** = intersection of the two face lines (inside) or centre lines. When the two walls are
  almost parallel (|sin| < 0.02) the corner is a free point along the line (as today in line).
- **Soft rules**: walls drawn at about 90 degrees (or parallel) to a wall they meet keep that angle,
  sigma `squareSigmaDeg`. Setting "Room angles: Square | Free": Square (default) fixes the direction
  of horizontal and vertical walls (the result is the same as today); Free lets them turn, so a
  diagonal can show a room that is out of square. Walls at an angle are always solved.
- **Exact gradients** with a small sparse forward-mode automatic differentiation (value + sparse
  gradient, with add, sub, mul, div, sqrt, sin, cos, atan2), so every row (lengths, diagonals,
  centre and facade values, surfaces, in-line rules) is written once as a function of the unknowns.
- Measure next, facade and centre values, preview and apply work for every wall.

### Suggested measurements (next best measurement)
The solver tells you which values to measure next, most useful first, and you type them in place.

- **Candidates**: every target with no value: room wall faces, diagonals (one per room, the longest),
  thicknesses, centre lengths (phase 4). Each candidate is a row the solver could add, with its
  gradient `g` and the sigma of the default source.
- **Score**: with `C` = covariance of the unknowns after the fit (inverse of the normal matrix), the
  candidate reduces the summed variance by `gain = g^T C W C g / (s^2 + g^T C g)`. `W` weights what
  matters: wall positions (1) and thicknesses (1); room areas through the area rows (option).
  Shown as "SE-3: uncertainty of room SE 14 cm -> 2 cm".
- **Order**: greedy. After the best candidate, `C` is updated as if it was measured (rank-1 update,
  Sherman-Morrison), then the next one is scored. So the list says "measure these 5, in this order",
  not "5 values that all give the same information".
- **Why it is needed**: each row has a short reason: "thickness not found by the data", "room
  position only from the drawing", "no check value (no redundancy)", "large residual: measure again".
- **Redundancy**: when all unknowns are found, it suggests CHECK values (diagonals first), because
  outliers can be found only when there is redundancy.
- **Interface** (Solve tab, section "Measure next", above Actions): top 10 rows. Each row: label,
  reason, gain, a number input (Enter saves into `doc.measurements`, like Measuring Mode, then the
  list is calculated again), and a button that selects the wall on the plan. The selected wall
  shows the suggestion on the canvas. "Measure in this order" opens Measuring Mode with this list
  as the walk-through.
- Calculated in a pure function `suggestMeasurements(doc, options)` next to the solver, tested.

## Drawing (phase 6, started 2026-11-23)
Rooms stay the editing source. Traced walls are a drawing aid that becomes rooms.
- **Traces**: `doc.traces?: TraceWall[]` = `{ id, a, b, thicknessCm, type }`, centre lines in cm,
  stored in the snapshot (synced like rooms), shown dashed on the plan, selectable and deletable.
- **Wall tool** (key `w`): click to start, click to add the next point (a chain), double-click or
  Enter ends the chain, Esc cancels the current segment. Snaps: trace end points, room corners, a
  point on a trace or a room wall (T junction), 0/45/90 degree directions (Alt = no snap), the
  existing grid snap. Thickness and type from the last used values (UI store), edited in the
  Inspect tab while the tool is active (default 10 cm, partition).
- **Make room tool** (key `m`): click inside a closed area formed by traces and room walls (centre
  lines). `findEnclosingCycle` (src/model/faces.ts, pure) splits all segments at their crossings
  and returns the smallest cycle around the point. The new room gets that polygon (centre lines),
  the thickness and type of each trace for its walls, the next free code, and its name editor
  opens. Traces covered by a room wall are removed (a trace partly covered is cut), so a wall is
  never drawn twice. A click outside any closed area shows a toast "No closed area here".
- **Room tool stays** (rectangle, polygon).
- **Cleanup** (old plans): merge walls that overlap or almost touch, with a report (later).

## Phases
Each phase is one or more agent rounds. Commit after each round (tsc, tests, build pass).

1. **Derived wall graph** (`src/model/wallGraph.ts`, pure, tested). `buildWallGraph(rooms)` returns
   nodes, walls, faces and a map room wall (`roomId` + `wallStart`) -> face. Same grouping rules as
   `globalSolve.ts` today, plus T-junction splits. No doc change.
2. **Surface references in the current solver** (Off / Guide / Match), with the report. Independent of
   the graph; phase 3 keeps the rows.
2b. **Suggested measurements** on the current solver (section above), after phase 2 because it uses
   the same file. Phase 4 keeps it and adds centre and outside face candidates.
3. **Measurement sources and targets**. 3a: optional `source` on `Measurement` (types, schema, D1
   column, API, MCP, CLI, sync), a source picker in Measuring Mode, and `sourceSigmaCm(source)`.
   3b (after 2b): solver weights from the source. The TARGET is not stored yet: the derived wall ids
   change when a room joins a wall, so `measurementTarget(graph, rooms, label)` resolves it from the
   label at each call. Stored targets come with stable ids in phase 5.
4. **Solver on the graph**: `globalSolve` reads `buildWallGraph` (same results); remove its own
   pairing code; graph conflicts in the report; snap thicknesses; preview before apply. Centre and
   outside face rows need stable wall labels: they move to phase 5.
4b. **Walls in any direction** (section above). Done 2026-11-23: autodiff solver, Room angles Square | Free,
   walls at an angle solved in both modes. Limit: a corner added on a wall at an angle still makes two
   stored walls (kept in line by the align row).
5a. **Stored graph, stable ids, no lost values** (decided 2026-11-23: auto-migrate). The rooms stay
   the editing source for now. `doc.nodes` and `doc.walls` (with their faces) are STORED and kept in
   sync by a doc rule: after each outline change the graph is built again and each wall keeps its
   id (`W1`, `W2`...) by matching its faces (room id + start vertex id). Additive change: same
   schemaVersion, optional fields, measurement labels and rooms unchanged, so an old cached client
   that drops the fields only causes a rebuild with the same ids. Migration = on load, a doc with no
   walls gets them. Values of a split or removed wall, or of a deleted room, go to
   `doc.oldMeasurements` (kept in the snapshot, shown as "Old values" in the room card, deleted only
   by the user) instead of the bin.
5b. **Wall values (done 2026-11-23)**: centre `W12-C` and facade `W12-E` lengths on stored walls, in
   the solver (a facade length finds an exterior wall thickness), Measure next (facade only), the
   Inspect wall card and a Facade section in Measuring Mode. Values of a removed wall go to old values.
5c. **Walls as the editing source** (NOT started, to decide): tools edit `doc.walls` / `doc.nodes`;
   `room.vertices` and `room.walls` become calculated. About 6,500 lines of editing code
   (interaction, tools, ops, commands, dsl). High risk, little visible gain while the derived graph
   keeps ids stable; phase 6 can output rooms without it.
6. **Wall tool and Make room.**
7. **Elements on walls**: `wallId` + offset from node `a`; migrate; update clearance and export.
8. **Cleanup tool** for old plans; remove the transition layer.

## Risks
- `src/model/types.ts` is shared by every feature. Phases 1-4 do not change `Room`.
- Saved projects (local and shared) need a tested migration (phase 5), with the schema version.
- Labels shown to the user must not change during the migration.
- Walls that are not horizontal or vertical: the graph handles them; the solver keeps them fixed
  until a later phase.
