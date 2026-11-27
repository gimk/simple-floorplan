# Design Mode Figma-Style Features UI Test Report

- **Date:** 2026-11-27
- **URL:** `http://localhost:8788` (new Chrome tab, service workers unregistered, caches cleared, hard reload)
- **Project:** 3 rooms (`Living`, `Kitchen`, `Garden`) and 5 furniture items (`Bed`, `Fridge`, `Bathtub`, `Bed`, `Bathtub`)
- **Build proof:** Pressed `?`. The Keyboard shortcuts dialog showed `Group / Ungroup` (`⌘G / ⇧⌘G`) and `Copy as PNG` (`⇧⌘C`). Switched to Design mode (`2`).

---

## A. Duplicate Layer Order — PASS

| Check | Result | What we saw |
| :--- | :--- | :--- |
| Single item `Cmd+D` | PASS | Selected `Fridge` at index 1 of 5 (`[Bed, Fridge, Bathtub, Bed, Bathtub]`) and pressed `Meta+d`. The copy (`9b4224a0...`) was inserted at index 2, directly above the source `Fridge` (`dd0d0a1d...`). |
| Multi-selection `Cmd+D` | PASS | Selected `Fridge` (index 1) and `Bed` (index 3), then pressed `Meta+d`. Each copy appeared directly above its own source (indices 2 and 5), while `Bathtub` stayed at the top (index 6). |

---

## B. Multi-Selection Transform — PASS

| Check | Result | What we saw |
| :--- | :--- | :--- |
| 3 items dashed box & handles | PASS | Shift-clicked `Bed`, `Fridge`, and `Bathtub` (`3 items selected`). One dashed orange box (`#fb923c`, `792×484`) appeared with 4 corner handles, 4 edge handles (`-1:0`, `1:0`, `0:-1`, `0:1`), and 1 rotate handle. |
| Corner drag scales group | PASS | Dragged bottom-right corner handle `(-60, -40)`. Bounding box scaled from `792×484` to `732×445`. |
| `Shift` + corner drag keeps ratio | PASS | Dragged bottom-right corner `(-120, -10)` with `Shift`. Bounding box became `775×474`, keeping aspect ratio `1.634` (original `1.635`). |
| `Option` + corner drag from center | PASS | Dragged bottom-right corner `(-40, -40)` with `Alt`. Bounding box scaled to `709×407` around center `(713, 480)` (original `(715, 482)`). |
| Rotate handle & 15° snap | PASS | Dragged top rotate handle `(+70, +15)`. Angle badge `15°` appeared in the SVG, and the group rotated (`806×505` bounding box). |
| `Option+drag` duplicates & `Cmd+Z` | PASS | Alt-dragged `Fridge` while 3 items were selected. Item count rose from `5` to `8`. One `Meta+z` removed all 3 copies (`count: 5`). |

---

## C. Groups — PASS

| Check | Result | What we saw |
| :--- | :--- | :--- |
| `Cmd+G` groups 2 items | PASS | Selected `Bed` and `Fridge`, pressed `Meta+g`. Inspect panel changed `Group` button to `Ungroup`. |
| Click member selects group | PASS | Deselected, then clicked `Fridge`. Inspect panel showed `2 items selected` and `Ungroup`. |
| Double-click selects one item | PASS | Double-clicked `Fridge`. Selection narrowed to 1 item (`Fridge`). |
| `Esc` selects whole group again | PASS | Pressed `Escape`. Selection returned to `2 items selected` with `Ungroup`. |
| `Cmd+click` selects one item | PASS | Meta-clicked `Fridge`. Selection narrowed to 1 item (`Fridge`). |
| Box select touching one member | PASS | Deselected, then dragged marquee box `(1130, 220)` to `(1060, 280)` touching only `Fridge`. Whole group (`2 items selected`) became selected. |
| `Cmd+D` creates separate group | PASS | Pressed `Meta+d` on the group. Item count rose from `5` to `7` (`2 items selected`, `Ungroup`). Clicking original `Fridge` selected only the original 2-item group. |
| `Cmd+Shift+G` ungroups | PASS | Pressed `Meta+Shift+g`. `Ungroup` button changed back to `Group`. |
| Inspector `Group` / `Ungroup` buttons | PASS | Clicked `Group` -> `Ungroup` appeared; clicked `Ungroup` -> `Group` appeared. |

---

## D. Box Select from Inside a Room — PASS

| Check | Result | What we saw |
| :--- | :--- | :--- |
| Drag from room floor over 2 items | PASS | Started pointer drag on empty `Living` floor `<polygon>` at `(580, 200)` and dragged to `(420, 340)` over both `Bathtub` items. Inspect panel showed `2 items selected`. |
| Plain click on floor keeps old behavior | PASS | Clicked empty `Living` floor at `(580, 200)`. Inspect panel switched to `Room` (`Living`, `12,00 m²`). |

