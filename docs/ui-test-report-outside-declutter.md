# UI Test Report: Outside Dimension Declutter

- **Target:** `http://localhost:8788/` (project: `Demo apartment`)
- **Date:** 2026-11-25
- **Toast check:** Clicked `Reload` on the `Update available` toast before testing.

## Summary

| Check | Result | Notes |
| --- | --- | --- |
| 1. Fit zoom (~51%): Sde/wc corner (`196` and `221`) | PASS | `221` (`W14-E`) is visible; `196` (`W5-E`) is hidden and its dimension line stays. |
| 2. Overlaps across zoom levels (texts & wall badges) | FAIL (minor) | 0 overlaps at 51%, 100%, 244%, 41%, and 26%. At 33%, `360` (`1`) and `330` (`W15-E`) overlap by 0.43 px (`736.85` vs `736.42`). 0 wall badge overlaps at all levels. |
| 3. Real facade chain and overall rows (100% zoom) | PASS | 23/23 outside texts visible (0 hidden). `W8:R` (`586,3` + `360` / `946,3`), `W13:L` (`299` + `330` / `629`), and `W21:L` (`287` + `222` / `509`) are complete. |
| 4. Hatched gap areas (shafts, ducts) | PASS | No outside dimension rows appear around the hatched gap areas. |
| 5. SVG export | PASS | 22/23 outside texts present (`W5-E 196` hidden), 0 overlaps across all 83 `<text>` elements, no gap dimensions. |
| 6. Console errors | PASS | 0 console errors (1 browser form-field `id`/`name` issue only). |

## Details by Zoom Level (Wall Labels `On`)

- **51% (Fit):** 19/20 outside texts visible (`W5-E` hidden), 55 wall badges, 0 text overlaps, 0 badge overlaps.
- **100%:** 23/23 outside texts visible, 57 wall badges, 0 text overlaps, 0 badge overlaps.
- **244%:** 23/23 outside texts visible, 57 wall badges, 0 text overlaps, 0 badge overlaps.
- **41%:** 18/19 outside texts visible (`W21-E` hidden), 52 wall badges, 0 text overlaps, 0 badge overlaps.
- **33%:** 18/18 outside texts visible, 49 wall badges, 1 text overlap (`360` [`1`] and `330` [`W15-E`], 0.43 px bounding-box overlap), 0 badge overlaps.
- **26%:** 14/15 outside texts visible (`1` / `360` hidden), 46 wall badges, 0 text overlaps, 0 badge overlaps.
