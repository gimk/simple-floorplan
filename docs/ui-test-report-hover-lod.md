# UI Test Report: Wall Hover Highlight and Outside Dimension LOD

- URL: `http://localhost:8788/`
- Project: `Demo apartment` (12 rooms, 31 walls, 16 shared walls)
- Tool: Chrome DevTools MCP

Note: On first load, Chrome showed an `Update available` toast from an older cached service worker. After a click on `Reload`, the current build loaded and all checks ran on that build.

## Feature 1: Wall row hover highlight in Room card

Setup: Edit mode, Select tool active. Selected room `Chambre 3 (C3)` to open the Room card in the sidebar.

| Check | Result | Observation |
|---|---|---|
| Hover over each wall row highlights that wall in orange on the canvas | PASS | Moved the pointer over `C3-1` (`W26`), `C3-2` (`W10`), `C3-3` (`W18`), and `C3-4` (`W27`). Each row highlighted only its matching wall segment in bright orange on the canvas. |
| Highlight goes away when the pointer leaves the row | PASS | Moved the pointer to the `Room` heading. The orange hover highlight disappeared from the canvas. |
| After a click on a row (opens the wall card), no orange hover highlight stays | PASS | Clicked `C3-1` (`W26`). The `Wall W26` card opened in the sidebar, `W26` showed the standard selected wall state (`A`/`B` badges and thickness `10`), and no hover highlight stayed on the canvas. |

## Feature 2: Outside dimension chains LOD on zoom

Setup: Deselected the wall (`Apartment` view) and zoomed out step by step from `100%` through `51%` (Fit), `41%`, `33%`, `26%`, `21%`, `17%`, and `13%`, then zoomed back to `51%` (Fit) and `100%`.

| Check | Result | Observation |
|---|---|---|
| Runs shorter than about 64 px disappear (no text, no extension line) | PASS | At `51%`, short runs (`77`, `80,9`, `93`, `66`) were gone with no text and no extension lines. At `41%`, `139` disappeared. At `33%`, `173` disappeared. At `26%`, `221` and `196` disappeared. At `17%`, `335`, `340,2`, `371,3`, and `330` disappeared. At `13%`, `460` and `406` disappeared. |
| Run with a chain segment shorter than about 40 px shows only its overall row | PASS | At `21%`, the bottom chain under `Chambre 2` / `Couloir` showed both its inner segments (`287`, `222`) and its overall row (`509`). At `17%`, the inner segments (`287`, `222`) disappeared and only the overall row (`509`) stayed visible. |
| Zooming in again brings all rows back | PASS | Clicked `Fit` (`51%`) and `100%`. All previously hidden runs and inner chain rows (`287`, `222`, `335`, `173`, `139`, `93`, `77`, `80,9`, `66`) returned cleanly. |

## General UI and Console Checks

| Check | Result | Observation |
|---|---|---|
| Visual layout (text overlapping badges) | PASS | No dimension text overlapped wall badges. At `33%` zoom, two unrelated labels from separate runs (`360` and `330`) sat close together near `Cuisine` / `Chambre 1`, and at `17%`–`13%` zoom room names overlapped room areas because of low zoom scale. |
| Console errors | PASS | 0 console errors and 0 warnings. Only 1 browser issue notice (`A form field element should have an id or name attribute`, count: 10). |
