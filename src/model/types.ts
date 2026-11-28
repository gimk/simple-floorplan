// Simple Floorplan 2 data model. Units: cm and degrees. Rooms are independent polygons (interior dimensions); walls are drawn outward from them.
import type { Vec } from './geometry'

export type { Vec }

/**
 * Kind of a room wall. 'wall' (or unset) is a normal wall; 'fence' is a low railing, for example a
 * balcony parapet, drawn with the default fence height and thickness of src/model/defaults.ts and
 * src/features/rooms/walls.ts.
 */
export type WallKind = 'wall' | 'fence'

/** Floor texture drawn over the room fill. 'solid' (or unset) means no texture. */
export type FloorPattern = 'solid' | 'wood' | 'parquet' | 'tile' | 'stone' | 'carpet' | 'grass'

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
  /**
   * Kind of each wall: keys are edge indices ('0', '1', ...), values are a `WallKind`. An omitted
   * key, or an omitted map, means 'wall'.
   */
  wallKinds?: Record<string, WallKind>
}
export type Room = RoomShape

/** Drawing precision of an artboard, in cm. */
export type PrecisionCm = 0.1 | 0.5 | 1

export type OpeningKind = 'door' | 'window' | 'opening'

/** Door styles. 'standard' is the single leaf with a quarter-circle swing arc. */
export type DoorVariant = 'standard' | 'pocket' | 'bypass' | 'bypass-glass' | 'french' | 'french-glass'
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
  /** Optional colour (hex) of a door or window in 3D. Omitted = the default colours. */
  color?: string
}

/** 3D model kinds of a furniture item (see src/features/view3d/furnitureSolids.ts). */
export const FURNITURE_MODELS = [
  'bed', 'cot', 'sofa', 'cornerSofa', 'chair', 'officeChair', 'table', 'desk', 'roundTable',
  'pedestal', 'tallStorage', 'bookshelf', 'lowStorage', 'tvUnit', 'counter', 'sink', 'cooker', 'appliance',
  'drumAppliance', 'americanFridge', 'bathtub', 'shower', 'toilet', 'basin', 'rug', 'box',
] as const
export type FurnitureModel = (typeof FURNITURE_MODELS)[number]

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
  /**
   * One border radius per corner of a 'rect' item, in cm (>= 0), in the order top-left,
   * top-right, bottom-right, bottom-left of the unrotated local box (local -Y is the top).
   * When set it wins over `cornerRadiusCm`; a write of 4 equal values stores `cornerRadiusCm`
   * instead and drops this field. Ignored by 'circle' items.
   */
  cornerRadiiCm?: [number, number, number, number]
  /** Flat group identifier (no nesting). Items sharing a groupId act as one group. */
  groupId?: string
  /** Mirror the item shape about its own vertical axis. Omitted or false: no mirror. */
  flipX?: boolean
  /** Mirror the item shape about its own horizontal axis. Omitted or false: no mirror. */
  flipY?: boolean
  /** Id of the built-in preset this item was placed from. Keeps its 3D model after a rename. Omitted for custom or older items. */
  presetId?: string
  /** 3D model chosen by the user. Omitted = automatic (from presetId, then name, then size). */
  model?: FurnitureModel
}

/** How the 3D view draws the walls of a room: hidden, cut away above the camera, or full height. */
export type WallViewMode = 'off' | 'cutaway' | 'on'

/** Camera model of a 3D view. */
export type ViewProjection = 'perspective' | 'ortho'

/** A saved 3D camera of an artboard (docs/3d-and-finishes.md §3). */
export type SavedView = {
  id: string
  name: string
  /** Camera position, in artboard-local cm (X right, Y up, Z = plan y). */
  position: [number, number, number]
  /** Look-at point, in the same space as `position`. */
  target: [number, number, number]
  /** Vertical field of view in degrees (perspective only). Omitted = renderer default. */
  fov?: number
  /** Omitted = 'perspective'. */
  projection?: ViewProjection
  wallMode: WallViewMode
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
  /** Saved 3D camera views. Omitted = none (the 3D view then uses its default camera). */
  views?: SavedView[]
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

/**
 * One object that a mixed multi-selection can hold. Ids are artboard-local: a target belongs to the
 * artboard of the selection that carries it. Walls are edges of a room, so a wall target needs both
 * the room id and the edge index.
 */
export type MultiTarget =
  | { kind: 'room'; roomId: string }
  | { kind: 'wall'; roomId: string; edgeIndex: number }
  | { kind: 'opening'; openingId: string }
  | { kind: 'furniture'; furnitureId: string }

export type Selection =
  | { kind: 'none' }
  | { kind: 'artboard'; artboardId: string }
  | { kind: 'room'; artboardId: string; roomIds: string[] }
  | { kind: 'wall'; artboardId: string; roomId: string; edgeIndex: number }
  | { kind: 'vertex'; artboardId: string; roomId: string; vertexIndex: number }
  | { kind: 'opening'; artboardId: string; openingId: string }
  | { kind: 'furniture'; artboardId: string; furnitureId: string }
  /**
   * Several furniture items of one artboard (always 2 or more ids). One item keeps the 'furniture'
   * kind; shift-click and the Design-mode marquee build this one.
   */
  | { kind: 'furnitureMulti'; artboardId: string; furnitureIds: string[] }
  /**
   * Two or more objects of one artboard, of mixed kinds or several walls/openings. Only built when
   * no older kind fits: see normalizeSelection.
   */
  | { kind: 'multi'; artboardId: string; items: MultiTarget[] }
  | { kind: 'refImage'; imageId: string }
