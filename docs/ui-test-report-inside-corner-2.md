# UI Test Report: Outside Dimensions at Inside Corners (Retest)

Test date: 2026-11-25  
App URL: `http://localhost:8788`  
Projects tested: `Demo apartment`, `R3 test`  
Toast check: Clicked `Reload` on the `Update available` toast before the test.

## Summary

| Check | Result | Notes |
| --- | --- | --- |
| 1. Inside corners at 200%+ zoom | PASS | All 6 inside corners in `Demo apartment` (tested at `307%` zoom) and `R3 test` pass. `W14` / `W5` now ends on the outer wall faces (`186` and `209`). |
| 2. Outside (convex) corners | PASS | Unchanged. All outside corners end on the outer wall faces. |
| 3. Chain segment sums | PASS | All chain segments add up to their overall row. |
| 4. Measuring Mode facade values (`W*-E`) | PASS | All 15 of 15 facade fields match the outside row of their wall. |
| 5. Facade wall card in Edit mode | PASS | Clicked `Wall W14`: outside planned length (`209`) equals the outside row (`209`). |
| 6. No text overlap and no dims at hatched gaps | PASS | 0 overlaps at Fit (`51%`) and `100%` in `Demo apartment` and `R3 test`. 0 dims around the hatched gap. |
| 7. SVG export matches canvas | PASS | Exported SVG (`58,097` bytes) matches the canvas coordinates (`W5` at `x=499..685`, `W14` at `y=1266..1475`). |
| 8. Console errors | PASS | 0 console errors. |

## Detailed Findings

### Check 1: Inside corners at 200%+ zoom — PASS

Tested `Demo apartment` at `307%` zoom:
1. Top-left inside corner (`W28` vertical / `W26` horizontal, Terrasse / Chambre 3):
   - Horizontal row `72`: `x=163` to `x=235` (outer left face of `W28`).
   - Vertical row `75,9`: `y=165.11` to `y=241` (outer top face of `W26`).
2. Left inside corner (`W27` vertical / `W18` horizontal, Chambre 3 / Couloir):
   - Horizontal row `168`: `x=-5` to `x=163` (outer left face of `W27`).
   - Vertical row `330`: `y=241` to `y=571` (outer top face of `W18`).
3. Bottom-left inside corner (`W6` vertical / `W21` horizontal, Entrée / Couloir):
   - Horizontal chain `287` + `217` (overall `504`): ends at `x=499` (outer left face of `W6`).
   - Vertical row `235`: starts at `y=1031` (outer bottom face of `W21`).
4. Right-bottom inside corner (`W11` vertical / `W15` horizontal, Cuisine / Chambre 1):
   - Vertical chain `586,3` + `355` (overall `941,3`): ends at `y=1069` (outer top face of `W15`).
   - Horizontal row `325`: starts at `x=989` (outer right face of `W11`).
5. Top-right inside corner (`W31` vertical / `W7` horizontal, Terrasse / Séjour):
   - Vertical row `132,8`: ends at `y=127.75` (outer top face of `W7`).
   - Horizontal row `88` (hidden at `51%` and `100%`, shown at `307%` zoom): starts at `x=901` (outer right face of `W31`).
6. Bottom-middle inside corner (`W14` vertical `x=[685, 695]` / `W5` horizontal `y=[1256, 1266]`, Entrée / Sde/wc):
   - Horizontal row `186`: `x=499` to `x=685` (outer left face of `W14`).
   - Vertical row `209`: `y=1266` (outer bottom face of `W5`) to `y=1475`.

`R3 test`:
- Top row `90`: `x=80` (outer left face of `W11`) to `x=170` (outer right face of `W9`).

### Check 2: Outside (convex) corners — PASS

All outside (convex) dimension lines, ticks, and extension lines end at the outer corners of the walls:
- `Demo apartment`: `72` (`x=163`), `330` (`y=241`), `168` (`x=-5`), `460` (`y=[571, 1031]`), `406` (`y=[1069, 1475]`), `371,3` (`y=-5`), `629` (`x=[685, 1314]`), `941,3` (`y=[127.75, 1069]`), `504` (`x=[-5, 499]`).
- `R3 test`: `175` (`x=[-5, 170]`), `95` (`y=[-5, 90]`), `102,1` (`y=[-12.07, 90]`).

### Check 3: Chain segment sums — PASS

- `Demo apartment`:
  - Right vertical: `586,3 + 355 = 941,3` (overall `941,3`).
  - Bottom horizontal: `299 + 330 = 629` (overall `629`).
  - Middle-left horizontal: `287 + 217 = 504` (overall `504`).
- `R3 test`:
  - Bottom horizontal: `90 + 85 = 175` (overall `175`).

### Check 4: Measuring Mode facade values (`W*-E`) — PASS

All 15 facade fields in `Demo apartment` (`Facade · 0/15`) match their outside dimension row:

| Field | Planned length (placeholder) | Outside row | Match |
| --- | --- | --- | --- |
| `W5-E` | `186` | `186` | Yes |
| `W8-E` | `586,3` | `586,3` | Yes |
| `W13-E` | `299` | `299` | Yes |
| `W14-E` | `209` | `209` | Yes |
| `W15-E` | `325` | `325` | Yes |
| `W16-E` | `406` | `406` | Yes |
| `W17-E` | `330` | `330` | Yes |
| `W21-E` | `217` | `217` | Yes |
| `W24-E` | `287` | `287` | Yes |
| `W25-E` | `460` | `460` | Yes |
| `W27-E` | `330` | `330` | Yes |
| `W28-E` | `75,9` | `75,9` | Yes |
| `W29-E` | `340,2` | `340,2` | Yes |
| `W30-E` | `371,3` | `371,3` | Yes |
| `W31-E` | `132,8` | `132,8` | Yes |

### Check 5: Facade wall card in Edit mode — PASS

Clicked `Wall W14` in Edit mode. The `Measured W14-E (outside face)` field shows placeholder `209`, which equals the outside row `209`.

### Check 6: No overlaps and no dims around hatched gaps — PASS

- `Demo apartment` at Fit (`51%`, 19 texts) and `100%` (22 texts): 0 overlapping outside dimension texts.
- `R3 test` at `100%` (6 texts): 0 overlapping outside dimension texts.
- Hatched gap in `Demo apartment` (`M504 798 L544 798 L544 864 L504 864 Z`): 0 outside dimension lines or texts around the gap.

### Check 7: SVG export — PASS

Exported SVG from `Demo apartment` (`58,097` bytes) matches the canvas outside dimension geometry:
- `W5` extension lines (`data-dim-ext="W5:L:0"` and `W5:L:1`) are at `x=499` and `x=685`.
- `W14` extension lines (`data-dim-ext="W14:L:0"` and `W14:L:1`) are at `y=1266` and `y=1475`, with text `W14-E 209`.
- Note: With `Show survey labels` enabled, the `W5-E 186` text label is hidden by overlap-avoidance next to `W14-E 209`, while its dimension line, ticks, and extension lines at `x=499..685` are present.

### Check 8: Console errors — PASS

0 console errors across all views. (Only 1 browser issue: `A form field element should have an id or name attribute`).
