// Artboards feature (Phase 1B): canvas frames + right-panel Inspect card.
//
//   <ArtboardsLayer />                      every artboard frame + header, in world cm
//   <ArtboardContent artboard={a}>…</ArtboardContent>
//                                           `<g transform="translate(xCm, yCm)">` for the
//                                           rooms / openings / furniture of one artboard
//   <ArtboardInspect artboardId={id} />     name, ceiling, area, rooms, duplicate/add/delete
export { ArtboardsLayer, ArtboardContent } from './ArtboardsLayer'
export { selectArtboard, selectRoom } from './selection'
export { ArtboardInspect } from './ArtboardInspect'
export type { ArtboardInspectProps } from './ArtboardInspect'
export {
  ARTBOARD_PAD_CM,
  MIN_ARTBOARD_HEIGHT_CM,
  MIN_ARTBOARD_WIDTH_CM,
  artboardAreaM2,
  artboardFrame,
  roomAreaM2,
} from './frame'
export type { ArtboardFrame } from './frame'
