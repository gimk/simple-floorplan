# UI Test Report: Solver On/Off (Re-Test 2)

Date: 2026-11-25
URL: `http://localhost:8788/`
Test projects: `Solver Re-Test Demo` (demo apartment), `Solver Re-Test Draw` (drawn rectangle room `Room 1` + built-in `Storage`)
Viewports: Desktop (`1440 x 900`), Phone (`390 x 844`, dark theme and Sunlight high-contrast mode)
Browser console errors: Zero app errors (only 1 Chromium form-field `id`/`name` issue, count 37).

## Test Results

| Test | Result | Notes |
| --- | --- | --- |
| A.1 Phone 390x844 Measuring Mode (Sunlight ON & OFF) | FAIL | Sunlight OFF (`steps/244/media_0.png`, `steps/250/media_0.png`): purple banner, grey/green/purple legend dots, and purple/green field lines work. Sunlight ON (`steps/229/media_0.png`, `steps/255/media_0.png`): banner border/text, all 3 legend dots, and `Solved ...` / `✓ measured` field lines all render in plain black instead of dark purple / grey / green. |
| A.2 Revoke shared wall (`EN-6 / CO-4 / WC-3`) | PASS | `Kept walls` shows the full label: `"EN-6 / CO-4 / WC-3: kept at plan value (revoked)"` (note: omits `"position"` prefix, but full wall label is present). |
| A.3 Average mismatch consistency (Solve tab vs room card) | FAIL | On `Solver Re-Test Demo`: Solve tab header shows `"average mismatch 0 cm"` while Solve tab Progress shows `"average mismatch 2,3 cm."` and Entrée room card shows `"Average mismatch 1,3 cm over 4 measured values."` On `Solver Re-Test Draw` (1 room + empty storage): Solve tab header shows `"average mismatch 7,1 cm"` while both Solve tab Progress and Room 1 card show `"12,9 cm"`. |
| A.4 Solved unmeasured wall in Wall card (`Wall W5`) | FAIL | `EN-5` was moved by solver (`0,5 cm north, length 186 → 189,5 cm`) and has no measured value. Selecting `Wall W5` (`steps/90/media_0.png`) shows no purple `"Solved length X cm (plan was Y cm)"` or `"Solver moved it N cm <direction>"` line. |
| A.5 Measuring Mode (Solver Off): wall thickness | FAIL | Typing `22` into `EN-1-T · thickness` and `18` into `EN-2-T · thickness` immediately changed the plan thickness (`"Plan 22 · matches measured"`, `"Plan 18 · matches measured"`) before clicking `"Apply measured values to the plan"`. |
| A.6 Edit Mode (Solver On): type measured value in wall card | FAIL | Typing `190` / `210` into `Measured EN-5 (EN, side A)` on `Wall W5` card and pressing Enter / Tab did not re-solve the plan within 1.5 s (`W5` stayed `193 cm`, `W1` stayed `264 cm`, `W6` stayed `395 cm`). |
| A.7 Regression of scenarios 1-8 and 11 | PASS | Scenarios 1–8 and 11 passed: Solver Off by default; Measuring Mode banner/legend and no geometry move while typing lengths; Apply moves walls and one Undo restores; Solver Off/On exact round trip; Revoke/Restore; Measuring Mode (Solver On) holds geometry until leave, re-solves on leave, one Undo restores; Edit Mode drag adds `(you edited it)` and one Undo restores; `Storage (R2)` stays attached to its wall (`steps/347/media_0.png`); Reload keeps Solver On and `Changes`. |
| C. Console errors | PASS | Zero app errors across the full session. |

## Failures

1. **A.1 — Sunlight high-contrast mode overrides semantic colors to plain black (`390 x 844`)**:
   - **Steps to reproduce**:
     1. Open `Solver Re-Test Demo` with Solver On and measured values in `Entrée`.
     2. Emulate `390 x 844` and open Measuring Mode (`http://localhost:8788/?mode=measure`).
     3. Ensure Sunlight high-contrast mode (yellow sun button) is ON.
   - **Expected**: Banner text/border dark purple, legend dots grey/green/purple, field lines keep purple/green colors.
   - **Actual**: Banner text/border, all three legend dots (`Plan`, `Measured`, `Solved`), and field lines (`Solved ...`, `✓ measured`) render in plain black (`steps/229/media_0.png`, `steps/255/media_0.png`).

