# UI Test Report: Solver On/Off

Date: 2026-11-25
URL: `http://localhost:8788/`
Test projects: `Solver UI Test` (demo apartment), `Solver Draw Test` (drawn rectangle room + built-in storage)
Viewports: Desktop (`1440 x 900`), Phone (`390 x 844`, mobile/touch emulation, dark mode)
Browser console errors: Zero app errors (only Chromium form-field `id`/`name` issues).

## Test Results

| Test | Result | Notes |
| --- | --- | --- |
| 1. Solve tab | PASS | `Solver` switch is at the top of the Solve tab and is Off by default on both `Solver UI Test` (demo) and `Solver Draw Test` (new drawn project). Off status text: `"Off: the plan shows estimated and measured values only."` No `"Solve whole plan"`, preview block, or `"Apply measured lengths to all rooms"` button. The `?` button (`About the solver`) explains grey = estimated on the plan, green = measured, purple = solved. |
| 2. Measuring Mode (Solver Off) | PASS | Top banner: `"Solver off. Your values change the plan only when you apply them (button at the bottom)."` Legend shows `Plan`, `Measured`, `Solved` with `?` tip (`What the colours mean`). Typing `250` into `EN-1` (plan `240`), `238` into `EN-2` (plan `248`), `67` into `EN-3` (plan `64`), and `140` into `EN-4` (plan `139`) does not move geometry while typing or after leaving the field (`W1` stays `250 cm`). Field lines show `"Plan 240 · 10 cm shorter than measured · check this value"`, `"Plan 248 · 10 cm longer than measured · check this value"`, and `"Plan 139 · 1 cm shorter than measured"` (grey, `oklch(0.704 0.04 256.788)`). Clicking `"Apply measured values to the plan"` moves walls (`W1`: `250 → 260 cm`, `W2`: `258 → 248 cm`) and shows toast `"Applied to 1 room."` One Undo restores `W1 = 250 cm`, `W2 = 258 cm`. |
| 3. Solver On (Solve tab) | PASS | Plan updates (`W1..W6`: `260, 250, 65.5, 141.5, 192.5, 391 cm`). Status: `"Solved just now · 10 changes · average mismatch 0 cm"`. `Changes` shows purple rows (`violet-400`, `oklch(0.702 0.183 293.541)`), e.g. `"WC-2 moved 5,5 cm west (length 66 → 69,5 cm)"`. Hovering `WC-2` highlights it on the plan and shows a dashed purple line (`stroke-dasharray="7 5"`, `stroke-violet-600 dark:stroke-violet-400`) at its old position. Plan dimensions: solved walls purple (`oklch(0.702 0.183 293.541)`), measured green (`oklch(0.765 0.177 163.223)`), others grey (`oklch(0.869 0.022 252.894)`). Room card (`Entrée`) shows `"Average mismatch 1,5 cm over 4 measured values."` and purple solved lengths (`EN-5`: `182,5`, `EN-6`: `381`). |
| 4. Revoke and Restore | PASS | Clicking `Revoke` on `EN-6 / CO-4 / WC-3` moves it to `Kept walls` as `": kept at plan value (revoked)"`, restores its position (`8` changes remain), and `Restore` brings all `10` changes back (`W1..W6` return to `260, 250, 65.5, 141.5, 192.5, 391 cm`). |
| 5. Solver Off then On again | PASS | Turning Solver Off restores exact previous geometry (`W1..W6`: `250, 258, 64, 139, 186, 397 cm`). Turning Solver On again gives the exact same result (`260, 250, 65.5, 141.5, 192.5, 391 cm`). |
| 6. Measuring Mode (Solver On) | PASS | Top banner is purple (`oklch(0.702 0.183 293.541)` on `oklch(0.283 0.141 291.089)`): `"Solver on. It fits the plan to your values when you leave Measuring Mode."` Changing `EN-1` does not move `W1` (`260 cm`) while in Measuring Mode. Leaving Measuring Mode re-solves the plan. One Undo restores `W1` to `260 cm`. |
| 7. Edit Mode drag (Solver On) | PASS | Dragging `W5` down `25 px` (`y=663.62 → 688.62`) keeps `W5` at `688.62`, re-solves (`6` changes), and adds `"EN-5: kept at plan value (you edited it)"` to `Kept walls`. One Undo restores `y=663.62` and clears `Kept walls`. Dragging `W5` down `25 px` and back to start with `Alt` before release keeps `y=663.62` and adds no `(you edited it)` row. |
| 8. Built-in storage on moved wall | PASS | In `Solver Draw Test` (`steps/290/media_0.png`, `steps/294/media_0.png`), `Room 1` (`190 x 140 cm`) with `Storage (R2)` (`100 x 60 cm`) on `R1-1` (`W5/W6/W7/W8/W9`) and `R1-4` measured `160`: toggling Solver On and Off keeps `Storage (R2)` attached to its wall with no gap. |
| 9. Dark mode and phone width (`390 x 844`) | FAIL | In dark mode at `390 x 844`, the Solve drawer (`steps/222/media_0.png`) has zero horizontal overflow (`scrollWidth = 390`) and readable purple switch and text. However, in mobile Measuring Mode (`steps/241/media_0.png`), the `"Solver on..."` banner and the `Plan / Measured / Solved` legend dots render in plain black instead of grey, green, and purple. |
| 10. Console errors | PASS | Zero app errors across the full test run. |
| 11. Reload page | PASS | Reloading `Solver UI Test` keeps Solver On (`checked`), `Changes` (`8` rows), and `Kept walls` (`EN-6 / CO-4 / WC-3: kept at plan value (revoked)`). |

## Failures

1. **Mobile Measuring Mode loses banner and legend colors (`390 x 844`)**:
   - **Steps to reproduce**:
     1. Open `Solver UI Test` with Solver On.
     2. Emulate phone viewport `390 x 844` (mobile/touch, dark mode) or open Measuring Mode on a phone width.
     3. Open Measuring Mode (`Switch to Measuring Mode`).
   - **Expected**: Purple banner for Solver On, and grey / green / purple dots for `Plan / Measured / Solved` in the legend.
   - **Actual**: Mobile Measuring Mode defaults to high-contrast black-on-white mode (yellow sun button active), so the banner border/text and all three legend dots (`Plan`, `Measured`, `Solved`) render in black (`steps/241/media_0.png`).

## Observations

1. **Wall card (`StoredWallCard`) color**: When selecting `Wall W5` (`EN-5`, solved to `182,5 cm` but unmeasured), the Wall card showed no purple or green text, whereas the Room card (`Entrée`) and plan dimensions showed `182,5` in purple.
2. **Snap on drag-back without Alt**: In Edit Mode with Solver On, dragging `W5` (at a half-cm solved position `y=663.62`) and returning the pointer to `y=663.62` without holding `Alt` snapped `W5` to `y=660.78`, which treated it as an edit and added `(you edited it)`. Holding `Alt` kept the exact start position and produced no `(you edited it)` row.
3. **Keyboard Undo in headless Chrome**: Synthetic `Control+z` and `Meta+z` via `press_key` did not trigger Undo while focus was on the `"Apply measured values to the plan"` button; clicking the Undo button in the top bar undid the action in one step.
4. **Toast overlap on mobile Measuring Mode**: At `390 x 844` (`steps/241/media_0.png`), the `"Plan converted to walls..."` toast overlapped the Entrée room diagram.
