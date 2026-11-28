# UI Test Report: Multiselect, Copy Style, and Browser Shortcut/Zoom Guards

## Test Environment

- App URL: `http://localhost:8788/` (built and served with `npm run dev:api`)
- Viewport: `1440 x 900`, `devicePixelRatio: 1`, `visualViewport.scale: 1`
- Cache setup: unregistered 1 service worker, deleted 2 caches, and hard-reloaded the page.
- Build proof: Shift-clicked two walls in Plan mode and confirmed `data-selection="multi:wall:..."` and Inspect header `2 selected: 2 walls`.
- Test project: `UI test multiselect` (created with Paste JSON using a new UUID; no other projects were changed).
  - 2 rectangular rooms (`Room A` and `Room B`, `300 x 250 cm` each)
  - 1 door (`85 cm`) on the bottom wall of `Room A`
  - 1 window (`120 cm`) on the top wall of `Room B`
  - 2 furniture items (`Desk` `140 x 70 cm` and `Armchair` `85 x 85 cm`) in Design mode

## Summary Table

| # | Test | Result | Notes | Screenshot |
| --- | --- | --- | --- | --- |
| 1 | Shortcut block (`Option+Cmd+C`) | PASS | `defaultPrevented: true`, DevTools did not open | `ms-1.png` |
| 2 | Zoom block (`Ctrl+scroll`) | PASS | Panel `defaultPrevented: true`, page zoom stayed 100%, plan zoomed `1.13 -> 1.52` | `ms-2.png` |
| 3 | Plain click single-selection | PASS | Wall, room, door (Plan) and furniture (Design) single-selected | `ms-3.png` |
| 4 | Plan Shift-click 2 walls + colour + Undo | PASS | Both walls highlighted, colour applied to both, 1 `Cmd+Z` reverted both | `ms-4.png` |
| 5 | Plan mixed selection + toggle wall off | PASS | `Walls`, `Doors and windows`, `Rooms` sections shown; Shift-click removed wall | `ms-5.png` |
| 6 | Plan marquee box selection | FAIL | Plain box and Shift+box worked, but box over 2 ends of a wall selected the room instead | `ms-6.png` |
| 7 | Copy style (`Option+Cmd+C` / `Option+Cmd+V`) | PASS | Wall colour, room floor colour+pattern, door colour, furniture colour copied; door variant/size and furniture corner radius not copied | `ms-7.png` |
| 8 | Design mixed selection (room + furniture) | PASS | `Rooms` and `Furniture` sections shown (`2 selected: 1 room, 1 item`) | `ms-8.png` |
| 9 | Delete mixed selection + 1 `Cmd+Z` | PASS | Door and `Room B` deleted together; 1 `Cmd+Z` restored both | `ms-9.png` |
| 10 | `Escape` clears mixed selection | PASS | `data-selection` changed from `multi:...` to `none` | `ms-10.png` |
| 11 | Console errors and warnings | PASS (with note) | 0 errors/warnings during tests; 1 earlier `404` during `?project=ui-test-multiselect` setup | — |

## Test Details

### 1. Shortcut block — PASS
- Action: Added a bubble-phase `window` `keydown` listener for `Meta+Alt+KeyC` with nothing selected, then pressed `Meta+Alt+c` via `press_key`.
- Observed: Listener recorded `defaultPrevented: true` and Chrome DevTools did not open.

### 2. Zoom block — PASS
- Action: Dispatched a cancelable `WheelEvent` (`ctrlKey: true`, `deltaY: -100`) on `aside[aria-label="Inspect panel"]`, then dispatched a cancelable `WheelEvent` (`ctrlKey: true`, `deltaY: -120`) on `svg[data-testid="floorplan-canvas"]`.
- Observed: `window.devicePixelRatio` stayed `1` and `window.visualViewport.scale` stayed `1`. On the side panel, `defaultPrevented` was `true`. On the plan canvas, `data-zoom` increased from `1.13` to `1.31` and `1.52`.

### 3. Plain click single-selection — PASS
- Action: Plain-clicked a wall, a room, and the door in Plan mode, and a furniture item (`Desk`) in Design mode.
- Observed: `data-selection` became `wall:room-a-0001:0`, `room:room-a-0001`, `opening:3170d64c-85a4-44df-9bf4-90f68e33aaaf`, and `furniture:e8c3c5ea-30f7-4839-89ed-81ad81b691ae`.

### 4. Plan Shift-click 2 walls, set colour, and Undo — PASS
- Action: Clicked wall 0 of `Room A`, Shift-clicked wall 1 of `Room A`, clicked swatch `#b85d43`, then pressed `Meta+z` once.
- Observed: `data-selection` became `multi:wall:room-a-0001:0,wall:room-a-0001:1`, Inspect header showed `2 selected: 2 walls` with a `Walls` section, `Reset to default` became enabled after picking `#b85d43`, and became disabled again after one `Meta+z`.

