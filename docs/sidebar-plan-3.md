# Right Panel Upgrade (round 3)

Follows `docs/sidebar-plan.md` (phases 1 and 2 are done: Inspect/Plan tabs, breadcrumb, shared primitives).

## Problems today
1. **Whole-plan tools are inside the room card.** The "Measured lengths" section of `RoomsPanel.tsx`
   holds "Apply to all rooms", "Solve whole plan" and the "Keep locked" toggle. You must select a room
   to reach them, and the result note is attached to that room.
2. **Precision is hidden.** It is in the Apartment card, which shows only when nothing is selected.
   It controls the solvers, so it must be next to them.
3. **The Inspect tab stacks levels in the wrong order.** With a wall selected, `RoomsPanelView` shows:
   Wall, On this wall, Room, Walls list, Elements, Measured lengths. The child is above its parent, and the
   room card is between the wall and the list you clicked. Clicking a wall in the Walls list makes the
   panel grow above the place where you clicked.

## Decisions (agreed 2026-11-23)
- A third tab: **Inspect | Solve | Plan**.
- The Inspect tab shows **only the current selection**. You go up with the breadcrumb or with Esc.

## Target design

### Tab "Solve" (new)
Everything that works on the whole plan from the measured values, in workflow order:
1. **Progress**: one row per room: code, name, verified walls `3/6`, fit residual (from `fitCheck`),
   lock icon when all verified walls are locked. Click a row = select the room (sidebar goes to Inspect).
   Footer: totals for the apartment.
2. **Settings**: Precision (moved from the Apartment card), Keep locked (moved from the room card).
3. **Actions**: "Apply measured lengths to all rooms", "Solve whole plan". Disabled with a hint when
   no wall is verified.
4. **Last result**: the report of the last run (`describeReport` / `describeGlobal`). Kept in the UI
   store, not per room, so it stays when the selection changes. Cleared on undo or on a new run.

### Tab "Inspect": one context at a time
| Selection | Shown |
|---|---|
| Nothing | Apartment card (without Precision), Clearance check |
| Room | Room card (name, code, walk order, stats, ceiling), Walls list, Elements list, "Apply measured lengths to this room" (with a link "Whole plan → Solve tab") |
| Wall | Wall card + "On this wall". Header: `‹ Wall SE-2 ›` steps to the previous/next wall of the same room. No room card. |
| Wall group (Shift + click) | Group wall card only |
| Vertex / hole vertex | Vertex card only (hole card when it applies) |
| Room or point group | Group card only |
| Element, Tape, Pin | Their card only (no change) |

- **Esc goes up one level**: wall/vertex → room, element → room, room → nothing. A second Esc clears.
  Tools that cancel in-progress points still `preventDefault()` Escape first (keep `App.tsx` rule #13).
- The breadcrumb stays the main way up; it is already correct.
- When you select a wall from the Walls list, the panel scrolls to the top so the wall card is in view.

### Tab "Plan": no change
Background, Layers, Calculators, Export, Share.

## Implementation steps
1. **Store**: add `'solve'` to `SidebarTab` (`src/shell/sidebar/store.ts`); keep the stored tab valid
   when an old value is read. Add `solveReport: string | null` to the UI store.
2. **New feature `src/features/solve/`**: `SolvePanel.tsx` (sections above), `logic.ts` (progress rows,
   pure, tested). Move `runApply(all)`, `runGlobal`, `KeepLockedToggle` out of `RoomsPanel.tsx`.
3. **Apartment**: remove the Precision row from `ApartmentPanel.tsx`; the Solve tab owns it.
4. **Rooms panel**: split `RoomsPanelView` into `RoomCard`, `WallCard`, `VertexCard`, `GroupCard`
   and render exactly one by selection kind. Room card keeps "Apply to this room" only.
   Add prev/next wall buttons (`IconButton`, `aria-label` "Previous wall" / "Next wall").
5. **Sidebar shell**: third tab; selecting something still switches to Inspect; scroll Inspect to top
   on a selection change.
6. **Esc**: in `App.tsx`, replace `ui.select(null)` with "select parent" (helper next to `trail.ts`,
   pure and tested).
7. **Tests**: update `rooms/panel.test.tsx`, `Sidebar.test.tsx`, `apartment/panel.test.tsx`; add tests for
   the Solve tab, prev/next wall, Esc-up, and "only one card per selection".

## Constraints
- Keep every `data-*`, `aria-label`, `id`/`name` used by code and tests, the `window.__floorplan` bridge,
  keyboard shortcuts (B, Delete, ?), comma decimals, one undo step per edit.
- Section ids stay stable so the open/closed memory still works (`room-walls`, `room-elements`;
  the moved section gets new id `solve-actions`).
- No new dependencies.

## Delegation
One agent for steps 1–3 and 5 (Solve tab, store, shell), then one agent for steps 4 and 6
(rooms panel split, Esc). Commit after each round. Run `npm test` and `npx tsc -b` before each commit.