---

## E. Shortcuts — PARTIAL (1 FAIL, 1 PARTIAL, 1 Group Align FAIL)

| Check | Result | What we saw |
| :--- | :--- | :--- |
| `Cmd+A` | PASS | Pressed `Meta+a`. Inspect panel showed `5 items selected`. |
| `Tab` / `Shift+Tab` | PASS | With `Bed` selected, `Tab` selected `Fridge` and `Shift+Tab` selected `Bed`. |
| `Enter` / `Shift+Enter` on group | PASS | With 2-item group selected, `Enter` entered the group (`Fridge`); `Shift+Enter` selected the whole group (`2 items selected`). |
| Arrows / `Shift+Arrows` | PASS | On `Fridge` (`674,8`, `187,8`), `ArrowRight` moved X to `675,8` (+1 cm) and `Shift+ArrowDown` moved Y to `197,8` (+10 cm). |
| `Cmd+[` / `Cmd+]` | PASS | `Meta+]` moved `Fridge` to front (index 4); `Meta+[` moved it to back (index 0). URL stayed `http://localhost:8788/` (no browser history back). |
| `Cmd+C` / `Cmd+V` (same & other artboard) | PASS | On `Plan A`, `Meta+c` then `Meta+v` pasted `Fridge` at `(694,8, 207,8)` (+20 cm offset). On `Plan B`, `Meta+v` pasted at `(694,8, 207,8)` (same position, 0 offset). |
| `Cmd+X` | PASS | Pressed `Meta+x` on pasted `Fridge`. Item count dropped from `6` to `5`. |
| `Option+Cmd+C` / `Option+Cmd+V` | PASS | Set `Fridge` to `#527362`, pressed `Alt+Meta+c`, selected `Bathtub` (`#4b5563`), pressed `Alt+Meta+v`. `Bathtub` fill changed to `#527362`. |
| `Shift+Cmd+C` copies PNG | PASS | Pressed `Shift+Meta+c`. Completed with no console errors. |
| `Option+A/D/W/S/H/V` align | PASS | On 3 items, `Alt+a` aligned left (`323`), `Alt+d` aligned right (`1107`), `Alt+w` aligned top (`244`), `Alt+s` aligned bottom (`720`), `Alt+h` aligned horizontal center (`715`), `Alt+v` aligned vertical center (`482`). |
| `Ctrl+Option+H` distribute | PASS | `Control+Alt+h` distributed 3 items horizontally with equal `135 px` gaps (`Bathtub` `323..493`, `Bed` `628..788`, `Fridge` `923..1107`). |
| `Ctrl+Option+V` distribute | PARTIAL | `press_key("Control+Alt+v")` in Chrome had no effect; dispatching `KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, altKey: true })` distributed them vertically (`Bathtub` moved to `t: 437, b: 512`). |
| `Cmd+R` focuses name field | PASS | Pressed `Meta+r`. Focus moved to `INPUT[aria-label="Furniture name"]` and page did not reload. |
| `Shift+H` / `Shift+V` flip | PASS | On `Bathtub`, `Shift+h` set shape transform `scale(-1 1)` and `Shift+v` set `scale(-1 -1)`. Label `<text>` `getCTM()` stayed `{ a: 1, b: 0, c: 0, d: 1 }` (not mirrored). |
| `Shift+2` zoom to selection | PASS | Pressed `Shift+2` with `Bathtub` selected. `Bathtub` screen width zoomed from `170` to `824`. |
| `Cmd+\` hides & shows UI | PASS | `Meta+\` collapsed `Furniture panel` and `Inspect panel` to `0×0`; pressing `Meta+\` again restored both panels. |
| `Cmd+'` toggles grid | FAIL | Neither `Meta+'` via `press_key` nor `KeyboardEvent({ key: "'", code: 'Quote', metaKey: true })` changed the SVG (`innerHTML` length `35512` and `164` `<line>` elements unchanged). |
| `Space+drag` pans | PASS | Held `Space` and dragged `(800, 400)` to `(900, 450)`. `Fridge` shifted from `(863, 299)` to `(963, 349)` (`+100, +50`). |
| Align left (`Option+A`) group + other item | FAIL | Selected 2-member group (`Bed` at `left: 384`, `Fridge` at `left: 923`) plus `Bathtub` (`left: 323`), and pressed `Alt+a`. Both `Bed` and `Fridge` aligned individually to `left: 323`, breaking the group's internal layout. |

---

## F. Pointer — PASS

| Check | Result | What we saw |
| :--- | :--- | :--- |
| `Shift+drag` locks to one axis | PASS | Dragged `Fridge` `(+80, +25)` with `Shift`. `X` changed from `694,8` to `784`, while `Y` stayed locked at `207,8`. |
| Smart guides & `Option` mid-drag | PASS | Dragged `Bathtub` (`left: 324`) to `377`, near `Bed` (`left: 379`). `Bathtub` snapped to `379`, `<line>` count rose `164 -> 170`, and `cm` distance labels appeared (`24 cm`, `206 cm`, `116 cm`, `109 cm`). Holding `Alt` mid-drag un-snapped to `377` and removed the guide line (`170 -> 168`). |

---

## G. Console — PASS

| Check | Result | What we saw |
| :--- | :--- | :--- |
| Console errors | PASS | `list_console_messages(types=["error"])` returned 0 error messages. (1 browser `[issue]` appeared for form field `id`/`name` attributes.) |

---

## FAILs and Steps to Reproduce

1. **`Cmd+'` does not toggle the grid (Section E)**
   - **Steps:** Open `http://localhost:8788`, press `2` for Design mode, focus the canvas, and press `Cmd+'`.
   - **Expected:** The background grid toggles off/on.
   - **Actual:** Nothing changes in the SVG (`35512` chars, `164` `<line>` elements remain visible).