2. **A.3 — Solve tab header `"average mismatch"` disagrees with Progress and Room card**:
   - **Steps to reproduce**:
     1. On `Solver Re-Test Demo`, measure `EN-1..EN-4` and turn Solver On. Compare Solve tab header vs Progress vs Entrée card.
     2. On `Solver Re-Test Draw` (one room `Room 1` + `Storage`), measure `R1-4 = 210`, `R1-5 = 290`, `R1-6 = 190` and turn Solver On.
   - **Expected**: One-room plan shows the same number in Solve tab and Room 1 card; demo plan shows a plausible non-zero whole-plan number.
   - **Actual**: Demo shows `0 cm` in Solve tab header vs `2,3 cm` in Progress and `1,3 cm` in Entrée card. One-room plan shows `7,1 cm` in Solve tab header vs `12,9 cm` in both Progress and Room 1 card.

3. **A.4 — Wall card omits solved length/move line for solved unmeasured wall**:
   - **Steps to reproduce**:
     1. On `Solver Re-Test Demo` with Solver On, confirm `EN-5` is in `Changes` (`EN-5 moved 0,5 cm north (length 186 → 189,5 cm)`) and has no measured value.
     2. Select `Wall W5` (`EN-5`).
   - **Expected**: Wall card shows a purple line `"Solved length X cm (plan was Y cm)"` or `"Solver moved it N cm <direction>"`.
   - **Actual**: No purple solved line appears anywhere on the `Wall W5` card (`steps/90/media_0.png`).

4. **A.5 — Measuring Mode (Solver Off) applies wall thickness immediately while typing**:
   - **Steps to reproduce**:
     1. Open `Solver Re-Test Demo` in Measuring Mode with Solver Off.
     2. Expand `Wall thickness (optional)` in `Entrée` and type `22` into `EN-1-T · thickness`.
   - **Expected**: Plan thickness does not change until `"Apply measured values to the plan"` is clicked.
   - **Actual**: Plan thickness updates immediately to `22` (`"Plan 22 · matches measured"`).

5. **A.6 — Edit Mode (Solver On) does not re-solve when typing a measured value in a wall card**:
   - **Steps to reproduce**:
     1. On `Solver Re-Test Demo` in Edit Mode with Solver On, select `Wall W5`.
     2. Type `190` (or `210`) into `Measured EN-5 (EN, side A)` and press Enter / Tab; wait 1.5 s.
   - **Expected**: Plan re-solves within ~1 s.
   - **Actual**: Plan geometry does not change (`W5` stays `193 cm`, `W1` stays `264 cm`, `W6` stays `395 cm`).

## Visual Review Issues

Note: Edit Mode has only a dark theme (`rgb(18, 22, 27)`); Measuring Mode has dark mode and Sunlight high-contrast light mode. Horizontal scroll is `0` on both `1440 x 900` (`scrollWidth = 1440`) and `390 x 844` (`scrollWidth = 390`).

| Severity | Area & Screenshot | Issue | Concrete Fix Suggestion |
| --- | --- | --- | --- |
| High | Desktop Measuring Mode (`steps/130/media_0.png`) | Top border and padding of the purple `"Solver on..."` banner are clipped by the sticky `All \| Missing \| Flagged` filter bar when scrolled. | Move the Solver banner outside the scroll container or add top clearance below the sticky filter bar. |
| High | Phone Measuring Mode Sunlight ON (`steps/229/media_0.png`, `steps/255/media_0.png`) | Banner, legend dots, and field lines lose their purple/green/grey colors and render in plain black. | Exempt semantic status classes (`SOLVED_*`, `MEASURED_*`, `ESTIMATED_*`) or define dark high-contrast purple/green/grey overrides in Sunlight mode. |
| Medium | Desktop Measuring Mode (`steps/31/media_0.png`, `steps/130/media_0.png`) | `"EN-H · ceiling height"` truncates to `"EN-H · ceilin..."` and `"to measure"` wraps onto 2 lines in the 2-column grid. | Use `col-span-2` for the ceiling height row or shorten the label to `"EN-H · ceiling"`. |
| Medium | Phone Measuring Mode (`steps/250/media_0.png`, `steps/255/media_0.png`) | In the Entrée diagram, `"EN-3 · 67"` and `"EN-4 · 140"` labels overlap at the inner L-corner. | Offset labels outward or stagger label positions on short adjacent segments (< 80 cm). |
| Medium | Desktop & Phone (`steps/72/media_0.png`, `steps/215/media_0.png`, `steps/229/media_0.png`) | `"Update available [Reload] [Later]"` toast overlaps the zoom bar on desktop and room buttons / `Kept walls` on phone. | Anchor the update toast higher or at top-right with `bottom-16` clearance above the bottom controls. |
| Low | Desktop Room card (`steps/347/media_0.png`) | `"Diagonal R1-D · corners 1 → 5"` wraps onto 3 lines next to the input box. | Stack the diagonal label above the input or add `whitespace-nowrap` to `"R1-D"`. |
| Low | Desktop Plan at fit zoom (`steps/195/media_0.png`) | Wall index badges (`[3]`, `[4]`) overlap `"CO Couloir"` and `"DG Dégagement"` room names. | Hide wall index badges below a zoom threshold or offset them toward the wall outer face. |

