// Versioned Zod schema for PlanDoc v1, migration of legacy docs, and JSON Schema export.
// Zero React/DOM dependencies — safe for browser, Node, and Cloudflare Workers.
import { z } from 'zod'
import type { MeasureTarget, PlanDoc } from '../model/types'

export const VecSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

export const VertexSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
})

export const WallTypeSchema = z.enum(['bearing', 'partition', 'exterior'])

/** Renovation state of a wall (7.4). Missing = 'existing'. */
export const WallStatusSchema = z.enum(['existing', 'demolish', 'new'])

export const WallPropsSchema = z.object({
  type: WallTypeSchema,
  thicknessCm: z.number().finite().positive(),
  locked: z.boolean().optional(),
  status: WallStatusSchema.optional(),
  align: z.enum(['room', 'center', 'other']).optional(),
})

/**
 * One face of one stored wall, seen from one room, in room order (docs/walls-plan.md phase 5c).
 * A v1 room has no cycle: its polygon is the source.
 */
export const RoomFaceSchema = z.object({
  wallId: z.string().min(1),
  side: z.enum(['L', 'R']),
  from: z.number().finite(),
  to: z.number().finite(),
  // Id of the room corner at the start of this face in room order (kept from v1).
  cornerId: z.string().min(1),
})

export const RoomSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string(),
  vertices: z.array(VertexSchema).min(3),
  // Faces of a v2 room (one per room wall). Absent in a v1 document.
  cycle: z.array(RoomFaceSchema).optional(),
  holes: z.array(z.array(VertexSchema).min(3)).default([]),
  walls: z.record(z.string(), WallPropsSchema).default({}),
  ceilingCm: z.number().finite().positive().optional(),
  outdoor: z.boolean().optional(),
  walkOrder: z.number().finite().default(1),
  diagonal: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
})

export const ElementKindSchema = z.enum(['door', 'window', 'opening', 'cupboard', 'radiator', 'other'])

export const ElementVariantSchema = z.enum([
  'single',
  'double',
  'sliding',
  'pocket',
  'standard',
  'french',
  'fixed',
  'wall-cabinet',
  'recessed',
  'wardrobe',
])

export const WallElementSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  wallStart: z.string().min(1),
  kind: ElementKindSchema,
  variant: ElementVariantSchema.optional(),
  offsetCm: z.number().finite().min(0),
  widthCm: z.number().finite().positive(),
  heightCm: z.number().finite().positive().optional(),
  sillCm: z.number().finite().min(0).optional(),
  depthCm: z.number().finite().positive().optional(),
  hinge: z.enum(['start', 'end']).optional(),
  swing: z.enum(['in', 'out']).optional(),
  note: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const BackgroundImageSchema = z.object({
  src: z.string(),
  r2Key: z.string().optional(),
  naturalWidth: z.number().finite().positive(),
  naturalHeight: z.number().finite().positive(),
  xCm: z.number().finite(),
  yCm: z.number().finite(),
  cmPerPx: z.number().finite().positive(),
  rotationDeg: z.number().finite(),
  opacity: z.number().finite().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
})

/** How an on-site value was measured (docs/walls-plan.md phase 3a). Missing = 'tape'. */
export const MeasureSourceSchema = z.enum(['tape', 'laser', 'plan', 'other'])

/**
 * Target of one value (docs/walls-plan.md phase 5c): the wall face, centre line, thickness
 * or diagonal that the value measures. Unknown keys are stripped, so an old writer that
 * sends more fields does no harm.
 */
export const MeasureTargetSchema = z.object({
  wallId: z.string().min(1),
  side: z.enum(['L', 'R']),
  roomId: z.string().min(1).optional(),
  from: z.number().finite().optional(),
  to: z.number().finite().optional(),
  kind: z.enum(['face', 'centre', 'outside', 'thickness', 'diagonal']).optional(),
})

export const MeasurementSchema = z.object({
  label: z.string().min(1),
  actualCm: z.number().finite().positive(),
  updatedAt: z.string(),
  // Optional: documents saved before phase 3a have no source.
  source: MeasureSourceSchema.optional(),
  // Optional: documents saved before phase 5c have no target.
  target: MeasureTargetSchema.optional(),
})

/**
 * Validate one target as sent by a client or read from the database.
 * A wrong shape gives undefined (no target), it never throws.
 */
export function parseMeasureTarget(raw: unknown): MeasureTarget | undefined {
  if (raw == null) return undefined
  const res = MeasureTargetSchema.safeParse(raw)
  return res.success ? res.data : undefined
}

/**
 * Read the target_json column. NULL, bad JSON and a wrong shape all give no target,
 * so a read never fails on a bad row.
 */
export function parseMeasureTargetJson(json: string | null | undefined): MeasureTarget | undefined {
  if (json == null || json === '') return undefined
  try {
    return parseMeasureTarget(JSON.parse(json))
  } catch {
    return undefined
  }
}

