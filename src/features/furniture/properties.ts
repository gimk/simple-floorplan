// Backwards-compatible home of the style clipboard that App.tsx (and only App.tsx now) imports.
// The clipboard itself lives in src/features/style/styleClipboard.ts, because it serves furniture,
// openings, walls and rooms alike.
// The style is VISUAL ONLY: the colour of furniture, openings and walls, and the floor colour and
// material of rooms. Nothing else is copied: no variant, width, height, sill, hinge or swing of an
// opening, no wallKinds, no wallColors of a room, no showDirection, corner radii, size or height of
// furniture. Units: cm and degrees.
export { copyStyle, getCopiedStyle, pasteStyle, setCopiedStyle } from '../style/styleClipboard'
