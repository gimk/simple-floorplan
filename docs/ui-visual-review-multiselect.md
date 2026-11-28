# UI Visual and UX Review: Multi-Selection and Style Copy

**Scope**: Chrome visual and UX review on `http://localhost:8788` (fresh build, service worker unregistered, caches cleared, test project `UI test multiselect`).
**Build proof**: Shift-click of 2 walls in Plan mode showed `2 selected: 2 walls` in the Inspect panel.
**Console**: `0` console errors, `0` console warnings, `0` uncaught page errors.

---

## Findings

| Severity | Where | What is wrong | Screenshot | Concrete fix suggestion |
| :--- | :--- | :--- | :--- | :--- |
| Medium | Theme support (`src/shell/theme.ts`) | Light theme cannot be tested in the app. `initTheme()` forces `data-theme="dark"` on `<html>`, ignores `prefers-color-scheme: light`, and provides no theme toggle in the UI. | All (`vis-1-three-walls.png`) | If light theme is intentionally removed, keep it documented; if light theme is planned, add a theme toggle and test all multi-select panels in light mode. |
| Medium | `MultiInspect` header (`src/features/selection/MultiInspect.tsx`, line 132) | The selection count header uses `text-slate-100` without a light-mode pair, unlike `FurnitureMultiInspect` and `PanelStyles` (`text-slate-900 dark:text-slate-100`). It works in dark mode today, but it will be unreadable if light mode is enabled. | `vis-1-three-walls.png` | In `src/features/selection/MultiInspect.tsx` line 132, replace `text-slate-100` with `text-slate-900 dark:text-slate-100`. |
| Medium | `MultiInspect` Rooms section (`src/features/selection/MultiInspect.tsx`, lines 198–244) | The `Walls` section has a `Wall colour` label and `Doors and windows` has a `Colour` label, but the `Rooms` section has no `Floor colour` label above its swatches and no `Floor material` label above its pattern pills. | `vis-2-wall-door-room.png`, `vis-3-design-room-furn.png` | In `src/features/selection/MultiInspect.tsx`, wrap the floor swatches in `<div className="flex flex-col gap-1"><span className={LABEL}>Floor colour</span>...</div>` and the pattern pills in `<div className="flex flex-col gap-1"><span className={LABEL}>Floor material</span>...</div>`. |
| Medium | `MultiInspect` vs `FurnitureMultiInspect` (`src/features/selection/MultiInspect.tsx`, line 166 & `FurnitureMultiInspect.tsx`, line 170) | Inconsistent spelling: `MultiInspect` uses `Wall colour` / `Colour`, while `FurnitureMultiInspect` uses `Color` (`Color` / `Mixed colors`). | `vis-3-design-room-furn.png` vs `vis-5-two-furniture.png` | Pick one spelling across all inspect panels (for example `Colour` in `FurnitureMultiInspect.tsx` line 170 and `FurniturePanel.tsx` line 283, or `Color` in `MultiInspect.tsx`). |
| Medium | `MultiInspect` actions (`src/features/selection/MultiInspect.tsx`) | `MultiInspect` has no bulk `Delete` button, unlike `FurnitureMultiInspect` (`Arrange` -> `Delete Del`), `RoomInspect`, and `WallInspect`. On touch/phone screens, users cannot press `Del`. | `vis-1-three-walls.png`, `vis-9-phone-plan-multi.png` | Add an `Actions` section (or footer button) in `MultiInspect.tsx` with a `Delete selected` button (`DEL_BTN` with `<kbd className={KBD}>Del</kbd>`) when deletable items are selected. |
| Medium | `WallInspect` `Wall colour` row (`src/features/rooms/WallInspect.tsx`, lines 244–264) | Single-wall inspect does not display the selected colour name (e.g. `Terracotta` or `Default`) below the swatches, unlike `MultiInspect` and `FurnitureInspect`. Also, `Reset to default` disappears when at default, which shifts the `Openings` section below. | `vis-4-single-wall.png` | In `WallInspect.tsx` around line 253, add `<p className={MUTED}>{wallColorLabel}</p>` and keep `Reset to default` always rendered with `disabled={wallColor === undefined}`, matching `MultiInspect.tsx`. |
| Low | `MultiInspect` Rooms reset (`src/features/selection/MultiInspect.tsx`, lines 198–217) | `Walls` and `Doors and windows` both have a `Reset to default` button, while `Rooms` uses only the slashed-circle `Default` swatch. | `vis-2-wall-door-room.png`, `vis-9-phone-plan-multi.png` | Optionally add a `Reset to default` button (or keep the `Default` swatch consistent with `DesignRoomsInspect.tsx`). |
| Low | Phone top bar (`390x844`) | At `390px` width, the `Design` mode tab text truncates to `Desi...` next to the truncated project title `UI test m...`. | `vis-10-phone-design-multi.png` | Allow `shrink-0` on the `Plan` / `Design` / `Views` segmented control buttons in the top bar and give the project title input `min-w-0 flex-1`. |

---

## What Looks Good

1. **Multi-select inspect layout and spacing (`vis-1-three-walls.png`, `vis-2-wall-door-room.png`, `vis-3-design-room-furn.png`)**: Card borders, padding, `PanelSection` icons, swatch grids, and button heights match `FurnitureMultiInspect` (`vis-5-two-furniture.png`) and single-item panels (`vis-6-single-room.png`, `vis-8-single-furniture.png`).
2. **Mixed state clarity (`vis-1-three-walls.png`)**: When 3 walls have different colours, no swatch is ringed and `Mixed` is clearly readable in muted text below the row, with `Reset to default` enabled.
3. **Canvas selection highlights (`vis-1-three-walls.png`, `vis-2-wall-door-room.png`, `vis-3-design-room-furn.png`)**: Multiple selected walls, rooms, and furniture items use the same orange highlight and corner handle style as single selections, and remain clearly visible over custom wall paint.
4. **Phone `390x844` bottom drawer (`vis-9-phone-plan-multi.png`, `vis-10-phone-design-multi.png`)**: No horizontal overflow (`scrollWidth <= clientWidth`), no clipped labels, and swatch/pill touch targets are clean and usable.
5. **Zoom lock**: `WheelEvent` with `ctrlKey: true` is `defaultPrevented` and zooms the plan (`89%` -> `103%`) without zooming the browser page.
6. **Single-selection regression (`vis-4-single-wall.png`, `vis-6-single-room.png`, `vis-8-single-furniture.png`)**: Single room, wall, and furniture inspect panels render cleanly with no regressions.