/** Stored wall graph (phase 5a). All optional: older documents have none. */
export const StoredNodeSchema = z.object({ id: z.string().min(1), x: z.number().finite(), y: z.number().finite() })
export const StoredFaceSchema = z.object({
  side: z.enum(['L', 'R']),
  roomId: z.string().optional(),
  wallStart: z.string().optional(),
  from: z.number().finite(),
  to: z.number().finite(),
})
export const StoredWallSchema = z.object({
  id: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
  faces: z.array(StoredFaceSchema),
  // Wall properties (docs/walls-plan.md phase 5c): a v2 wall is the source, so it holds its own
  // thickness, type, renovation state, align rule and lock. Absent in a phase 5a document.
  thicknessCm: z.number().finite().positive().optional(),
  type: WallTypeSchema.optional(),
  status: WallStatusSchema.optional(),
  align: z.enum(['room', 'center', 'other']).optional(),
  locked: z.boolean().optional(),
})
export const OldMeasurementSchema = MeasurementSchema.extend({
  roomCode: z.string(),
  reason: z.enum(['wall-split', 'wall-removed', 'room-deleted']),
  droppedAt: z.string(),
})

export const TapeMeasureSchema = z.object({
  id: z.string().min(1),
  a: VecSchema,
  b: VecSchema,
  actualCm: z.number().finite().positive().optional(),
  note: z.string().optional(),
  label: z.string().optional(),
  roomId: z.string().optional(),
})

/** One dimension arrow drawn on a pin photo. `a`/`b` are normalised 0..1 in the photo. */
export const PhotoMarkSchema = z.object({
  id: z.string().min(1),
  a: VecSchema,
  b: VecSchema,
  valueCm: z.number().finite().positive().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
})

/** Marks of one pin, keyed by photo key (data URL or R2 key). */
export const PinSketchesSchema = z.record(z.string(), z.array(PhotoMarkSchema))

export const PinSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().optional(),
  at: VecSchema,
  wallStart: z.string().optional(),
  text: z.string().optional(),
  photoKeys: z.array(z.string()).default([]),
  sketches: PinSketchesSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const SurfaceReferenceSourceSchema = z.enum(['dpe', 'carrez', 'boutin', 'deed', 'listing', 'other'])

/** ISO date (YYYY-MM-DD). */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)')

export const SurfaceReferenceSchema = z.object({
  id: z.string().min(1),
  source: SurfaceReferenceSourceSchema,
  label: z.string().optional(),
  surfaceM2: z.number().finite().positive(),
  roomCode: z.string().min(1).optional(),
  date: IsoDateSchema.optional(),
  note: z.string().optional(),
})

/** Apartment-level data. Optional: documents saved before it existed stay valid. */
export const ApartmentSchema = z.object({
  defaultCeilingCm: z.number().finite().positive().optional(),
  references: z.array(SurfaceReferenceSchema).optional(),
  precisionCm: z.union([z.literal(0), z.literal(0.5), z.literal(1)]).optional(),
})

/** Traced wall of the Wall tool (docs/walls-plan.md phase 6). Optional: older documents have none. */
export const TraceWallSchema = z.object({
  id: z.string().min(1),
  a: VecSchema,
  b: VecSchema,
  thicknessCm: z.number().finite().positive(),
  type: WallTypeSchema,
})

/** 1 = rooms are the editing source (or absent). 2 = walls are the editing source (phase 5c). */
export const SchemaVersionSchema = z.union([z.literal(1), z.literal(2)])

/**
 * One wall that the v1 -> v2 conversion merged from copies that differ (docs/walls-plan.md 5c).
 * Absent keys get a neutral default, so a report written by an older app still reads.
 */
export const ConversionReportEntrySchema = z.object({
  wallId: z.string().min(1),
  /** Room codes of the copies, in walk order, without repetition. */
  rooms: z.array(z.string()).default([]),
  /** Spread of the drawn lines of the copies, cm. */
  linesApartCm: z.number().finite().min(0).default(0),
  /** Thickness of each copy, in walk order, cm. */
  thicknesses: z.array(z.number().finite().positive()).default([]),
  /** Type of each copy, in walk order. */
  types: z.array(WallTypeSchema).default([]),
  /** Properties kept on the merged wall. */
  chosen: WallPropsSchema,
})

export const ConversionCountsSchema = z.object({
  rooms: z.number().int().min(0).default(0),
  walls: z.number().int().min(0).default(0),
  /** Walls made of more than one room wall (a wall between two rooms, or an in-line merge). */
  sharedWalls: z.number().int().min(0).default(0),
  /** Room walls that gave no face (a wall of zero length): the room is left as v1. */
  droppedRoomWalls: z.number().int().min(0).default(0),
})

/**
 * What the v1 -> v2 conversion did (docs/walls-plan.md 5c): counts, one entry per merged wall
 * that differed, and `seen` (false/absent = the report has not been shown to the user yet).
 */
export const ConversionSchema = z.object({
  /** ISO time of the conversion. */
  at: z.string(),
  report: z.object({
    entries: z.array(ConversionReportEntrySchema).default([]),
    counts: ConversionCountsSchema,
  }),
  seen: z.boolean().optional(),
})

