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

/** A door / window / fixture attached to one wall of one room. */
export type WallElement = {
  id: string
  roomId: string
  /** Start vertex id of the host wall. */
  wallStart: string
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

/** On-site value for one survey ID such as "SE-2", "SE-D", "SE-H". */
export type Measurement = {
  label: string
  actualCm: number
  updatedAt: string
  /** How the value was measured. Missing = 'tape'. */
  source?: MeasureSource
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
  background?: BackgroundImage
  rooms: Room[]
  elements: WallElement[]
  measurements: Record<string, Measurement>
  roomNotes: Record<string, string> // keyed by room code
  tapes: TapeMeasure[]
  pins?: Pin[]
  /** Optional apartment-level data. Absent in older documents. */
  apartment?: Apartment
}

export type Selection =
  | { kind: 'room'; roomId: string }
  | { kind: 'vertex'; roomId: string; vertexId: string }
  | { kind: 'wall'; roomId: string; wallStart: string }
  | { kind: 'element'; elementId: string }
  | null

export type ToolId =
  | 'select'
  | 'pan'
  | 'calibrate'
  | 'rect'
  | 'polygon'
  | 'slice'
  | 'cutout'
  | 'place-element'
  | 'tape'
  | 'pin'

export type Mode = 'edit' | 'measure'
