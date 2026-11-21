# Brief for feature agents

Project: Simple Floorplan. Read `../plan.md` (the product plan) for feature details.
App: React 19 + TypeScript + Vite + Tailwind v4 + Zustand/zundo + lucide-react + polygon-clipping (already installed).

## Rules
- WORLD UNITS ARE CENTIMETERS. y points down.
- Work ONLY inside your own folder (given in your task). Do NOT edit `src/model/*`, `src/canvas/*`, `src/App.tsx`, or other features' folders. If you need a change there, write it under "Requests to lead" in your result file.
- Keep the export names/signatures in your feature's `index.tsx` (see the stub). You may add more files in your folder.
- Do not install new npm packages (already installed: jspdf, pdfjs-dist, vite-plugin-pwa, zod). Do not run `git` commands. Other agents work IN PARALLEL in the same tree.
- Shared files (`src/App.tsx`, `src/model/types.ts`, `src/model/store.ts`): edit them ONLY if your task allows it, with small targeted edits. Re-read the file just before each edit (another agent may have changed it). Never rewrite a whole shared file.
- Old saved docs may miss new fields: always read new optional PlanDoc fields with a fallback (e.g. `doc.pins ?? []`).
- If `npx tsc -b` fails only in another agent's files, ignore it and say so in your result.
- Before finishing: `npx tsc -b` must pass with no errors in your files, and `npx vite build` must succeed.
- Add unit tests for pure geometry/logic in your folder as `*.test.ts` (vitest: `npx vitest run <your folder>`).
- Use Tailwind classes; support dark mode (`dark:` variants). Touch targets ≥ 36px.

## Shared code (read first)
- `src/model/types.ts` — PlanDoc, Room, Vertex, WallProps, WallElement, BackgroundImage, Measurement, Selection, ToolId.
- `src/model/store.ts` — `useDoc` (doc + `update(fn)` = one undo step, `updateSilent(fn)` = no undo step), `beginDrag()/endDrag(start)` for one-undo-step drags, `useUi` (mode, tool, selection, placeKind, snap, layers, view), `uid()`, `nowIso()`.
- `src/model/geometry.ts` — vector math, `roomWalls(room)` (with `inward` normal), `wallByStart`, `projectOnSegment`, `pointInPolygon`, `roomAreaM2`, `centroid`, `fmtCm`.
- `src/model/survey.ts` — survey IDs (`CODE-1..n`, `CODE-D`, `CODE-H`), `allSurveyIds`, `roomsInWalkOrder`, `nextRoomCode`.
- `src/canvas/Viewport.tsx` — `useViewport()` → `{ zoom, toWorld(clientX, clientY), px(screenPx) }` and `<CaptureRect>` for tool overlays. Layers and tool overlays render INSIDE the world `<g>`, so draw in cm. Use `px(n)` for screen-constant sizes (handles, strokes, fonts). Pan/pinch are handled by the Viewport already.
- `src/App.tsx` — shell: renders `<BackgroundLayer/> <RoomsLayer/> <ElementsLayer/>` in the viewport, the active tool overlay, the sidebar panels, and `<MeasureMode/>` when `mode === 'measure'`. Shortcuts: Ctrl/Cmd+Z undo, Shift for redo, Esc = select tool + clear selection, letter keys pick tools. Delete/Backspace for the selection must be handled by the feature that owns that selection kind (ignore events from inputs).

## Result file
Write a short markdown result: what you built, files, how to test, known gaps, "Requests to lead".
