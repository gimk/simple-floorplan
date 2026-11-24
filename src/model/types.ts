// Shared data model. WORLD UNITS ARE CENTIMETERS everywhere (x right, y down).
// Do not change these types without coordinating: every feature depends on them.

export type Vec = { x: number; y: number }

export type Vertex = { id: string; x: number; y: number }

export type WallType = 'bearing' | 'partition' | 'exterior'

/** Renovation state of a wall: kept as it is, demolished, or built (7.4). */
export type WallStatus = 'existing' | 'demolish' | 'new'

/**
 * Which line of a wall lines up with the next walls on the same line (7.5):
 * its face in this room, its centre line, or its face in the room on the other side.
 */
export type WallAlign = 'room' | 'center' | 'other'

/** Properties of the wall that STARTS at a given vertex and goes to the next vertex. */
export type WallProps = {
  type: WallType
  thicknessCm: number
  locked?: boolean
  /** Renovation state. Missing = 'existing'. */
  status?: WallStatus
  /** Line that lines up with the next walls. Missing = 'room'. */
  align?: WallAlign
}

export type Room = {
  id: string
  /** Short survey code, e.g. "SE", "C1". Unique per project. */
  code: string
  name: string
  /** Polygon, in order. Wall i goes from vertices[i] to vertices[(i+1) % n]. */
  vertices: Vertex[]
  /**
   * Faces of this room, in polygon order (schema v2, docs/walls-plan.md phase 5c). One entry per
   * room wall. `vertices` and `walls` are then a CALCULATED view (materializeRooms). Absent in v1
   * documents, where the polygon itself is the source.
   */
  cycle?: RoomFace[]
  /** Cutouts (shafts, columns) inside the room. */
  holes: Vertex[][]
  /** Keyed by the start vertex id of the wall. Missing = default partition. */
  walls: Record<string, WallProps>
  ceilingCm?: number
  outdoor?: boolean
  /** Position in the measuring walk-through (lower first). */
  walkOrder: number
  /** Index of the two vertices used for the survey diagonal, if any. */
  diagonal?: [number, number]
}

export type ElementKind = 'door' | 'window' | 'opening' | 'cupboard' | 'radiator' | 'other'

export type ElementVariant =
  // doors
  | 'single' | 'double' | 'sliding' | 'pocket'
  // windows
  | 'standard' | 'french' | 'fixed'
  // storage
  | 'wall-cabinet' | 'recessed' | 'wardrobe'

/**
 * A door / window / fixture attached to a wall.
 * In a v2 document it belongs to a WALL (`wallId` + `alongCm`), so a door between two rooms is ONE
 * element (docs/walls-plan.md phase 7). `roomId` + `wallStart` + `offsetCm` are then a CALCULATED
 * view: the room it opens into, the face of that room which holds it, and the distance from that
 * face's start corner. A v1 document has only the view.
 */
export type WallElement = {
  id: string
  roomId: string
  /** Start vertex id of the host wall. */
  wallStart: string
  /** Stored wall of a v2 document. Missing in a v1 document, or in an element not attached yet. */
  wallId?: string
  /** Distance from node a of the wall to the near edge of the element, cm (v2 documents). */
  alongCm?: number
  /**
   * Set when the element had to open into the room on the other side of its wall (its own room lost
   * that part of the wall). A hint for the user; the UI shows it and clears it on the next edit.
   */
  elementMoved?: boolean
  kind: ElementKind
  variant?: ElementVariant
  /** Distance along the wall from its start vertex to the near edge of the element. */
  offsetCm: number
  widthCm: number
  heightCm?: number
  sillCm?: number
  depthCm?: number
  hinge?: 'start' | 'end'
  swing?: 'in' | 'out'
  note?: string
  createdAt: string
  updatedAt: string
}

export type BackgroundImage = {
  /** Object URL / data URL locally, or R2 key once uploaded. */
  src: string
  r2Key?: string
  naturalWidth: number
  naturalHeight: number
  /** Image placement in world space. */
  xCm: number
  yCm: number
  /** Centimeters per image pixel (set by 2-point calibration). */
  cmPerPx: number
  rotationDeg: number
  opacity: number
  visible: boolean
  locked: boolean
}

export type MeasureStatus = 'estimated' | 'verified'

/** How an on-site value was measured. It sets the weight of the value in the solver. */
export type MeasureSource = 'tape' | 'laser' | 'plan' | 'other'

/**
 * Stored target of one value (docs/walls-plan.md phase 5c): the wall face, centre line,
 * thickness or diagonal it measures. The label stays the key of the value.
 */
