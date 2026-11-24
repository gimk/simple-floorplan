# Visual Re-check — Measurements Upgrade

**Verdict: Ship.**
All four P1 blockers from the first review are fixed, and the plan stays readable at 100% zoom without empty dimension lines. Only minor P2/P3 label overlaps remain in `Wc` and on some outside dimension lines.

| ID | Status | Evidence | Suggested fix | Priority |
|---|---|---|---|---|
| V-1 | fixed | On phone `390x844` at `32%` Fit, `Terrasse` no longer merges `358,5` and `352`, and `Entrée` no longer crosses into `Cuisine`. | None (optional: nudge `40` clear of `Entrée`). | P3 |
| V-2 | still there | Shaft `40x66` is now clean, but vertical `66` (`660` in `mm`/SVG) still touches `"WC"` inside `Wc` at `51%` Fit and in the exported SVG. | Hide room wall dims inside rooms narrower than `50 px` on screen. | P2 |
| V-3 | fixed | In `Terrasse` at `51%` Fit, `100%`, and exported SVG, `332`, `70`, and `113,5` sit inside the room and do not cross walls or `"TE Terrasse"`. | None. | P3 |
| V-4 | fixed | Desktop `1440x900` shows two columns (`Layers` and `Measurements`) with all controls visible; phone `390x844` opens a full-width scrollable bottom sheet. | None. | P3 |
| V-5 | fixed | At `1440x900` Fit (`51%`), bottom outside dims `299` and `330` stay above the bottom hint bar (top-left `340,2` touches the top edge). | Optional: add `12 px` top padding in `Fit (0)`. | P3 |
| V-6 | fixed | `Dégagement` `284` stays inside `Dégagement` and does not cross into `Cuisine`. | None. | P3 |
| V-7 | fixed | In `mm` mode at `51%` Fit, no numbers merge (`3980` and `1220` no longer collide). | None. | P3 |
| V-8 | fixed | In `Plan` > `Room schedule`, `"Copy CSV"` and `"Download CSV"` both stay on one line. | None. | P3 |
| V-9 | fixed | On `Wall W10`, `"Length (W10-C)"` shows `"node to node"` on one muted subline. | None. | P3 |
| V-10 | still there | In `demo-apartment (3).svg`, top-left `770` still crosses the diagonal extension line of `W29-E 3402,4`. | Offset outside labels narrower than `24 px` by `6 px` clear of extension lines. | P3 |
| V-11 | fixed | In `Séjour` at `51%` and `100%`, the orange note pin sits above `"SE Séjour"` and does not cover the room name. | None. | P3 |
| NEW-1 | new | Outside dims cross in `demo-apartment (3).svg` (`W27-E 3350` over `1730`; `W14-E 2210` over `1960`) and on phone Fit (`360` touches `330`). | Run overlap nudging on outside dimension labels against adjacent lines. | P2 |
