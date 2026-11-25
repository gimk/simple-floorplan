# UI Test Report: Layers Rows, Tool Tips, and Measure Fix (`f835dff`, `6fdbabf`, `256287e`)

Date: 2026-11-25
URL: `http://localhost:8788/`
Test projects: `Layout UI Test` (demo apartment), `Tips UI Test` (new room + T-junction)
Viewports: Desktop (`1440 x 900`), Phone (`390 x 844`, mobile/touch emulation)
Browser console errors: Zero app errors (only 1 Chromium form-field `id`/`name` issue; 1 synthetic `document.dispatchEvent` test error).

## Test Results

| Test | Result | Notes |
| --- | --- | --- |
| 1. Layers rows (`f835dff`) | PASS | Labels (`SE-1`..`SE-6`) use `shrink-0 whitespace-nowrap` (`scrollW === clientW`, never cut with `...`). Rows show label + length + green check (`aria-label="Measured"`) + lock (`aria-label="Locked"`). Hover `title` shows state and type (`SE-1 · 430 cm · measured · partition · locked`). Indentation is `8 px` per level (`0 / 8 / 16 px`). Dragging right edge clamps `200..480 px`, persists across reload (`sfp.layersPanel.width`), and double-click resets to `260 px`. Phone `390 x 844`: `260x844` drawer opens cleanly, resize handle hidden (`display: none`), `scrollWidth = 390`. |
| 2. Tool tips (`6fdbabf`) | PASS | No hint bar above the tool bar. Small `?` button (`Tips for this tool`, `36x36` desktop) sits at the right end of the bar (`x=932.5..968.5`). For Wall tool, opens popover above bar (`y=553..839`) with `<kbd>` key chips (`Type a number`, `Tab`, `S`, `Enter or double-click`, `Backspace`, `Alt`) and `All shortcuts` (opens shortcuts dialog). `Esc`, outside click, and tool change close it. Hidden for Pin, Tape, and Door / window tools. In Measuring Mode, `?` sits next to zoom/view controls (`x=987..1023`) and shows `Hover a wall`. |
| 3. Measure fix (`256287e`) | PASS | Room `R1` (`290 x 190 cm`) with `R1-3` split at midpoint (`145 + 145 cm`) and T-wall `W5` (`150 cm`) shows one grouped row `R1-3+4` in Measuring Mode. Entering `310` (`+20 cm`) updates `R1-3` and `R1-4` to `155 cm` each: wall count in Layers stays `6` (no new wall), `0` warning/flagged badges, T-corner stays on the straight wall line (`y=493..503`). Undo restores `145 + 145 cm`. Setting `290` only on `R1-3` in Edit mode shows `R1-3+4` as `measured` (`290`, `Solved 290 (0)`) with no conflict. |
| 4. Console & phone `?` | PASS | Zero real app console errors. At `390 x 844` (`Wall` tool), `?` popover is `320 px` wide (`left=57`, `right=377`, `13 px` right gutter, `0` horizontal overflow). |

## Failures

None.
