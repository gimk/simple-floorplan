# Right Panel (Sidebar) Redesign Plan

## Problems today
- Edit Mode stacks 9 panels in one long scroll (`src/App.tsx` `<aside>`): Apartment, Background, Room/Wall, Element, Tape, Pin, Layers, Calculators, Export. The context panel (what is selected) moves up and down as other panels open or close.
- Each panel builds its own look: some use `<section>` with `<h2>`, some `<details>`/`<summary>`. Paddings, heading sizes, field layouts, unit placement and button styles differ.
- Fields: label above input in one place, beside it in another; units sometimes in the label, sometimes as a suffix.
- No breadcrumb: when a wall is selected, you see "Wall SE-2" but no quick way back to the room or the apartment.
- The room panel has no list of its walls or elements; the wall panel does not show the doors and windows on that wall.
- The global tools (Background, Layers, Calculators, Export) stay below the context panel, so on a laptop you scroll past the inspector to reach them.
- The 288 px width (`w-72`) is narrow for the tables in the apartment and calculator panels.

## Target design (inspector pattern, like Figma / tldraw / Excalidraw)
1. **Two tabs at the top of the sidebar: "Inspect" and "Plan".**
   - *Inspect* shows only the current context: Apartment (nothing selected), Room, Wall, Vertex/Hole, Element, Tape, Pin.
   - *Plan* holds the global sections: Background, Layers, Calculators, Export.
   - When the selection changes (including tape and pin selection), the sidebar switches to *Inspect*. The chosen tab and the open/closed state of each section are remembered per viewer (localStorage, wrapped in try/catch).
2. **Breadcrumb** at the top of *Inspect*: `Apartment › Séjour (SE) › Wall SE-2`. Each part is a button that selects that level (Apartment = clear selection).
3. **Shared primitives** (one look everywhere), in `src/shell/panel/`:
   - `PanelSection` — titled block, optional icon, optional collapsible (remembers state), optional header actions (e.g. delete).
   - `FieldRow` — label left (fixed width), control right; full-width on very narrow screens.
   - `NumberField` — text input with `inputMode="decimal"`, accepts comma decimals, unit suffix inside the input (cm, m², %), commit on Enter/blur, Escape reverts, invalid state with message.
   - `TextField`, `SelectField`, `CheckboxRow`/`SwitchRow`.
   - `Segmented` — segmented control with `aria-pressed` (wall type, element kind, units).
   - `StatGrid` — label/value pairs with tabular numbers, French comma format.
   - `IconButton` — 36 px (44 px on coarse pointers), `aria-label` + `title` required, variants: default, danger.
   - `EmptyHint` — small muted help text.
   Tokens: one border colour, one radius, one padding, one heading style; light and dark themes.
4. **Context panels content**
   - *Room*: name, code, stats (area, perimeter, volume, effective ceiling with "apartment default" hint), ceiling field, outdoor switch, walk order; **walls list** (label, type badge, length, lock icon; click selects the wall); **elements list** (kind, wall, width; click selects); measured-lengths actions; delete room in the header.
   - *Wall*: type segmented, thickness, length, lock switch; **elements on this wall** list with "Add door / window" (switches to the element tool if that exists); hint "B toggles bearing/partition".
   - *Element*, *Tape*, *Pin*: same primitives, delete in the header.
   - *Apartment*: as today, re-laid out with `StatGrid` and `FieldRow`.
5. **Width**: 320 px (`w-80`) on desktop; drawer on phones stays as today.

## Constraints
- Keep every `data-*` attribute, `aria-label`, `name`/`id` used by code and tests (e.g. Measuring Mode `m-*` ids), the `window.__floorplan` bridge, keyboard shortcuts (B, Delete, ?), and comma decimals.
- One undo step per edit, as today.
- No new dependencies.

## Delegation
- **Phase 1 (one agent, `sidebar-shell`)**: primitives in `src/shell/panel/`, sidebar shell (`src/shell/sidebar/Sidebar.tsx` with tabs, breadcrumb, section memory), move `LayerToggles` out of `App.tsx` into `src/shell/sidebar/LayersSection.tsx`, wire `App.tsx`. Panels are mounted unchanged in the right tab.
- **Phase 2 (three agents in parallel, after phase 1 is committed)**, each migrates its panels to the primitives:
  - `panel-rooms`: `src/features/rooms/RoomsPanel.tsx` (room, wall, vertex, hole) + walls list + elements lists.
  - `panel-annot`: `src/features/elements/index.tsx` (ElementsPanel only), `src/features/annotations/index.tsx` (TapePanel, PinPanel).
  - `panel-global`: `src/features/apartment/ApartmentPanel.tsx`, `src/features/background/index.tsx` (BackgroundPanel only), `src/features/export/index.tsx` (Export, Calculators), `src/shell/sidebar/LayersSection.tsx`.