export type MeasureTarget = {
  wallId: string
  /** L = left of the wall from node a to node b. R = right. */
  side: 'L' | 'R'
  /** Room that sees this face. Missing = outside (facade). */
  roomId?: string
  /** Start of the face along the wall from node a, cm. Missing = from node a. */
  from?: number
  /** End of the face along the wall from node a, cm. Missing = to node b. */
  to?: number
  /** What the value measures. Missing = 'face'. */
  kind?: 'face' | 'centre' | 'outside' | 'thickness' | 'diagonal'
}

/** On-site value for one survey ID such as "SE-2", "SE-D", "SE-H". */
export type Measurement = {
  label: string
  actualCm: number
  updatedAt: string
  /** How the value was measured. Missing = 'tape'. */
  source?: MeasureSource
  /** What the value measures on the wall graph (phase 5c). Missing = not resolved yet. */
  target?: MeasureTarget
}

/** Stored junction of the wall graph (docs/walls-plan.md, phase 5a). Centre line, cm. */
export type StoredNode = { id: string; x: number; y: number }

/** One side of a stored wall, seen from one room (no roomId = outside). */
export type StoredFace = {
  side: 'L' | 'R'
  roomId?: string
  /** Start vertex id of the room wall that makes this face (with roomId, it is the match key). */
  wallStart?: string
  /** Distance along the wall from node a, cm. */
  from: number
  to: number
}

/**
 * One face of one stored wall, seen from one room, in the order of the room polygon
 * (schema v2, docs/walls-plan.md phase 5c). The two sides of a wall are cut independently: side L
 * can hold ONE face of one room while side R holds three faces (T junctions, corridor).
 */
export type RoomFace = {
  /** Stable id of the stored wall, e.g. 'W12'. */
  wallId: string
  /** L = left of node a -> node b, R = right of it. */
  side: 'L' | 'R'
  /** Distance along the wall from node a to the start of this face, cm. */
  from: number
  /** Distance along the wall from node a to the end of this face, cm. */
  to: number
  /** Id of the room corner at the START of this face in room order (kept from v1). */
  cornerId: string
}

/**
 * Stored wall with a stable id (W1, W2...).
 * In a v1 document thickness, type and status stay in `room.walls` and nodes/walls are DERIVED data.
 * In a v2 document (`schemaVersion: 2`) the wall holds its own properties and is the source.
 */
export type StoredWall = {
  id: string
  a: string
  b: string
  faces: StoredFace[]
  /** Wall properties. Always set in a v2 document. */
  thicknessCm?: number
  type?: WallType
  status?: WallStatus
  align?: WallAlign
  locked?: boolean
  /**
   * A wall that stays when no room uses it (drawn with the Wall tool, or left by a deleted room).
   * A wall without this flag goes away when its last room face goes away (a room shape edit).
   */
  standalone?: boolean
}

/** One wall that the v1 -> v2 conversion merged from copies that differ (docs/walls-plan.md 5c). */
export type ConversionReportEntry = {
  /** Stable id of the merged wall. */
  wallId: string
  /** Room codes of the copies, in walk order, without repetition. */
  rooms: string[]
  /** Spread of the drawn lines of the copies, cm (0 when they are on one line). */
  linesApartCm: number
  /** Thickness of each copy, in walk order. */
  thicknesses: number[]
  /** Type of each copy, in walk order. */
  types: WallType[]
  /** Values kept on the wall. */
  chosen: WallProps
}

/** What the v1 -> v2 conversion did. Counts only, plus one entry per merged wall that differed. */
export type ConversionReport = {
  entries: ConversionReportEntry[]
  counts: {
    rooms: number
    walls: number
    /** Walls made of more than one room wall (a wall between two rooms, or an in-line merge). */
    sharedWalls: number
    /** Room walls that gave no face (a wall of zero length): the room is left as v1. */
    droppedRoomWalls: number
  }
}

/**
 * A value that left `doc.measurements` (wall split or removed, room deleted). Kept until the user
 * deletes it. `roomCode` is the room the value belonged to; it is '' for a value of a stored wall
 * ('W12-C', 'W12-E'), because a wall does not belong to one room.
 */
export type OldMeasurement = Measurement & {
  roomCode: string
  reason: 'wall-split' | 'wall-removed' | 'room-deleted'
  droppedAt: string
}

export type TapeMeasure = {
  id: string
  a: Vec
  b: Vec
  actualCm?: number
  note?: string
  /** Ad-hoc tape from Measuring Mode: its label and the room card it belongs to. a = b = {0,0} when not placed. */
  label?: string
  roomId?: string
}

/**
 * One dimension arrow drawn on a pin photo (docs/plan.md 7.4).
 * `a` and `b` are NORMALISED to the photo: 0..1 from its top-left corner (x right, y down),
 * so a mark stays on the right spot at any display size.
 */
