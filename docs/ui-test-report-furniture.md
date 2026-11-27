# Design Mode Furniture UI Test Report

- **Date:** 2026-11-27
- **URL:** `http://localhost:8788` (new tab, service workers unregistered, caches cleared, hard reload)
- **Project:** 3 rooms (`Living`, `Kitchen`, `Garden`) and 3+ furniture items (`Bed`, `Fridge`, `Bathtub`)
- **Build proof:** In Design mode, Shift-clicking two furniture items showed `2 items selected` in the Inspect panel.

---

## A. Option Measure — PASS

| Check | Result | What we saw |
| :--- | :--- | :--- |
| Hover over another item | PASS | Selected `Bed`, held `Alt`, moved pointer over `Bathtub`. `Bathtub` showed a cyan/blue outline, and a dashed orange gap line with pill label `268 cm` appeared between `Bed` and `Bathtub`. |
| Hover over a wall | PASS | Moved pointer with `Alt` held over the right wall of the bottom-left room. The wall highlighted in cyan, and a dashed cyan line with pill label `216 cm` appeared. |
| Hover over empty floor | PASS | Moved pointer with `Alt` held over empty floor inside the bottom-left room (with `Bed` fully inside the room). Four distance labels appeared (`24 cm`, `216 cm`, `52 cm`, `48 cm`). (Note: when `Bed` overlapped the bottom wall, only 3 distances appeared.) |
| Release Alt | PASS | Dispatched `keyup` for `Alt`. All guide lines and distance labels went away. |
| Alt-drag duplicate | PASS | Selected `Fridge` and Alt-dragged it to `(950, 349)`. A second `Fridge` item was created at the drop position. |

---

## B. Pinned Tape — PASS

| Check | Result | What we saw |
| :--- | :--- | :--- |
| Press `M`, drag measurement | PASS | Pressed `M` (`Tape` tool active) and dragged from `(750, 250)` to `(950, 250)`. A locked measurement (`218.4 cm`) stayed on the canvas (`[data-testid="tape-pinned"]`). |
| Press `V` back to Select | PASS | Pressed `V`. The `Select` tool became active (`aria-pressed="true"`), and the `218.4 cm` measurement stayed visible. |
| Switch to Plan mode and back | PASS | Switched to `Plan` mode (`inPlanModeVisible: true`) and back to `Design` mode (`stillVisible: true`). The pinned measurement stayed visible in both modes. |
| Click label copies | PASS | Clicked `[data-testid="tape-label"]` (`163.8 cm`). `navigator.clipboard.writeText` received `"163.8 cm"`. |
| New measurement replaces old | PASS | In `Tape` mode (`M`), dragged a new measurement (`142 cm`) while `163.8 cm` was pinned. The old measurement went away (`countAfterNewTape: 1`) and only `142 cm` stayed. |
| Click `×` dismisses | PASS | Clicked `[data-testid="tape-dismiss"]` (`aria-label="Dismiss measurement"`). The pinned measurement went away (`countAfterDismiss: 0`). |

---

## C. Multi-select — PASS (with 1 minor note)

| Check | Result | What we saw |
| :--- | :--- | :--- |
| Shift-click adds/removes | PASS | Clicked `Bed` (1 selected), Shift-clicked `Bathtub` (`2 items selected`), Shift-clicked `Fridge` (`3 items selected`), Shift-clicked `Fridge` again (`2 items selected`). |
| Drag box selects items | PASS (canvas) / Note (floor) | Dragging a box on empty canvas outside rooms (`canvas-background`, `(1090, 290)` to `(800, 420)`) showed a dashed marquee box and selected both `Fridge` items (`2 items selected`). Dragging starting inside a room floor `<polygon>` (`(780, 290)` to `(1020, 420)`) did not start a marquee box. |
| Dashed orange box | PASS | Selected group showed a dashed orange bounding box (`stroke="#fb923c"`, `stroke-dasharray`). |
| Drag one moves all | PASS | Dragged one selected `Fridge` from `(849, 349)` to `(849, 409)`. Both `Fridge` items moved together from `y: 320` to `y: 384`. |
| One `Cmd+Z` undoes whole move | PASS | Pressed `Meta+z`. Both `Fridge` items returned to `y: 320` in one undo step. |
| Arrow keys nudge all | PASS | Focused canvas and pressed `Shift+ArrowRight` 3 times. Both `Bed` (`x: 347 -> 374`) and `Bathtub` (`x: 291 -> 318`) moved right together. |
| `Cmd+D` duplicates and selects copies | PASS | Dispatched `Meta+d` with 2 items selected (`Bed`, `Bathtub`). Item count increased from 3 to 5, and the 2 new copies were selected (`2 items selected`). |
| `Delete` removes all, one undo restores | PASS | Dispatched `Delete`. Item count dropped from 5 to 3. Dispatched `Meta+z`; item count returned to 5. |
| Inspect colour swatch changes all | PASS | Clicked `#9c8669` swatch in Inspect panel with 2 items selected. Both selected items changed fill from `#4b5563` to `#9c8669`. |

---

## D. Edge Resize — PASS (with 1 minor cursor note)

| Check | Result | What we saw |
| :--- | :--- | :--- |
| Drag right edge | PASS | Selected `Fridge` (`left: 822, right: 917`, `104×65 cm`) and dragged its right edge `+40 px`. `left` stayed fixed at `822`, `top`/`bottom` stayed fixed (`320`/`379`), and `Width` changed to `148 cm` (`148×65 cm`). |
| Drag top edge | PASS | Dragged top edge `-40 px`. `bottom` stayed fixed at `379`, `left`/`right` stayed fixed (`822`/`957`), and `Depth` changed to `108 cm` (`148×108 cm`). |
| 45° rotated item edges | PASS | Rotated `Fridge` by `+45°` (`170×130 cm`) and dragged a rotated edge handle (`cx: 875, cy: 313`) by `(+25, +25)`. `Width` changed to `131 cm` and `Depth` stayed `130 cm`. |
| Resize arrow cursor on edges | PASS (minor note) | Unrotated edges showed `ew-resize` (right/left) and `ns-resize` (top/bottom). On the 45° rotated item, edge handles still showed `ew-resize` / `ns-resize` instead of diagonal resize cursors. |
| Corner resize still works | PASS | Dragged bottom-right corner `(+20, +20)`. Both `Width` and `Depth` increased (`148×108` -> `170×130 cm`) with top-left fixed. |
| Drag middle moves item | PASS | Dragged middle of `Fridge` `(+30, +30)`. All 4 edges shifted (`left: 822 -> 852, top: 280 -> 308`) with size unchanged (`170×130 cm`) and `grab` cursor. |

---

## Visual Notes
- All overlays (cyan wall highlight, orange item-to-item gap line, `218.4 cm` pinned tape with `×` button, dashed orange multi-select box, and rotated 45° selection handles) rendered cleanly with no overlap or clipping at `1440×900`.
- `dev:api` processes on port `8788` were stopped at the end of testing.
