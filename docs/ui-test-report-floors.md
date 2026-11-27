# UI Test Report: Floor Multi-Select, Pattern Sizes, and Grass Pattern

- **Date**: 2026-11-27
- **Target**: `http://localhost:8788` (`npm run dev:api` local Wrangler build)
- **Browser**: Chrome via Chrome DevTools MCP (`1440x900` viewport)
- **Test project**: 3 rooms (`Living`, `Kitchen`, `Garden`), each `400 x 300 cm` (`12,00 m²`, total `36,00 m²`)

## Setup Verification

- Unregistered 1 existing service worker and deleted 1 cache in the page console, then ran a hard reload.
- In Design mode, selected `Living` and confirmed the Inspect panel shows the `Grass` pattern button and the `Lawn` color swatch.

## Test Results

### A. Multi-room floor card — PASS

1. **Multi-select with Shift-click**: Clicked `Living`, then Shift-clicked `Kitchen` and `Garden`.
   - **Observed**: Inspect panel changed to `Rooms` with `"3 rooms selected"` and `"Total area 36,00 m²"`.
2. **Deselect with Shift-click**: Shift-clicked `Garden` again.
   - **Observed**: Inspect panel updated to `"2 rooms selected"` and `"Total area 24,00 m²"`.
3. **Bulk color and pattern change**: Clicked swatch `Warm Wood`, then clicked pattern `Wood`.
   - **Observed**: Both `Living` and `Kitchen` updated to `Warm Wood` with `Wood` planks at `0°`.
4. **Single-step Undo (`Cmd+Z`)**: Pressed `Meta+Z` once.
   - **Observed**: Both rooms reverted from `Wood` back to `Solid` at once while keeping `Warm Wood`.
5. **Plain click single-select**: Plain-clicked `Living` (no Shift).
   - **Observed**: Selection changed to `Living` only (`12,00 m²`).
6. **Mixed color state**: Applied `Light Oak` to `Living` (`Kitchen` remained `Warm Wood`), then Shift-clicked `Kitchen`.
   - **Observed**: Inspect panel showed `"2 rooms selected"`, color label `"Mixed"`, and no swatch in the active (`pressed`) state.

### B. Pattern sizes & seamlessness — PASS

Tested on `Living` (`400 x 300 cm`) zoomed in to `143%` with `Light Oak` color at both `0°` and `45°`:

| Pattern | Measured `<pattern>` tile (cm) | Visual scale check | Seams at `0°` | Seams at `45°` | Result |
| --- | --- | --- | --- | --- | --- |
| Wood | `280 x 42` (3 rows of `14 cm` planks, `140 cm` long) | ~21 plank rows across `300 cm` height (~14 cm planks) | None visible | None visible | PASS |
| Parquet | `80 x 80` (herringbone blocks `8 x 40 cm`) | Blocks match `8 x 40 cm` against the `1 m` scale bar | None visible | None visible | PASS |
| Tile | `60 x 60` (`30 x 30 cm` tiles) | 10 tiles across `300 cm` height (`30 x 30 cm`) | None visible | None visible | PASS |
| Stone | `90 x 60` (varied slabs ~`19.5–21 cm` tall) | Proportional stone coursing | None visible | None visible | PASS |
| Carpet | `12 x 12` fine weave | Subtle fine woven texture | None visible | None visible | PASS |

### C. Grass pattern & Lawn swatch — PASS

- **Design mode (`Living`, `Lawn` + `Grass`)**:
  - **Observed**: `<pattern>` is `40 x 40 cm` with `#5b7a3e` at `0.42` opacity over `#161b21` and subtle organic tuft/blade rectangles. The green `Lawn` color reads clearly, looks like subtle grass, and has no visible tile-edge seams.
- **Plan mode**:
  - **Observed**: `Grass` + `Lawn` renders behind the plan grid with `Living 12 m²` and wall dimensions clearly legible.
- **Export (`Copy SVG`)**:
  - **Observed**: Copied SVG (`27,861` bytes) includes the `<pattern>` definition with `#5b7a3e` for the `Grass` fill.

## Visual Notes

- **Theme**: No light/dark theme switch is present in the UI, and emulating `prefers-color-scheme: light` keeps the dark theme. No visual defects observed in the dark theme across Plan mode, Design mode, and multi-selection states.