export type PhotoMark = {
  id: string
  /** Start of the arrow, normalised 0..1 in the photo. */
  a: Vec
  /** End of the arrow, normalised 0..1 in the photo. */
  b: Vec
  /** Measured length in cm. Used when the mark is not linked to a survey ID. */
  valueCm?: number
  /** Survey ID this mark is about, e.g. "SE-2". */
  label?: string
  note?: string
}

/** Note / photo pin. Photos are data URLs while offline, R2 keys once uploaded. */
export type Pin = {
  id: string
  roomId?: string
  /** World position, cm. */
  at: Vec
  /** Start vertex id of the wall the pin sits on, if any. */
  wallStart?: string
  text?: string
  photoKeys: string[]
  /** Dimension arrows per photo, keyed by the photo key (data URL or R2 key). */
  sketches?: Record<string, PhotoMark[]>
  createdAt: string
  updatedAt: string
}

/** Where a reference surface comes from (DPE, Loi Carrez, deed, listing...). */
export type SurfaceReferenceSource = 'dpe' | 'carrez' | 'boutin' | 'deed' | 'listing' | 'other'

/** A surface written on an official document, compared with the traced plan. */
export type SurfaceReference = {
  id: string
  source: SurfaceReferenceSource
  /** Free label, e.g. "DPE 2023". */
  label?: string
  /** Surface reported by the document, in m². */
  surfaceM2: number
  /** When the reference is about one room. */
  roomCode?: string
  /** ISO date of the document (YYYY-MM-DD). */
  date?: string
  note?: string
}

/** Apartment-level data (not tied to one room). */
export type Apartment = {
  /** Ceiling height used by rooms without their own `ceilingCm`. */
  defaultCeilingCm?: number
  references?: SurfaceReference[]
  /** Smallest step (cm) that the solvers write for corners and thicknesses. 0 = no rounding. Missing = 0.5. */
  precisionCm?: 0 | 0.5 | 1
}

export type PlanDoc = {
  projectId: string
  title: string
  /**
   * 1 (or absent) = rooms are the editing source. 2 = walls are the editing source
   * (docs/walls-plan.md phase 5c). Absent in old documents.
   */
  schemaVersion?: 1 | 2
  background?: BackgroundImage
  rooms: Room[]
  elements: WallElement[]
  measurements: Record<string, Measurement>
  roomNotes: Record<string, string> // keyed by room code
  tapes: TapeMeasure[]
  pins?: Pin[]
  /** Stored wall graph (phase 5a). Absent in older documents: rebuilt on load. */
  nodes?: StoredNode[]
  walls?: StoredWall[]
  /** Values of split or removed walls and of deleted rooms. Only the user removes entries. */
  oldMeasurements?: OldMeasurement[]
  /** Optional apartment-level data. Absent in older documents. */
  apartment?: Apartment
  /** Traced walls of the Wall tool (docs/walls-plan.md phase 6). Absent in older documents. */
  traces?: TraceWall[]
  /** Conversion to walls as the source (docs/walls-plan.md phase 5c): when, and what was merged. */
  conversion?: { at: string; report: ConversionReport; seen?: boolean }
}

/**
 * A traced wall: the centre line of a wall drawn with the Wall tool (docs/walls-plan.md phase 6).
 * It is a drawing aid that becomes a room with the Make room tool. Absent in older documents.
 */
export type TraceWall = {
  id: string
  /** Centre line start, cm. */
  a: Vec
  /** Centre line end, cm. */
  b: Vec
  thicknessCm: number
  type: WallType
}

export type Selection =
  | { kind: 'room'; roomId: string }
  | { kind: 'vertex'; roomId: string; vertexId: string }
  | { kind: 'wall'; roomId: string; wallStart: string }
  | { kind: 'element'; elementId: string }
  /** A traced wall. Traces are not inside a room, so they have no roomId. */
  | { kind: 'trace'; id: string; roomId?: undefined }
  /** A stored wall (walls are the source, docs/walls-plan.md 5c). `side` = the side the user clicked, `face` = the face
   * of that side (a key of `faceKeyOf`, features/rooms/wallSides.ts): none = the whole wall or side. */
  | { kind: 'storedWall'; wallId: string; side?: 'L' | 'R'; face?: string; roomId?: undefined }
  | null

export type ToolId =
  | 'select'
  | 'pan'
  | 'calibrate'
  | 'rect'
  | 'polygon'
  | 'wall'
  | 'make-room'
  | 'slice'
  | 'cutout'
  | 'place-element'
  | 'tape'
  | 'pin'

export type Mode = 'edit' | 'measure'
