# UI Test Report: Walls, Layers, and Measure Rows

Date: 2026-11-25
URL: `http://localhost:8788/`
Test projects: `Walls UI Test`, `Walls UI Test 2`
Viewports: Desktop (`1440 x 900`), Phone (`390 x 844`)
Browser console errors: None (only the standard Chromium form-field `id`/`name` issue).

## Test Results

| Test | Result | Notes |
| --- | --- | --- |
| 1. Storage overlap (`2238f77`) | PASS | Storage added on `SB-3` with toast `Storage overlaps another room`. Measuring Mode `StorageEditor` shows amber `Warning: Storage overlaps another room` and keeps `Width` edit (`90`). Edit Mode `StoragePanelSection` shows the same warning in red. |
| 2. Layers tab (`d739fcf`) | PASS | 4th tab `Layers` shows rooms by `walkOrder`, `Walls`, `Doors & windows`, `Storage` under parent room `SB Sdb`, and `Walls without a room`. Click selects on canvas; canvas click highlights and scrolls row; shift-click multi-selects; hover highlights wall; filter (`Sdb`) works; `Delete` removes selected `W44` (Select tool active). Collinear wall draw is deduplicated by `61a44ef`, so no overlapping wall badge appeared. |
| 3. Duplicate walls (`61a44ef`) | FAIL | Drawing over `C2` wall creates no duplicate. Rectangle room `R2` snaps and reuses standalone wall. `Cmd+K` `Clean up walls` reports `Cleaned 3 duplicate walls/points` and `Cmd+Z` undoes it. However, dragging `R2` top-left corner left `W46` (`309 cm`) in `Walls without a room`. |
| 4. Measure rows (`9449bdd`) | PASS | `Chambre 3` shows one grouped row `C3-3+4+5+6+7`, typing `366` gives no conflict (`1 / 81`), `Tab` moves to `C3-8`, and `MiniDrawing` labels the wall once. Side note: splitting `366` across 5 pieces wrote `actualCm: 0` for `C3-4` and `C3-6`, which later blocked `deleteWall` Zod validation. |
| 5. Wall delete (`070f5b6`) | PASS | `EN-3` deleted and neighbours extended. Rectangle side `C1-2` refused with `parallel` toast. Locked `W20` disabled Delete button with unlock tooltip and refused `Delete` key. Shared `DG-4` merged rooms (`12` to `11`). `EN-3` with door deleted door and showed `Merged the rooms and deleted 1 door/window`. `Cmd+Z` undid each in one step. Dragging unlocked `W20` moved it; locked `W20` showed `Wall W20 is locked. Unlock it in the wall card to move it.`. |
| 6. General | PASS | No console errors. Edit Mode (dark), Measuring Mode (light), and phone width (`390 x 844`) Layers drawer render cleanly with no horizontal overflow. |

## Failures

### 3. Duplicate walls: corner drag leaves a wall at the old position

- **Steps**: Draw a standalone wall in empty space. Draw a rectangle room (`R2 Room 2`) snapped to that standalone wall. Select `R2` and `Cmd+drag` its top-left corner from `[121, 191]` to `[101, 171]`.
- **Expected**: All walls of `R2` move with the corner, and no wall stays at the old position.
- **Actual**: Wall `W46` (`309 cm`) stayed at the old position and appeared under `Walls without a room` in the Layers tree.
- **Likely file**: `src/features/rooms/interaction.ts` or `src/model/v2/repair.ts`.
