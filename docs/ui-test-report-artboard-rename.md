# UI Test Report: Canvas Artboard Rename & Rotated Resize Cursors

## Part A: Checks

- `npx tsc -b`: PASS
- `npx vitest run`: PASS — 71 test files passed (71), 1049 tests passed (1049)
- `npm run build`: PASS — built in 445ms, PWA precache 19 entries (1237.63 KiB)

## Part B: Chrome Test (`http://localhost:8788`, PWA cache cleared & hard reloaded)

### Spec: rename on canvas

- Double-click the artboard name above the frame: a text field opens in place with the name selected. Works in Plan mode AND in Design mode. — **PASS** (`[data-testid^="artboard-name-input-"]` opened with `value: "Plan A"`, `selectionStart: 0`, `selectionEnd: 6`, `isActive: true` in Plan mode; also opened and saved in Design mode).
- Type a new name + Enter: the name changes on the canvas and in the Inspector "Name" field. — **PASS** (typed `"Floor One"` + Enter; canvas button `aria-label="Artboard Floor One"` and Inspector `textbox "Artboard name"` updated to `"Floor One"`).
- Click elsewhere (blur): saves too. — **PASS** (typed `"Blurred Name"`, clicked Inspector heading; input closed and Inspector updated to `"Blurred Name"`).
- Escape: cancels, old name stays. — **PASS** (typed `"Escaped Name"`, pressed `Escape`; input closed and name stayed `"Plan A"`).
- Empty name + Enter: old name stays. — **PASS** (pressed `Backspace` to clear, pressed `Enter`; input closed and name stayed `"Plan A"`).
- Cmd+Z after a rename undoes it in ONE step (not two). — **PASS** (after renaming to `"Floor One"`, one `Meta+z` reverted to `"Plan A"` and disabled Undo).
- While typing, keyboard shortcuts do not fire (type "v", "h", "Delete", Backspace: no tool change, nothing deleted). — **PASS** (typed `"Floor vh"`, pressed `Backspace` twice and `Delete`; input retained `"Floor "`, Select tool remained `aria-pressed="true"`, all 3 rooms / 36,00 m² remained intact).
- In Plan mode, a normal drag of the name still moves the artboard; a single click still selects it. — **PASS** (single-click after selecting a room selected the artboard without opening the input; dragging the name moved artboard X from `-40` cm to `44` cm).
- Focus the name (Tab to it) and press F2: field opens. — **PASS** (focused `Artboard Plan A` button and pressed `F2`; `artboard-name-input-` opened and focused).
- The field looks right (readable text, same place as the name, not blurry, not huge/tiny) at zoom 25%, 100%, 400%. Screenshot each. — **PASS** (tested at 24%, 100%, and 434% zoom — closest zoom steps to 25%/400%; screen-space box stayed ~`260 × 22 px` with ~`12 px` effective text height, crisp and aligned above the frame).
- Inspector "Name" field is editable in Design mode too. — **PASS** (`textbox "Artboard name"` had `disabled: false` in Design mode and accepted edits).

### Spec: resize cursors follow rotation

- Select a rect furniture item, rotate it 90° (Inspector rotation field): 4 corner handles at 0° vs 90°. — **PASS** (placed Desk 140×70 cm; at 0°: `"-1:-1": nwse-resize`, `"1:-1": nesw-resize`, `"1:1": nwse-resize`, `"-1:1": nesw-resize`; at 90°: `"-1:-1": nesw-resize` at top-right `(735, 404)`, `"1:-1": nwse-resize` at bottom-right `(735, 544)`, `"1:1": nesw-resize` at bottom-left `(665, 544)`, `"-1:1": nwse-resize` at top-left `(665, 404)`).
- At 45°: edge and corner cursors are diagonal/straight as matches the screen direction. — **PASS** (at 45°: corners `"-1:-1"` top `(675, 400)` & `"1:1"` bottom `(725, 549)` are `ns-resize`; `"1:-1"` right `(774, 499)` & `"-1:1"` left `(626, 450)` are `ew-resize`; edges `"-1:0"` `(650, 425)` & `"1:0"` `(749, 524)` are `nwse-resize`; `"0:-1"` `(725, 450)` & `"0:1"` `(675, 499)` are `nesw-resize`).

## Console Errors

- 0 console errors (only standard DevTools `[issue]` notices for form fields without `id`/`name`).

## Screenshots

- 24% zoom (closest to 25%): `/Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/.agent-results/rename-zoom-25.png`
- 100% zoom: `/Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/.agent-results/rename-zoom-100.png`
- 434% zoom (closest to 400%): `/Users/antoinepouligny/Documents/Projects/Dev/simple-floorplan/.agent-results/rename-zoom-400.png`