export const PlanDocV1Schema = z.object({
  schemaVersion: SchemaVersionSchema.optional().default(1),
  projectId: z.string().min(1).default('local'),
  title: z.string().default(''),
  background: BackgroundImageSchema.optional(),
  rooms: z.array(RoomSchema).default([]),
  elements: z.array(WallElementSchema).default([]),
  measurements: z.record(z.string(), MeasurementSchema).default({}),
  roomNotes: z.record(z.string(), z.string()).default({}),
  tapes: z.array(TapeMeasureSchema).default([]),
  pins: z.array(PinSchema).default([]),
  apartment: ApartmentSchema.optional(),
  nodes: z.array(StoredNodeSchema).optional(),
  walls: z.array(StoredWallSchema).optional(),
  oldMeasurements: z.array(OldMeasurementSchema).optional(),
  // Traced walls (docs/walls-plan.md phase 6). Optional: a document saved before it has none.
  traces: z.array(TraceWallSchema).optional(),
  // Conversion to walls as the source (phase 5c). Optional: a document never converted has none.
  conversion: ConversionSchema.optional(),
})

/**
 * A parsed document. The name stays `PlanDocV1` for the imports that use it: it holds a v1 OR a v2
 * document (`schemaVersion` 1 or 2), because both are read and written by the same code.
 */
export type PlanDocV1 = PlanDoc & { schemaVersion: 1 | 2; pins: NonNullable<PlanDoc['pins']> }

/** Schema for PUT /api/projects/:id/snapshot request bodies. */
export const SnapshotPutBodySchema = z.object({
  schemaVersion: SchemaVersionSchema.optional().default(1),
  baseVersion: z.number().int().min(0),
  projectId: z.string().min(1).optional(),
  title: z.string().optional(),
  background: BackgroundImageSchema.optional(),
  rooms: z.array(RoomSchema).optional().default([]),
  elements: z.array(WallElementSchema).optional().default([]),
  tapes: z.array(TapeMeasureSchema).optional().default([]),
  pins: z.array(PinSchema).optional().default([]),
  // Ignored on snapshot write (stored in separate tables), allowed if client sends full doc.
  measurements: z.record(z.string(), MeasurementSchema).optional(),
  roomNotes: z.record(z.string(), z.string()).optional(),
  apartment: ApartmentSchema.optional(),
  nodes: z.array(StoredNodeSchema).optional(),
  walls: z.array(StoredWallSchema).optional(),
  oldMeasurements: z.array(OldMeasurementSchema).optional(),
  // Traced walls are a doc field of the snapshot, like rooms (kept with the geometry).
  traces: z.array(TraceWallSchema).optional(),
  // Conversion report (phase 5c): kept with the snapshot, so it is shown once per project.
  conversion: ConversionSchema.optional(),
})

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Migrate and validate raw JSON into a PlanDoc v1.
 * Fills in missing optional fields from older saved documents (schemaVersion, pins, tapes, holes, walls, walkOrder...).
 */
export function parsePlan(json: unknown): PlanDocV1 {
  if (!isRecord(json)) {
    return PlanDocV1Schema.parse(json) as PlanDocV1
  }
  const rawRooms = Array.isArray(json.rooms) ? json.rooms : []
  const rooms = rawRooms.map((r, idx) => {
    if (!isRecord(r)) return r
    return {
      ...r,
      holes: Array.isArray(r.holes) ? r.holes : [],
      walls: isRecord(r.walls) ? r.walls : {},
      walkOrder: typeof r.walkOrder === 'number' && Number.isFinite(r.walkOrder) ? r.walkOrder : idx + 1,
    }
  })

  const rawPins = Array.isArray(json.pins) ? json.pins : []
  const pins = rawPins.map((p) => {
    if (!isRecord(p)) return p
    return {
      ...p,
      photoKeys: Array.isArray(p.photoKeys) ? p.photoKeys : [],
    }
  })

  const migrated: Record<string, unknown> = {
    ...json,
    schemaVersion: json.schemaVersion ?? 1,
    projectId: typeof json.projectId === 'string' && json.projectId.length > 0 ? json.projectId : 'local',
    title: typeof json.title === 'string' ? json.title : '',
    rooms,
    elements: Array.isArray(json.elements) ? json.elements : [],
    measurements: isRecord(json.measurements) ? json.measurements : {},
    roomNotes: isRecord(json.roomNotes) ? json.roomNotes : {},
    tapes: Array.isArray(json.tapes) ? json.tapes : [],
    pins,
    // Traced walls (phase 6): a document saved before it has no field, not an empty one.
    ...(Array.isArray(json.traces) ? { traces: json.traces } : {}),
  }

  return PlanDocV1Schema.parse(migrated) as PlanDocV1
}

export function safeParsePlan(json: unknown): { ok: true; doc: PlanDocV1 } | { ok: false; error: z.ZodError } {
  try {
    return { ok: true, doc: parsePlan(json) }
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err }
    throw err
  }
}

/** Export JSON Schema (draft-2020-12) for PlanDoc v1. */
export function planJsonSchema(): Record<string, unknown> {
  return {
    $id: 'https://simple-floorplan.local/api/schema/plan.v1.json',
    title: 'Simple Floorplan PlanDoc v1',
    ...z.toJSONSchema(PlanDocV1Schema),
  }
}
