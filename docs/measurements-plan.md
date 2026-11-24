# Measurements on the plan: UI/UX upgrade (Rayon as example)

Drafted 2026-11-24. Source: research on rayon.design docs (annotations, associative dimensions,
styles, tables, custom properties, walls and zones).

## How Rayon writes measurements
- **Dimensions are objects** with a style: line, extension lines, ends (arrowhead, dot, tick), and
  a text head with "Position" (Centred, Inside, Outside), "Rotation" (Aligned, Horizontal,
  Vertical) and "Always up".
- **Associative dimensions**: a dimension snapped to wall points is "Linked" and follows the wall
  when it moves.
- **Chained dimensions** ("Single/Chained"): one row of segments along a facade.
- **Helper dimensions on a selected wall**: click one and type a new length.
- **Zone tag**: each zone has a tag. The tag text can insert any property of the zone with "/"
  (name, area, custom properties). The text style sets the font, the units and the precision.
- **Units and precision** live in the text and annotation style ("Units and precision"), and the
  bottom-right units menu.
- **Tables**: a "Room schedule" table (name, area, room number, finishes) is computed from the zones
  and can be put on a page.

## How Simple Floorplan writes them today (`src/features/rooms/RoomsOverlay.tsx`)
- Wall length = one text inside the room, near the wall, rotated with the wall, at a fixed screen
  size (`px(11)`). No dimension line, no ticks. Hidden when the wall is shorter than 55 px on screen.
- Measured walls: green, `✓ 412 · 410` (measured · solved).
- Wall number badge (`6`) and room code (`CU`) are optional layers (auto / on / off).
- Room label: code + name, then area `12,34 m²`. Nothing else, no settings.
- No outside (facade) dimensions, no overall lengths, no thickness on the plan.
- A length is typed only in the side panel (or by clicking a wall in Measuring Mode).

## Problems
1. A text with no line does not say which span it measures (face, centre, T-junction segment).
2. The outside of the apartment shows no length. An architect plan always has outside chains.
3. A selected wall does not show its two faces, its centre length or its thickness on the plan.
4. The room label cannot show other values (perimeter, ceiling height, survey progress).
5. In Edit mode you cannot type a length on the plan.

## Target design

### 1. Dimension lines for walls (round 1, agent `dims`)
- Each wall length is a **dimension line** parallel to the inside face, a short distance into the
  room: a thin line with a 45 degree **tick** at each end (architect style), the text centred
  **above** the line (on the room side), always up.
- The line spans exactly the face that the value measures (the inside face of the room, from
  corner to corner, split at T-junctions like the faces).
- Short wall: when the text does not fit between the ticks, the text goes past the end of the
  line (outside). When even the line is shorter than 12 px, show nothing (as today).
- Colours stay: grey = calculated, green bold with `✓` = measured.
- A View menu setting **"Wall lengths: Lines | Text"** keeps the old text-only look.
- **Helper dimensions on the selected stored wall**: side A length and side B length outside the
  band on each side, centre length, and thickness `12` in a small box at the middle of the band.
  Measured values in green.

### 2. Room tag (round 1, agent `tag`)
- The room label becomes a **tag** with rows that the user can choose in the View menu,
  "Room tag": Code, Name, Area, Perimeter, Ceiling height, Survey progress (`4/6 walls`).
  Default: Code (as the layer says), Name, Area, so that nothing changes for current users.
- Area precision: 0, 1 or 2 decimals (default 2). Comma decimals.
- Small room: same rule as today (code only).
- Pure function `roomTagLines(room, fields, ctx)` returns the lines, tested.

### 3. Outside dimension chains (round 1, agent `outside`)
- New layer **"Outside dimensions"** (on/off, default on for v2 documents).
- For each straight facade run of the outside of the plan (outside faces of stored walls that are
  in line), draw two rows, outside the wall band:
  1. **Chain**: one segment per outside face span (between corners and the points where a
     partition meets the wall: the same spans as `W12-E`), measured on the outside face.
  2. **Overall**: the full length of the run.
- Same tick style and text rules as section 1. Measured facade values (`W12-E`) in green.
- Pure module (geometry from the wall graph), tested.

### 4. Type a length on the plan (round 2)
- In Edit mode, a **double-click on a dimension text** opens a small number field at that place.
  Enter writes the **measured value** of that face (same write as Measuring Mode, one undo step).
  Esc cancels. Tab goes to the next wall of the room (walk order).
- Works on room faces, outside faces (`W12-E`) and the centre helper (`W12-C`).

### 5. Units and precision (round 2)
- View menu "Units": cm (default), m, mm; length decimals. Only the canvas text and the export
  use it at first; panel fields stay in cm.

### 6. Room schedule (round 3)
- Plan tab, new section "Room schedule": code, name, area, perimeter, ceiling, measured walls.
  Copy as CSV, and an option to add it to the PDF/SVG export.

### 7. Other Rayon ideas (round 3, not about measurements)
- Wall tool: type the length (and angle) of the current segment, Enter to place it; `S` switches
  the alignment (side A, centre, side B) while drawing.
- `Cmd/Ctrl+K` command palette (tools, layers, snap, export, select similar walls).
- `Tab` steps through the objects under the pointer (face, wall, room, element).
- Door / window placement: the pointer side sets the swing; `F` flips the hinge; `L` keeps the tool
  active after a click.

## Rules for all rounds
- Read `AGENTS-BRIEF.md`. World units are cm. Screen-constant sizes use `px(n)`.
- Keep the existing `data-*` attributes and test ids (tests use `data-room-label`,
  `data-room-code-text`, `data-wall-number`, `data-wall-align-line`, ...).
- Comma decimals (`fmtCm`). Dark mode. No new dependencies.
- Text must never be hidden under a wall band: draw it in `RoomsOverlay` (or a layer after it).
- `npx tsc -b`, `npx vitest run`, `npx vite build` must pass. Commit after each round.
