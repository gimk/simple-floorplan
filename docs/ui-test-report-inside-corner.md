# UI Test Report: Outside Dimensions at Inside Corners

Test date: 2026-11-25
App URL: `http://localhost:8788`
Projects tested: `Demo apartment` (multi-room L/stepped outline), `R3 test` (stepped outline with angled wall), `New apartment` (single rectangle, no inside corners).
Toast check: Clicked `Reload` on the `Update available` toast before testing.

## Summary

| Check | Result | Notes |
| --- | --- | --- |
| 1. Inside corners at 200%+ zoom | FAIL | 5 of 6 inside corners in `Demo apartment` pass; 1 inside corner (`W14` / `W5`, rows `196` and `221`) fails. `R3 test` passes. |
| 2. Outside (convex) corners | PASS | All outside corners end on the outer corner of the walls. |
| 3. Chain segment sums | PASS | All chain segments add up to their overall row. |
| 4. Measuring Mode facade values (`W*-E`) | FAIL | 3 of 15 facade walls match the outside row (`W5-E`, `W16-E`, `W25-E`); 12 of 15 differ by 5 cm to 15 cm. |
| 5. SVG export parity | PASS | Exported SVG matches the canvas outside dimensions and coordinates. |
| 6. Console errors | PASS | 0 console errors. |

## Detailed Findings

### Check 1: Inside corners at 200%+ zoom — FAIL

Tested `Demo apartment` at `244%` zoom and `R3 test` at `630%` zoom.

`Demo apartment` — 5 inside corners PASS:
1. Top-left inside corner (`W28` vertical / `W26` horizontal, Terrasse / Chambre 3):
   - Horizontal row `72` ends at `x=235` (outer left face of `W28`).
   - Vertical row `75,9` ends at `y=241` (outer top face of `W26`).
2. Left inside corner (`W27` vertical / `W18` horizontal, Chambre 3 / Couloir):
   - Horizontal row `168` ends at `x=163` (outer left face of `W27`).
   - Vertical row `330` ends at `y=571` (outer top face of `W18`).
3. Bottom-left inside corner (`W6` vertical / `W21` horizontal, Entrée / Couloir):
   - Horizontal row `287` + `217` (overall `504`) ends at `x=499` (outer left face of `W6`).
   - Vertical row `235` starts at `y=1031` (outer bottom face of `W21`).
4. Right-bottom inside corner (`W11` vertical / `W15` horizontal, Cuisine / Chambre 1):
   - Vertical row `586,3` + `355` (overall `941,3`) ends at `y=1069` (outer top face of `W15`).
   - Horizontal row `325` starts at `x=989` (outer right face of `W11`).
5. Top-right inside corner (`W31` vertical / `W7` horizontal, Terrasse / Séjour):
   - Vertical row `132,8` ends at `y=127,75` (outer top face of `W7`).
   - Horizontal row `88` (hidden at 100% zoom, visible at 244% zoom) starts at `x=901` (outer right face of `W31`).

`Demo apartment` — 1 inside corner FAIL:
6. Bottom-middle inside corner (`W14` vertical `x=[685, 695]` / `W5` horizontal `y=[1256, 1266]`, Entrée / Sde/wc):
   - Horizontal row `196` ends at `x=695` (the right face of `W14`/`W4`, across the 10 cm wall band), instead of `x=685` (the outer left face of `W14`).
   - Vertical row `221` starts at `y=1254` (inside `W5` / on the centerline of `W12` `y=[1249, 1259]`), instead of `y=1266` (the outer bottom face of `W5`).

`R3 test` (at `630%` zoom) — PASS:
- Top row `90` starts at `x=80` (outer left face of `W11` `x=[80, 90]`).

### Check 2: Outside (convex) corners — PASS

In `Demo apartment` (`72` at `x=163`, `330` at `y=241`, `168` at `x=-5`, `460` at `y=[571, 1031]`, `406` at `y=[1069, 1475]`, `371,3` at `y=-5`, `629` at `x=[685, 1314]`) and `R3 test` (`175`, `95`, `102,1`), all outside dimension lines, ticks, and extension lines end at the outer corners of the walls.

### Check 3: Chain segment sums — PASS

- `Demo apartment`:
  - Right vertical run: `586,3 + 355 = 941,3` (overall row `941,3`).
  - Bottom horizontal run: `299 + 330 = 629` (overall row `629`).
  - Middle-left horizontal run: `287 + 217 = 504` (overall row `504`).
- `R3 test`:
  - Bottom horizontal run: `90 + 85 = 175` (overall row `175`).

### Check 4: Measuring Mode facade values (`W*-E`) — FAIL

In `Demo apartment` Measuring Mode (`Facade · 0/15`), only 3 of 15 facade fields match the outside dimension row:
- Match: `W5-E` = `196` (`196`), `W16-E` = `406` (`406`), `W25-E` = `460` (`460`).
- Mismatch (placeholder vs outside row):
  - `W8-E`: `591,3` vs `586,3`
  - `W13-E`: `304` vs `299`
  - `W14-E`: `226` vs `221`
  - `W15-E`: `335` vs `325`
  - `W17-E`: `335` vs `330`
  - `W21-E`: `232` vs `217`
  - `W24-E`: `292` vs `287`
  - `W27-E`: `340` vs `330`
  - `W28-E`: `88,8` vs `75,9`
  - `W29-E`: `351,8` vs `340,2`
  - `W30-E`: `380` vs `371,3`
  - `W31-E`: `145,3` vs `132,8`

### Check 5: SVG export — PASS

Exported SVG from `Demo apartment` (`58,097` bytes) contains `data-outside-dims` and the same outside dimension labels (`235`, `88`, `355`, `941,3`, `629`, `504`, `72`, etc.) and line coordinates (including `x=695` for `196` and `y=1254` for `221`).

### Check 6: Console errors — PASS

0 console errors were logged across all projects and views. (Only 1 browser issue was present: `A form field element should have an id or name attribute`).
