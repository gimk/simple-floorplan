// Simple Floorplan 2 data model. Units: cm and degrees. Rooms are independent polygons (interior dimensions); walls are drawn outward from them.
import type { Vec } from './geometry'

export type { Vec }

/** Floor texture drawn over the room fill. 'solid' (or unset) means no texture. */
export type FloorPattern = 'solid' | 'wood' | 'parquet' | 'tile' | 'stone' | 'carpet'

export type RoomShape = {
  id: string
  name: string
  vertices: Vec[]
  fill?: string
  floorPattern?: FloorPattern
  /** Rotation of the floor pattern in degrees. Omitted when 0. */
  floorPatternAngleDeg?: number
  /** Accent paint per wall: keys are edge indices ('0', '1', ...), values are hex colours. */
  wallColors?: Record<string, string>
}
export type Room = RoomShape

/** Drawing precision of an artboard, in cm. */
export type PrecisionCm = 0.1 | 0.5 | 1

export type OpeningKind = 'door' | 'window' | 'opening'

/** Door styles. 'standard' is the single leaf with a quarter-circle swing arc. */
export type DoorVariant = 'standard' | 'pocket' | 'bypass' | 'french'
/**
 * Window styles. 'standard' is the triple-line frame, 'sliding' is two staggered sashes, and the two
 * casement styles add swinging leaves (with their quarter-circle arcs) on top of the frame.
 */
export type WindowVariant = 'standard' | 'sliding' | 'casement' | 'double-casement'
export type OpeningVariant = DoorVariant | WindowVariant

export type Opening = {
  id: string
  kind: OpeningKind
  /**
   * Room whose wall hosts the opening. Two rooms can be flush (a shared wall with a 0 cm gap), and
   * then the opening centre is at distance 0 from an edge of both: this field says which wall the
   * opening belongs to. Optional: documents saved before it existed, and openings placed off any
   * wall, have none; the nearest wall then hosts the opening.
   */
  roomId?: string
  /** Centre of the opening on the wall, in artboard-local cm. */
  xCm: number
  yCm: number
  angleDeg: number
  widthCm: number
  hinge?: 'left' | 'right'
  swing?: 'in' | 'out'
  heightCm?: number
  sillCm?: number
  /** Style variant: a DoorVariant for doors, a WindowVariant for windows. Omitted = 'standard'. */
  variant?: OpeningVariant
}

export type FurnitureItem = {
  id: string
  name: string
  shape: 'rect' | 'circle'
  xCm: number
  yCm: number
  widthCm: number
  depthCm: number
  rotationDeg: number
  color: string
  heightCm?: number
  /** Draw a subtle front-direction arrow near the local -Y (front) edge. Omitted or false: no arrow. */
  showDirection?: boolean
  /** Border radius of a 'rect' item, in cm (>= 0). Ignored by 'circle' items. */
  cornerRadiusCm?: number
}

/** Default wall thickness of an artboard, in cm. 0 turns the thick walls off. */
export const DEFAULT_WALL_THICKNESS_CM = 10
export const MIN_WALL_THICKNESS_CM = 0
export const MAX_WALL_THICKNESS_CM = 50

export type Artboard = {
  id: string
  name: string
  xCm: number
  yCm: number
  ceilingHeightCm: number
  /** Drawing precision (snap and rounding step) in cm. */
  precisionCm: PrecisionCm
  /**
   * Thickness of the walls, in cm (0 to 50). Room polygons stay the interior; the wall is drawn
   * outward from each room edge. Omitted = DEFAULT_WALL_THICKNESS_CM; 0 = no thick walls.
   */
  wallThicknessCm?: number
  /** Optional manual frame width/height in cm. They act as the minimum frame size. */
  widthCm?: number
  heightCm?: number
  rooms: Room[]
  openings: Opening[]
  furniture: FurnitureItem[]
}

export type RefImage = {
  id: string
  name: string
  /** Data URL (or object URL) of the image. */
  src: string
  naturalWidth: number
  naturalHeight: number
  xCm: number
  yCm: number
  cmPerPx: number
  rotationDeg: number
  opacity: number
  visible: boolean
  locked: boolean
}

export const SCHEMA_VERSION = 3 as const

export type ProjectDoc = {
  schemaVersion: typeof SCHEMA_VERSION
  id: string
  title: string
  refImages: RefImage[]
  artboards: Artboard[]
}

export type Selection =
  | { kind: 'none' }
  | { kind: 'artboard'; artboardId: string }
  | { kind: 'room'; artboardId: string; roomIds: string[] }
  | { kind: 'wall'; artboardId: string; roomId: string; edgeIndex: number }
  | { kind: 'vertex'; artboardId: string; roomId: string; vertexIndex: number }
  | { kind: 'opening'; artboardId: string; openingId: string }
  | { kind: 'furniture'; artboardId: string; furnitureId: string }
  | { kind: 'refImage'; imageId: string }
