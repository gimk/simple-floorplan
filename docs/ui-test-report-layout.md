# UI Test Report: Floating Tool Bar and Layers Panel (`ec3dda2`)

Date: 2026-11-25
URL: `http://localhost:8788/`
Test project: `Layout UI Test` (new project with demo apartment loaded)
Viewports: Desktop (`1440 x 900`), Phone (`390 x 844`)
Browser console errors: None (only 1 Chromium form-field `id`/`name` issue).

## Test Results

| Test | Result | Notes |
| --- | --- | --- |
| 1. Floating tool bar | PASS | No left rail. Centered pill bar at bottom (`x=427..953`, `y=842..888`), border and shadow. All 13 buttons turn orange (`oklch(0.553 0.195 38.402)`), show `title` tooltips, and respond to shortcuts (`v,h,r,p,w,m,s,x,d,g,c,t,n`). |
| 2. Zoom, hints, fit to view | FAIL | Zoom pill (`x=734..1054`, `y=782..828`) and View menu (`x=1062..1108`, `y=782..828`) sit bottom-right without overlapping the tool bar. Hints center above the bar (`y=729..772` for Wall). After `Fit plan to view (0)`, bottom walls reach `y=790` and overlap the zoom pill and hint bar. |
| 3. Left Layers panel | PASS | `260 px` left panel shows the layers tree. Header collapse button, `Toggle layers` (`aria-pressed`), `[` key, and Command Palette `Toggle layers panel` all toggle it. State persists across reload (`sfp.layersPanel.open`). Canvas resizes cleanly (`860 px` open, `1120 px` closed). |
| 4. Right sidebar | PASS | Only `Inspect`, `Solve`, and `Plan` tabs exist (no `Layers` tab). All three tabs work. Both side panels open (`260 px` + `860 px` + `320 px`) have no overlap. |
| 5. Measuring mode | PASS | `?mode=measure` hides the floating tool bar (and Layers panel). `Exit Measuring Mode` restores the tool bar. |
| 6. Phone width (`390 x 844`) | PASS | No horizontal page scroll (`390 px`). Tool bar is centered at bottom (`374 px` wide, scrolls `628 px`, `44x44 px` buttons). Layers panel starts closed, opens as a `260x844` left drawer with backdrop, and backdrop tap closes it. Right sidebar drawer (`320x844`) works. |
| 7. Theme and console | PASS | Dark theme (`rgb(27, 33, 40)` bg, `rgb(232, 236, 239)` text) renders cleanly on tool bar and Layers panel. App is always dark (`src/index.css`). Zero console errors. |

## Failures

### 2. Fit to view: bottom walls overlap zoom pill and tool hint bar

- **Steps**: Load the demo apartment in `1440 x 900` with both side panels open. Click `Fit plan to view (0)`.
- **Expected**: No UI control covers the fitted floorplan content.
- **Actual**: Fitted walls span `y=62..790` (`x=365..1015`), overlapping the bottom-right Zoom pill (`y=782..828`, `x=734..1054`) and the tool hint bar (`y=713..772`).
- **Likely file**: `src/shell/fit.ts` (`FIT_BOTTOM_PAD = 112` reserves 112 px, while the tool bar, zoom pill, and hint bar extend up to 187 px from the bottom).
