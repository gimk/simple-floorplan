# UI Test Report 2 — Simple Floorplan

**Date:** 2026-11-22  
**Target:** `http://localhost:8788` (local Cloudflare Worker + API + local DB, no passcode)  
**Viewports:** Desktop `1440x900`, Narrow/Phone `390x844` (browser minimum `innerWidth: 500`)  
**Themes:** Light and Dark  

## Summary

- **Pass:** 13
- **Fail:** 1
- **Could not test:** 0
- **Total:** 14

## Test Results

| ID | Feature | Step | Expected | Actual | Result | Severity | Evidence | Suspected file |
|---|---|---|---|---|---|---|---|---|
| T2-1 | Sidebar | Click Inspect / Plan tabs and press `ArrowLeft`; scroll sidebar; collapse "Reference surfaces" and reload page. | Tabs switch by click and arrow keys; tab bar stays at top; collapsed state persists after reload. | Plan tab selected on click; `ArrowLeft` switched back to Inspect; tablist stayed at `top: 72px` when `scrollTop: 132`; `Reference surfaces` stayed collapsed after reload (`localStorage` `sfp.sidebar.sections: {"apt-refs":false}`). | Pass | — | DOM rect `beforeTop: 72, afterTop: 72`; `localStorage` check after reload. | — |
| T2-2 | Sidebar | Select room `Séjour (SE)`, then wall `SE-1`, then click `Séjour (SE)` and `Apartment` in breadcrumb. | Breadcrumb shows `Apartment › Séjour (SE) › Wall SE-1`; each click navigates up one level. | Breadcrumb showed `["Apartment","Séjour (SE)","Wall SE-1"]`; clicking `Séjour (SE)` showed Room region; clicking `Apartment` cleared selection. | Pass | — | `nav[aria-label="Selection"]` button texts and region presence. | — |
| T2-3 | Sidebar | Inspect room `Séjour (SE)`. | Stats (area, perimeter, volume, ceiling), walls list, elements list (click selects), measured lengths section. | Showed `Area 28,67 m²`, `Perimeter 2340 cm`, `Volume —`, `Ceiling —`; `Walls` list (`SE-1`..`SE-6`); `Elements` list (`Door · Single swing SE-3 80 cm` after door placement); `Measured lengths` section. | Pass | — | Snapshot + DOM text of `Room`, `Walls`, `Elements`, `Measured lengths` regions. | — |
| T2-4 | Sidebar | In Wall inspector (`SE-1`), switch type, enter `12,5` + `Enter` in Thickness, enter `450,5` + `Esc` in Length, check `"On this wall"` on `SE-3`. | Type switches; comma decimals save on `Enter`; `Esc` reverts draft; `"On this wall"` lists wall elements. | `Bearing` became `aria-pressed="true"`; Thickness saved `12,5` (`undoDisabled: false`); invalid `1012,5` showed `aria-invalid="true"` and reverted to `10` on `Esc`; Length reverted to `440` on `Esc`; `SE-3` showed `Door · Single swing @75 cm 80 cm`. | Pass | — | DOM input values, `aria-invalid`, `aria-pressed`, `[aria-label="On this wall"]`. | — |
| T2-5 | Sidebar | Place and select Door, Tape, and Pin. | Element, Tape, and Pin inspectors open with breadcrumb and header Delete button. | Element (`Door · wall SE-3 (230 cm)`), Tape (`Drawn length 200,5 cm`, `Real length`, `Note`), and Pin (`Pin`, `Pin note`, `Add photo`) inspectors opened with Delete buttons. | Pass | — | Snapshot + DOM inspection of each inspector region. | — |
| T2-6 | Door rule | On shared wall `SE-3` (`Séjour` / `Cuisine`), set Door swing to `Out`, then click Undo. | Door moves to neighbour room (`Cuisine`, `CU-1`) with swing `In`; Undo returns it to `Séjour` (`SE-3`). | Breadcrumb changed to `["Apartment","Cuisine (CU)","Element Door"]`, heading to `Door · wall CU-1 (230 cm)`, `In` pressed, `Hinge` flipped to `End`. Undo restored `Séjour (SE)` and `SE-3`. | Pass | — | Breadcrumb, heading, `[aria-label^="Door on wall"]`, `aria-pressed` states. | — |
| T2-7 | Door rule (Measure) | Switch to Measuring Mode (`?mode=measure`) and inspect `Séjour` and `Cuisine`. | Door is editable in `Séjour` (room it opens into) and dashed in `Cuisine`. | `Séjour` showed editable `Type` select (`Door`); `Cuisine` had no editable select and rendered dashed SVG lines (`stroke-dasharray="4 3"` and `"5 4"`). | Pass | — | DOM query on `[aria-label="Séjour"]` and `[aria-label="Cuisine"]` SVGs. | — |
| T2-8 | Clearance check | Place Radiator on `SE-3` clashing with Door; check canvas, Apartment `"Clearance"` list, row click, and `"Clearance clashes"` layer toggle. | Red clash area on canvas; `"Clearance"` list in Apartment inspector; row selects element; layer toggle hides clash. | `<g data-layer="clashes">` rendered on canvas; Apartment showed `"Clearance 1 clash Door SE-3 hits radiator SE-3"`; clicking row selected `["Apartment","Séjour (SE)","Element Door"]`; unchecking `"Clearance clashes"` removed `<g data-layer="clashes">`. | Pass | — | DOM inspection of `[data-layer="clashes"]`, `[aria-label*="Clearance"]`, and breadcrumb. | — |
| T2-9 | Renovation | Set `SE-3` to Demolish; set `SE-1` to Bearing + Demolish; set `SE-2` to New; check Before/After/Both and Apartment panel; Undo. | Bearing demolish shows strong warning; After merges rooms; Apartment shows Before/After areas; Undo restores. | `SE-1` showed `"STRUCTURAL: bearing wall marked for demolition"`; `Before` had 12 rooms, `After` merged to 10 rooms (`"Séjour + Cuisine + Terrasse 47,80 m²"`), `Both` had 12 rooms; Apartment showed `"Before: 106,17 m² in 11 rooms · After: 115,92 m² in 10 rooms"`; Undo restored. | Pass | — | DOM text of `Wall SE-1`, `Apartment`, and SVG room labels in Before/After/Both. | — |
| T2-10 | Photo marks | Create Pin, upload generated PNG (`1308 B`), open Annotate, draw arrow with `123,5` cm, draw 2nd arrow linked to `SE-1`, draw & delete 3rd arrow, close; check Measuring Mode and Survey CSV. | Thumbnail shows `2` marks; Measuring Mode pins section shows `2` marks and opens Annotate; Survey CSV includes marks. | Pin thumbnail badge showed `2`; Measuring Mode expanded pin showed `Photo 1 · 2 marks`; Survey CSV contained `pin,room,photo index,value cm,label,note`, `1,SE,1,123.5,,`, and `1,SE,1,440,SE-1,`. | Pass | — | DOM text of Annotate dialog, Pin thumbnail, Measuring Mode pin card, and intercepted CSV blob. | — |
| T2-11 | Share link (UI) | Wait for `"All saved online"`, open Plan tab → Share → click `"Create read-only link"`. | Creates and displays a copyable read-only link. | `"Create read-only link"` button was disabled (`createBtnDisabled: true`) with message `"Enter your passcode (top bar) to manage share links: creating one needs admin access."`, because `api.hasPasscode()` is `false` on a no-passcode local server. | Fail | High | `[aria-label="Share"]` `innerText` and `button.disabled === true`; `POST /api/tokens` succeeded with `201` when called directly. | [SharePanel.tsx](file:///Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/src/features/share/SharePanel.tsx#L20-L38) |
| T2-12 | Share viewer | Open `/share#<token>` (token created via `POST /api/tokens`) and click `SVG`, `PDF`, `Survey CSV`, `DXF` download buttons. | Shows title, plan drawing, rooms with areas/✓ legend, openings, and working downloads without errors. | Rendered `Demo apartment · read-only`, SVG plan image, 12 rooms (`Indoor total 106,17 m²`, `Outdoor 9,75 m²`), `Openings and fixtures` (`SE-2`, `CU-1`), and all 4 download buttons ran with zero console errors. | Pass | — | Page snapshot of `/share#sfp_...` and `list_console_messages` (0 errors). | — |
| T2-13 | Share viewer (revoked / missing) | Revoke token via `DELETE /api/tokens/:id` and reload `/share#<token>`; also open `/share` without token. | Clear revoked/invalid message when revoked; clear incomplete-link message without token. | Revoked reload showed `"This link no longer works"` / `"It was revoked or it is not valid. Ask the plan owner for a new link."`. `/share` without token showed `"This link is incomplete"`. | Pass | — | Page snapshots of `/share#...` after revoke and `/share`. | — |
| T2-14 | Responsive & Theme | Toggle Light/Dark theme; resize to phone `390x844` (browser `innerWidth: 500`) and check Edit drawer + Measuring Mode. | Dark surfaces apply cleanly; drawer opens on phone; no horizontal overflow. | Dark mode applied (`body` `rgb(18, 22, 27)`, `aside` `rgb(27, 33, 40)`); sidebar drawer opened at `width: 320, left: 180`; `overflowX: false` in both Edit and Measuring Mode. | Pass | — | `getComputedStyle`, `getBoundingClientRect`, `scrollWidth <= innerWidth`. | — |

## Console Errors & Warnings

- **Main app (`http://localhost:8788/?mode=edit` and `?mode=measure`):**
  - Errors: `0`
  - Warnings: `0`
  - DevTools Issues: `1` (`No label associated with a form field (count: 20)`)
- **Share viewer (`http://localhost:8788/share`):**
  - Valid token & downloads: `0` errors, `0` warnings.
  - Revoked token reload: `1` expected network error (`Failed to load resource: the server responded with a status of 401 (Unauthorized)` from `/api/share/whoami`).

## Re-test after fixes

- **Checks & Build:**
  - `npx tsc -b`: pass (exit `0`).
  - `npx tsc -p functions --noEmit`: pass (exit `0`).
  - `npx vitest run`: `55` test files passed, `615` tests passed.
  - `npm run build`: pass; `http://localhost:8788` served the new `./dist` bundle (`/assets/index-ChgqNKXI.js`).
- **Form Labels (Chrome DevTools `Audits` + DOM check):**
  - `http://localhost:8788/?mode=measure` (demo apartment loaded, `87` controls): `0` unlabelled controls, `0` orphan `<label>` elements, `0` Chrome DevTools form issues.
  - `http://localhost:8788/?mode=edit` (Inspect and Plan tabs checked, `19` controls): `0` unlabelled controls, `0` orphan `<label>` elements, `0` Chrome DevTools form issues.
  - Fixes applied in:
    - [FieldRow.tsx](file:///Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/src/shell/panel/FieldRow.tsx) (render `<span>` instead of an unassociated `<label>` when `htmlFor` is omitted)
    - [index.tsx](file:///Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/src/features/background/index.tsx) (`aria-label` on `bgFile`, `htmlFor`/`id` for `bg-opacity` and `bg-rotation`)
    - [index.tsx](file:///Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/src/features/annotations/index.tsx) (`htmlFor`/`id` for `tape-real-length` and `tape-note`)
    - [PinEditor.tsx](file:///Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/src/features/annotations/PinEditor.tsx) (`aria-label` on `pinPhotos`)
    - [PhotoSketch.tsx](file:///Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/src/features/photosketch/PhotoSketch.tsx) (`htmlFor`/`id` for `mark-value`, `mark-label`, `mark-note`)
- **T2-11 (Share link UI):** **Pass**
  - Sync badge showed `"All saved online · 11:43 PM"`.
  - Plan tab → Share → `"Create read-only link"` was enabled (`disabled: false`) and created `http://localhost:8788/share#sfp_...`.
  - Opening the link in a new tab rendered `"Demo apartment"` with the SVG plan (`hasSvg: true`).
  - Clicking Revoke in the Share panel and reloading the viewer tab showed `"This link no longer works"` / `"It was revoked or it is not valid. Ask the plan owner for a new link."`.