### 5. Plan mixed selection and remove wall — PASS
- Action: Clicked wall 0 of `Room A`, Shift-clicked the door, and Shift-clicked `Room B`. Then Shift-clicked the wall hit line (`[data-wall="room-a-0001:0"] line[stroke="transparent"]`).
- Observed: `data-selection` became `multi:wall:room-a-0001:0,opening:3170d64c-85a4-44df-9bf4-90f68e33aaaf,room:room-b-0002` with `Walls`, `Doors and windows`, and `Rooms` sections. Shift-clicking the wall hit line removed it, leaving `multi:opening:3170d64c-85a4-44df-9bf4-90f68e33aaaf,room:room-b-0002`.

### 6. Plan marquee box selection — FAIL
- Steps to reproduce:
  1. In Plan mode, drag a plain marquee box `(310, 260)` to `(690, 590)` over `Room A`.
  2. Shift+drag a marquee box `(440, 470)` to `(560, 595)` over the door and bottom wall of `Room A`.
  3. Drag a plain marquee box `(715, 270)` to `(745, 580)` covering both ends of the left wall of `Room B` (`x=728, y=288..570`) without covering the full room.
  4. Also tested `(705, 270)` to `(728, 580)` (stopping at the wall outer edge) and `(705, 270)` to `(729, 580)` (1 px into the room).
- Expected:
  - Plain box over a room selects the room.
  - Shift+box over walls/door adds walls and openings.
  - A box that hits no full room but covers a wall's 2 ends selects that wall.
- Actual:
  - Step 1 selected `room:room-a-0001`.
  - Step 2 produced `multi:room:room-a-0001,opening:3170d64c-85a4-44df-9bf4-90f68e33aaaf`.
  - Step 3 (`715..745`) and `(705..729)` selected `room:room-b-0002` instead of the wall, because `findRoomsInBox` in `src/features/rooms/boxSelect.ts` matches any room touched by the box rather than only full rooms. Stopping at `x=728` selected `none`.

### 7. Copy style (`Option+Cmd+C` / `Option+Cmd+V`) — PASS
- Action & Observed:
  - Wall: Set wall 1 of `Room A` to `#5a7a65`, copied style, selected wall 1 of `Room B`, pasted style -> wall 1 of `Room B` got `#5a7a65`.
  - Room: In Design mode, set `Room A` floor to `Warm Wood` + `Parquet`, copied style, selected `Room B`, pasted style -> `Room B` got `Warm Wood` + `Parquet`.
  - Door: Set door to `#5c4033` and `Pocket sliding` (`85 cm`), copied style, selected window (`120 cm`, `standard`), pasted style -> window got `#5c4033` while width stayed `120` and style stayed `standard`.
  - Furniture: In Design mode, set `Desk` (corner radius `4`) to `#9e5a47`, copied style, set `Armchair` corner radius to `12`, pasted style -> `Armchair` got `#9e5a47` while corner radius stayed `12`.

### 8. Design mixed selection (room + furniture) — PASS
- Action: In Design mode, selected `Room B`, then Shift-clicked `Desk`.
- Observed: `data-selection` became `multi:room:room-b-0002,furniture:e8c3c5ea-30f7-4839-89ed-81ad81b691ae`; Inspect panel showed `2 selected: 1 room, 1 item` with `Rooms` and `Furniture` sections.

### 9. Delete on a mixed selection + Undo — PASS
- Action: In Plan mode, selected the door and Shift-clicked `Room B`, pressed `Backspace`, then pressed `Meta+z` once.
- Observed: `Backspace` deleted both (`rooms: 2 -> 1`, `openings: 2 -> 0`, `data-selection="none"`). One `Meta+z` restored both (`rooms: 2`, `openings: 2`).

### 10. `Escape` clears a mixed selection — PASS
- Action: Selected the door and Shift-clicked `Room B`, then pressed `Escape`.
- Observed: `data-selection` changed from `multi:opening:3170d64c-85a4-44df-9bf4-90f68e33aaaf,room:room-b-0002` to `none`.

### 11. Console errors and warnings — PASS (with note)
- Observed: `list_console_messages` (`error`, `warn`, preserved across navigations) showed 0 errors and 0 warnings during all 10 feature tests. One earlier error (`Failed to load resource: the server responded with a status of 404 (Not Found)`) occurred during setup when navigating to `?project=ui-test-multiselect` before creating the project via Paste JSON.
