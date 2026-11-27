# UI Test Report: Corner Radius (Chrome)

Tested build at `http://localhost:8788` (after clearing service worker and PWA caches and doing a hard reload).

## Spec Results

- **Four corner handles on one selected rect item (>= 48 px on screen, Select tool, Design mode)**: **PASS** — `document.querySelectorAll('[data-radius-handle]').length === 4` in order TL (`0`), TR (`1`), BR (`2`), BL (`3`). White circles (`#fff`, 8x8 px) with orange stroke (`#fb923c`). Switching to Plan mode hides handles (`0`) and disables furniture pointer events. Zooming out until the item is `< 48 px` hides handles (`0`).
- **Drag handle toward center rounds all 4 corners and shows "Radius N cm" badge; drag back to corner sets radius to 0**: **PASS** — Dragging handle `0` inward updated all 4 corners together (e.g. `Radius 47 cm`, `Radius 80 cm`), and dragging back to the corner set radius to `0` (`Radius 0 cm`).
- **Hold Option/Alt while dragging changes only that corner**: **PASS** — Dragging handle `0` with `altKey: true` changed only TL (`47 cm`) while TR, BR, BL stayed `0 cm`.
- **One drag = one undo step (Cmd+Z undoes the whole drag)**: **PASS** — `Meta+z` reverted the full drag from `80` back to `0` in one step.
- **Works on a rotated item (~30°)**: **PASS** — Rotated Bed to `30°`; the 4 handles stayed in the rotated corners, and dragging handle `0` toward the rotated center set radius to `43 cm` (`Radius 43 cm`).
- **No handles for a circle, multi-selection, group, or another tool**: **PASS** — Handle count was `0` for Circle shape, `0` for Tape tool (`M`), `0` for 2-item Shift-click multi-selection, and `0` for `Meta+g` 2-item group.
- **Dragging a radius handle does not move or resize the item**: **PASS** — Width (`160`), Depth (`200`), X (`377,8`), and Y (`492`) stayed unchanged during and after radius drags.
- **Inspector "Corner radius", "Mixed" placeholder, and "Independent corners" 4 fields (TL / TR / BL / BR)**: **PASS** — When corners differ, "Corner radius" is empty with placeholder `"Mixed"` and the 4 fields (TL, TR, BL, BR) are shown; editing individual fields changes only that corner; typing a value in "Corner radius" and pressing `Enter` sets all 4 corners to that value; the "Independent corners" button toggles the 4 fields.
- **Copy/paste style keeps per-corner radii**: **PASS** — Copied style (`Option+Cmd+C`) from Bed with `[65, 43, 43, 43]` and pasted (`Option+Cmd+V`) onto Fridge; Fridge received `TL=65`, `TR=43`, `BL=43`, `BR=43` and `"Mixed"` placeholder.
- **SVG export shows rounded corners**: **PASS** — Exported SVG included `<path>` with per-corner arc commands (`A 65 65` and `A 43 43`).
- **Light and dark theme handle visibility**: **N/A (Dark theme only)** — No theme toggle exists in the UI, and `prefers-color-scheme: light` keeps the dark theme. In dark theme, the white-filled orange-stroked handles are clearly visible.

## Console Errors

- **0 console errors** (`error` / `warn`).
- Only DevTools issue: `A form field element should have an id or name attribute (count: 68)`.

## Visual & UX Observations

- **Handle size and overlap**: Handles are `8×8 px` (`r = px(4)`) inset by at least `12 px` from the corners, so they do not overlap the corner square resize handles at `0` radius.
- **Badge position**: The `"Radius N cm"` pill badge appears cleanly above the dragged handle without obscuring the handle itself.
- **Minor observation**: In the Inspector, typing into `"Corner radius"` updates the 4 corners on `Enter` or blur (not on every keystroke), which is standard for committed numeric inputs in this panel.
