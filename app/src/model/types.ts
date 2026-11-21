// Shared data model. WORLD UNITS ARE CENTIMETERS everywhere (x right, y down).
// Do not change these types without coordinating: every feature depends on them.

export type Vec = { x: number; y: number }

export type Vertex = { id: string; x: number; y: number }

export type WallType = 'bearing' | 'partition' | 'exterior'

/** Properties of the wall that STARTS at a given vertex and goes to the next vertex. */
export type WallProps = { type: WallType; thicknessCm: number; locked?: boolean }

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

/** On-site value for one survey ID such as "SE-2", "SE-D", "SE-H". */
export type Measurement = {
  label: string
  actualCm: number
  updatedAt: string
}

export type TapeMeasure = { id: string; a: Vec; b: Vec; actualCm?: number; note?: string }

export type PlanDoc = {
  projectId: string
  title: string
  background?: BackgroundImage
  rooms: Room[]
  elements: WallElement[]
  measurements: Record<string, Measurement>
  roomNotes: Record<string, string> // keyed by room code
  tapes: TapeMeasure[]
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

export type Mode = 'edit' | 'measure'
