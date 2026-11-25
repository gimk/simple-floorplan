# UI Test Report: Built-in Storage

Date: 2026-11-25
URL: `http://localhost:8788/`
Test projects: `Storage UI Test`, `Storage UI Test 2`
Viewports: Desktop (`1440 x 900`), Phone (`390 x 844`, dark mode and Sunlight high-contrast mode)
Browser console errors: None (only the standard Chromium DevTools form-field `id`/`name` issue).

## Test Results

| Step | Result | Notes |
| --- | --- | --- |
| 1. Measuring Mode: no Cupboard in Doors & windows | PASS | After reloading the updated service worker, "Doors & windows" lists Window, Door, Opening (no door), Radiator, and Other. Cupboard is gone. |
| 2. Measuring Mode: + Add built-in storage | PASS | Storage appears outside the room wall on the canvas (and in the phone mini drawing). No separate room card is added. |
| 3. Measuring Mode: edit fields & bad value | PASS | Wall, From start (`0` = inside corner), Width, Depth, Side wall, Back wall, and all 6 Door types (Hinged, Double hinged, Sliding, Pocket, Bifold, No door) update the drawing. Oversize value shows inline alert `Storage does not fit on the host wall` with no crash. |
| 4. Measuring Mode: second storage on same wall & door change | PASS | With two storages on the top wall (`R3` at `0`, `R2` at `200`), changing `R3` door from Sliding to Hinged updates the door symbol without moving `R3`. Note: when a storage is at `0`, the Wall dropdown only lists the pre-storage stub (`on R1-1`) and omits the post-storage segment (`on R1-3`), so `R2` had to be moved right first. |
| 5. Measuring Mode: delete storage | PASS | Deleting the storages returns the room to 4 plain walls (`R1-1` to `R1-4`, `390 x 290 cm`). |
| 6. Edit Mode: G tool, select, rename/move, parent list | PASS | Key `g` activates "Built-in storage". Clicking a wall places storage outside and selects it with Parent room `Room 1 (R1)`. Renaming to `Hall Closet` and changing Wall keeps the name and selection. Selecting `Room 1 (R1)` lists `Hall Closet 100 x 60 cm`. |
| 7. Edit Mode: Delete key on selected storage | PASS | Pressing `Delete` removes the storage walls and its front door. |
| 8. Edit Mode: outside dimensions | PASS | Outside dimensions go around the storage (`150`, `65`, `110`, `65`, `150`) with no dimension line through it. |
| 9. Edit Mode: room schedule | PASS | Shows `R2 Hall Closet (Room 1)` indented under `R1 Room 1`. `Total (1)` is `11,91` (includes `0,60`), and room count stays `(1)`. |
| 10. Edit Mode: SVG and PDF export | PASS | Both `storage-ui-test-2.svg` and `storage-ui-test-2.pdf` downloaded. SVG includes `#storage-hatch`, `data-room-storage="true"`, `Hall Closet`, and `Built-in storage` in the legend. |
| 11. Edit Mode: Undo and Redo | PASS | Undo and Redo restore and re-apply add, edit, and delete. |
| 12. Edit Mode: delete parent room | PASS | Deleting `Room 1` removes `Hall Closet` and its door too. |

## Failures

None.

## Look

- **Canvas corner badge overlap**: On a small storage (`100 x 60 cm`), wall corner badge `3` slightly overlaps the end of the `Storage` label inside the storage box.
- **Outside dimension label between adjacent storages**: When two storages sit on the same wall (`R3` and `R2`), the `95` dimension label between them sits high and slightly touches the top-right corner of `R2`'s dimension line.
- **Room schedule truncation**: In the desktop Plan sidebar, `Hall Closet (Room 1)` truncates to `Hall Closet (Ro...` because of the narrow column width.
- **Phone mini drawing (`390 px`)**: Clean layout in both dark mode and Sunlight high-contrast mode. In Sunlight mode, the room fill stays dark navy while the storage fill is light grey/tan; the `R1-4` label sits inside the storage box with a dark outline and stays legible.
- **Phone form layout (`390 px`)**: The 2-column grid for `From start`, `Width`, `Depth`, `Side wall`, and `Back wall` fits cleanly at `390 px` width with no horizontal overflow or overlap.
- **Edit Mode hover preview**: When the Built-in storage tool (`g`) is active and the pointer rests on a wall, the orange preview box can overlap the outer dimension number (`410`).