2. **Align left (`Option+A`) breaks a group's internal layout when mixed with another item (Section E)**
   - **Steps:** Group 2 items at different X positions (`Bed` at `left: 384`, `Fridge` at `left: 923`), Shift-click a 3rd item (`Bathtub` at `left: 323`), and press `Option+A`.
   - **Expected:** The group moves as a single unit so its leftmost edge aligns with `323` while `Fridge` keeps its relative X offset from `Bed`.
   - **Actual:** Both `Bed` and `Fridge` snap individually to `left: 323`, breaking the group's internal layout.

3. **`Ctrl+Option+V` distribute vertically via real key press on macOS (Section E — PARTIAL)**
   - **Steps:** Select 3 items in Design mode and press `Ctrl+Option+V`.
   - **Expected:** The 3 items distribute evenly on the vertical axis.
   - **Actual:** Real key press `Control+Alt+v` in Chrome did nothing (likely macOS Option+V character mapping), whereas a synthetic `KeyboardEvent` with `key: 'v', code: 'KeyV', ctrlKey: true, altKey: true` distributed them vertically.

---

## Re-test after fixes

- **Build proof (`?` cheat sheet):** `Distribute vertically` (`⌃⌥V`) and `Show / hide grid (Plan mode)` (`⌘'`) are both shown after unregistering the service worker, clearing caches, and hard-reloading `http://localhost:8788`.

| Check | Result | What you saw |
| :--- | :--- | :--- |
| Typecheck & unit tests | PASS | `npx tsc -b` exited `0`; `npx vitest run` passed `71` test files (`1031` tests). |
| Build proof (`?` cheat sheet) | PASS | Cheat sheet showed `Distribute vertically` (`⌃⌥V`) and `Show / hide grid (Plan mode)` (`⌘'`). |
| a. Group align left (`Option+A`) | PASS | Grouped `Bed` (`left: 404`) + `Fridge` (`left: 943`, offset `539 px`) via `Meta+g`, Shift-clicked `Bathtub` (`left: 323`), pressed `Alt+a`. Group moved as one block to `Bed` `left: 323` and `Fridge` `left: 862` (offset `539 px` kept). |
| b. Distribute H & V (`Ctrl+Option+H` / `V`) | PASS | On 3 separate items, `Control+Alt+h` distributed horizontally (`323..493`, `638..798`, `943..1127`, `145 px` gaps); real `Control+Alt+v` distributed vertically (`264..448`, `457..532`, `540..740`). |
| c. Copy/paste color (`Option+Cmd+C` / `V`) | PASS | Copied `#9c8669` from `Bed` (`Alt+Meta+c`) and pasted (`Alt+Meta+v`) onto 3 `#4b5563` items. All 3 changed to `#9c8669` and stayed at `(943, 264)`, `(323, 457)`, `(384, 520)` (no distribute). |
| d. Plan mode grid toggle (`Cmd+'`) | PASS | In Plan mode (`1`), `Meta+'` hid the grid (`<line>` `185 -> 175`, `<pattern>` `2 -> 1`, `<rect>` `39 -> 36`); pressing `Meta+'` again restored it (`175 -> 185`, `1 -> 2`, `36 -> 39`). |
| e. Regression (`Cmd+C/V`, `Option+H`, `Shift+H`) | PASS | `Alt+h` aligned 3 items to `cx: 725`; `Shift+h` flipped `Bathtub` shape to `scale(-1 1)`; `Meta+c` / `Meta+v` pasted a copy (item count `6 -> 7`). |
| f. Console errors (`error\|Error`) | PASS | `list_console_messages` returned `0` error messages (only 1 `[issue]` for form field `id`/`name`). |
