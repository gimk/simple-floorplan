# UI Test Report: Outside Dimension Chains and Gap Faces

- **Date:** 2026-11-25
- **Target:** `http://localhost:8788` (after clicking Reload on the "Update available" toast)
- **Project:** Demo apartment

## Results

| Check | Status | Observation |
|---|---|---|
| 1. No outside dimensions near hatched gap areas | **PASS** | Near the hatched shaft/duct gaps (between Sdb/Wc/Couloir and Séjour/Entrée, and between Séjour and Cuisine), no outside dimension row, text, or extension line measures the faces around the gaps. Before Reload, `"66"` appeared in the DOM; after Reload, `"66"` is gone. |
| 2. Real building facade outside chains and overall rows | **PASS** | Outer walls keep their outside dimension chains and overall rows: top (`340,2`, `371,3`, `93`, `139`, `77`), left (`80,9`, `335`, `173`, `460`), bottom-left (`287`, `222`, overall `509`, `240`), bottom (`221`, `196`, `299`, `330`, overall `629`), and right (`586,3`, `360`, overall `946,3`, `330`, `406`). |
| 3. No outside dimension text overlap at Fit zoom and 100% | **FAIL** | At 100% zoom, 0 text overlaps were found. At Fit zoom (51%), 1 overlap was found at the bottom-left of Sde/wc: horizontal `"196"` overlaps vertical `"221"`. |
| 4. Export shows no dimensions around gaps | **PASS** | Exported SVG (`demo-apartment (4).svg`) shows the same layout: no outside dimensions, text (`"66"` absent), or extension lines around the hatched gap areas. (Note: `"W14-E 221"` and `"196"` also touch/overlap in the exported SVG.) |
| 5. Console errors | **PASS** | 0 console errors and 0 console warnings on load, zoom changes, and SVG export (only 1 browser form-field `id`/`name` issue). |