## Observations

1. **Undo after wall-card edit**: After typing into `Measured EN-5 (EN, side A)` in Edit Mode (`Wall W5` card), clicking top-bar `Undo` changed `W5` from `193 cm` to `189,5 cm` (restoring the previous state cleanly).
2. **Kept walls wording**: Revoking `EN-6 / CO-4 / WC-3` displays `"EN-6 / CO-4 / WC-3: kept at plan value (revoked)"` with the full shared-wall label.


## Re-test with fresh build (service worker cleared)

Cache reset verification: unregistered the service worker and deleted 2 caches, then hard-reloaded `http://localhost:8788/`. On `Solver Re-Test Draw`, revoking `R1-6` showed `"R1-6 position: kept at plan value (revoked)"` in `Kept walls`.

New test projects used: `Solver Re-Test 3 Draw` (drawn one-room rectangle `Room 1`) and `Solver Re-Test 3 Demo` (demo apartment).

| Test | Result | Notes |
| --- | --- | --- |
| A.1 Phone 390x844 Measuring Mode (Sunlight ON, Solver On) | PASS | Sunlight `aria-pressed="true"`. Banner text and border: `rgb(91, 33, 182)` (dark purple). Legend dots and labels: `Plan` `rgb(71, 85, 105)` (grey), `Measured` `rgb(4, 120, 87)` (green), `Solved` `rgb(91, 33, 182)` (dark purple). Field lines keep color: `"Solved ..."` `rgb(91, 33, 182)` and `"measured"` `rgb(4, 120, 87)` (`steps/218/media_0.png`). |
| A.3 Average mismatch consistency (Solve tab vs room card) | PASS | `Solver Re-Test 3 Draw` (1 room, `R1-1=250`, `R1-2=185`, `R1-3=235`): Solve tab status `6,1 cm`, Progress line `6,1 cm`, `Room 1` card `6,1 cm over 3 measured values`. `Solver Re-Test 3 Demo` (`EN-1=245`, `EN-2=250`, `EN-3=68`, `EN-4=142`): Solve tab status `1,5 cm`, Progress line `1,5 cm`, `Entrée` card `1,5 cm over 4 measured values`. |
| A.4 Solved unmeasured wall in Wall card (`Wall W5`) | PASS | `EN-5` had no measured value and was in `Changes` (`EN-5 moved 4,5 cm south (length 186 → 187,5 cm)`). `Wall W5` card showed `"Solved length 187,5 cm (plan was 186 cm)"` in purple (`oklch(0.702 0.183 293.541)`). |
| A.5 Measuring Mode (Solver Off): wall thickness | PASS | Typing `22` into `EN-1-T · thickness` kept plan thickness at `10` (`"Plan 10 · 12 cm shorter than measured"`). Clicking `"Apply measured values to the plan"` updated it to `22` (`"Plan 22 · matches measured"`). One `Undo` reverted it to `10`. |
| A.6 Edit Mode (Solver On): type measured value in wall card | PASS | On `Wall W5` card, typing `210` into `Measured EN-5 (EN, side A)` and pressing `Enter` re-solved within 1.5 s (`Wall W5` changed `187,5 cm` → `204 cm`, `"Solved length 204 cm (plan was 186 cm)"`). One top-bar `Undo` cleared `210` and reverted `Wall W5` to `186 cm` (also turning Solver Off). |
| Console errors | PASS | Zero app errors (only 1 Chromium form-field `id`/`name` issue, count 62). |

### Failures

None. All 5 re-tested items and console check passed.
