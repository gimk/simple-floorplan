# Solver on/off plan

Status: approved plan, decisions at the end of the file.

## Goal

- The solver is a state, not an action: **On** or **Off**, always for the whole plan.
- Off: the plan shows the **base** geometry = estimated (drawn) + measured values that the user applied.
- On: the plan shows the base geometry solved by the global solver (`solveGlobal`).
- The solver does not run while the user is in Measuring Mode. It runs when the user leaves it.
- Each solver change is recorded. The user can review each change and revoke one.
- Colors: grey = estimated, green = measured, **purple = solved**.

## Data model (decision: record the changes in the doc)

The doc geometry stays the geometry that the plan shows (solved when On). All the current
readers (plan, export, areas, MCP, sync) stay as they are. A new doc field records the solver:

```ts
doc.solver?: {
  enabled: boolean
  solvedAt?: string            // ISO time of the last solve
  rmsCm?: number               // average mismatch of the last solve
  changes: SolverChange[]      // what the last solve changed, with the old value
  revoked: SolverKey[]         // elements the user keeps at their base value
}
type SolverKey = { kind: 'position' | 'thickness'; wallId: string }
type SolverChange = SolverKey & {
  id: string
  before: ...                  // base value (node positions of the wall / thickness cm)
  after: ...                   // solved value
  summary: { moveCm?: number; dir?: 'N'|'S'|'E'|'W'; fromCm?: number; toCm?: number; lengthFromCm?: number; lengthToCm?: number }
}
```

- One change = one stored wall (v2 `doc.walls`): its position moved, or its thickness changed.
  Corner moves are the result of wall moves, so they are not separate rows.
- **Off** = write back each `before` value, keep `enabled: false`, clear `changes`.
- **On** = solve from the base, record the new `changes`. One undo step.
- **Revoke** = write back the `before` value of that wall and add its key to `revoked`.
  The next solves hold that wall at its base value (same path as `keepLocked`).
- **Restore** a revoked change = remove its key from `revoked` and solve again.
- A user edit of a wall that has a change (drag, typed length, MCP command): the change is
  dropped and the new value is base. Done in a new doc rule next to `relabelRule`.

Sync: `doc.solver` must be added to `PlanDoc` (`src/model/types.ts`), `PlanDocV1Schema` and
`SnapshotPutBodySchema` (`src/core/schema.ts`), `diffAndEnqueue` (`src/sync/sync.ts:213`),
`loadProjectDoc` (`functions/store.ts:140`). No SQL migration: it lives in `data_json`.

## When the solver runs

| Event | Solver On | Solver Off |
|---|---|---|
| User leaves Measuring Mode | Solve whole plan, one undo step | nothing |
| Toggle On | Solve whole plan | – |
| Toggle Off | Write back the base | – |
| Solver setting changed (Solve tab) | Solve again | nothing |
| Value typed in Measuring Mode | nothing (no auto-apply) | nothing |
| Edit ends in Edit Mode (settle) | Solve whole plan; the edited wall keeps the user value | nothing |

The per-room auto-apply (`scheduleAutoApply`, `flushAutoApply` in
`src/features/rooms/measureRules.ts`) is removed with its three callers.

## Solve tab (`src/features/solve/SolvePanel.tsx`)

1. **Top**: a purple switch "Solver On/Off" and one status line, for example
   "Solved 2 min ago · 14 changes · average mismatch 0.8 cm" or
   "Waits until you leave Measuring Mode".
2. **Changes** (new): one row per change, sorted by size:
   "KI-2 moved 1.2 cm east (wall 296.0 → 294.5 cm)", "Wall KI/LI thickness 10 → 12 cm".
   Hover = highlight on the plan (existing hover path). Button "Revoke".
   Revoked rows below, with "Restore".
3. Progress, Measure next, Settings: stay. "fit error … cm rms" becomes "average mismatch … cm" with a ? tip.
4. Removed: "Solve whole plan", the preview block, "Last result", and
   "Apply measured lengths to all rooms" (moves to Measuring Mode).

## Measuring Mode (`src/features/measure/*`)

- Top banner (purple when On): "Solver on: it updates the plan when you leave Measuring Mode."
  Off: "Solver off: measured values change the plan only when you apply them."
- Bottom button "Apply measured values to the plan" (per-room `applyMeasuredAll`, the old Solve
  tab button). The result is base geometry. When On, the solver still runs on leave.
- A small legend with a ? tip: grey Plan (estimated), green Measured, purple Solved.
- Field lines, instead of "Measured x · Solved y (diff)":
  - no value: placeholder "plan 296" (grey).
  - value, wall not solved: "Plan 294.5 · 1.5 cm shorter than measured" (grey).
  - value, wall solved: "Solved 295.8 · 0.2 cm from measured" (purple); orange when large.
- Same for the facade fields (`FacadeCard.tsx`).

## Purple everywhere

- One set of tokens in `src/shell/panel/styles.ts`: `SOLVED_TEXT`, `SOLVED_FILL`, `SOLVED_BG`,
  `SOLVED_BORDER` (`violet-700` / dark `violet-400`), next to new `MEASURED_*` and `ESTIMATED_*`
  tokens that replace the copied emerald and slate classes.
- Plan: dimension text of a solved wall in purple (`DimLineView.tsx`, `RoomsOverlay.tsx:641`).
  Optional: a thin dashed purple outline of the base position of the hovered change.
- Room card wall list and fit line (`src/features/rooms/RoomCard.tsx:211-252`).
- Wall cards (`WallCard.tsx`, `StoredWallCard.tsx`): read `doc.solver.changes` instead of running
  `solveGlobal` on each render.
- Export: `PAPER.solved = '#6d28d9'` in `src/features/export/svgDims.ts`.

## MCP

- New command `set_solver { enabled }` in `src/core/commands.ts`, tool in `functions/mcp/tools.ts`,
  entry in `src/core/access.ts`. Plan reads include `solver` state and the change list.
- `apply_measurements` stays a base edit (per room).

## Rounds (commit after each; Chrome check by a hydrogen agent after each UI round; push at the end)

1. **Engine, no UI**: types, schema, sync fields, `solverOn`, `solverOff`, `revokeChange`,
   `restoreChange`, the drop-on-edit rule, color tokens. Unit tests. (Must be first.)
2. **Solve tab + trigger**: switch, changes list, revoke/restore, solve on leaving Measuring Mode,
   remove old buttons, wall cards read the changes.
3. **Measuring Mode**: remove auto-apply, banner, Apply button, legend, new field lines.
4. **Purple on plan and export**, room card.
5. **MCP** `set_solver`.

Rounds 2, 3, 4 can run in parallel after round 1 (separate files; round 1 owns the shared tokens).
Round 5 can run in parallel with them.

## Decisions (user, 2026-11-25)

1. Edit Mode with solver On: solve again when an edit ends (settle). The wall the user edited
   keeps the user's value (its change is dropped, it is base).
2. Existing projects (no `doc.solver`): start Off. The plan stays as it is.
3. Revoke unit: per wall position and per wall thickness.
