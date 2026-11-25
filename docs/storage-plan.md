# Built-in storage plan

Decided with the user on 2026-11-25.

## Goal
- In Measuring Mode and Edit Mode, "storage" means storage built INTO the walls (a closet). It is on the
  OUTER side of a room wall, never inside the room.
- A built-in storage is a small ROOM attached to its parent room. It has its own walls (2 side walls and
  1 back wall, thinner by default). Its front is a section of the parent room's wall (the host wall),
  with a door or an opening in it.
- Storage inside a room is furniture. It is not in scope. The app does not manage furniture yet.
- The `cupboard` element kind is DELETED from the app (the user has no cupboard data).

## Data model
In `src/model/types.ts` and the zod schema `src/core/schema.ts`:

```ts
export type RoomStorage = {
  /** The room that the storage opens into. */
  parentRoomId: string
}
// on Room:
storage?: RoomStorage
```

- A storage room is a normal `Room` (same walls, vertices / v2 cycle, thickness per wall) with `storage`
  set. Default name: "Storage".
- The front door is a normal `WallElement` on the host wall, with `roomId` = the parent room:
  - door type "hinged" = `kind: 'door', variant: 'single'`; "double hinged" = `variant: 'double'`;
    "sliding" = `variant: 'sliding'`; "pocket" = `variant: 'pocket'`; "bifold" = new variant `'bifold'`
    (add it to `ElementVariant`, `VARIANTS.door`, `VARIANT_LABEL` = "Bifold", and draw it in the
    door symbol code: a zig-zag of 2 leaves per side);
  - "no door" = `kind: 'opening'`.
  - The door width = the storage inside width. The door swings into the parent room.

## Geometry (centre-line model, units cm)
Inputs: parent room, host wall of the parent room, `offsetCm` (distance along the host wall from its start
to the near INSIDE face of the storage, the same rule as `WallElement.offsetCm`), `widthCm` (inside
clear width), `depthCm` (inside clear depth, from the OUTER face of the host wall to the inner face of the
back wall), `sideCm` (side wall thickness, default 5), `backCm` (back wall thickness, default 5).

Let `s` = host wall start (centre line), `dir` = unit vector of the host wall, `out` = minus the host wall
`inward` vector (the outer side of the parent room), `h` = host wall thickness.

- A = s + dir * (offsetCm - sideCm/2)
- B = s + dir * (offsetCm + widthCm + sideCm/2)
- C = B + out * (h/2 + depthCm + backCm/2)
- D = A + out * (h/2 + depthCm + backCm/2)
- Storage walls (centre lines): A-B (front, it IS the host wall section, thickness h), B-C (side,
  sideCm), C-D (back, backCm), D-A (side, sideCm).
- Check: the inside ring of the storage (`roomInnerRing`) has width `widthCm` and depth `depthCm`.
- In a v2 document (`schemaVersion: 2`, walls are data): split the host wall at A and B (use the existing
  split helpers), add nodes C and D and walls B-C, C-D, D-A, and give the storage room a cycle
  A-B-C-D. The parent room cycle must use the split walls. Elements on the host wall keep their real
  position.
- In a v1 document: add a room with vertices A, B, C, D and wall props (front = copy of the host wall props).
- Refuse (return an error, no change) when A..B is not fully on the host wall, or when the new storage
  overlaps another room.

## Areas and schedule
- The storage room area is its inside area (`roomAreaM2`, no change).
- The room schedule shows each storage on its OWN line, just under its parent room (label e.g.
  "Storage (Bedroom 1)"), and its area is in the apartment total.

## Rules
- Deleting a parent room deletes its storage rooms and their front door.
- The outside envelope and outside dimensions go around the storage (this comes from the storage walls).
- In Measuring Mode, a storage room is NOT a separate room card. It shows inside its parent room card.

## Steps (one commit each)
0. Delete the `cupboard` kind everywhere (types, schema, variants, labels, symbols, DSL, DXF, clash,
   exports, MCP, measure UI, tests). Add the door variant `bifold`.
1. Model + geometry + store actions (`addStorage`, `updateStorage`, `deleteStorage`) + unit tests.
2. UI: Measuring Mode ("+ Add built-in storage" in the room card, fields: wall, from start, width, depth,
   side and back thickness, door type; edit and delete; the mini drawing shows the storage outside the
   wall) and Edit Mode (the place tool for storage on a wall, and a storage section in the room panel).
3. Areas and schedule.
4. Exports (SVG, PDF, DXF), DSL, queries, MCP tool for storage.
5. Global review, then a Chrome check.
