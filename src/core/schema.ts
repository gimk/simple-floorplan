// Versioned Zod schema for PlanDoc v1, migration of legacy docs, and JSON Schema export.
// Zero React/DOM dependencies — safe for browser, Node, and Cloudflare Workers.
import { z } from 'zod'
import type { PlanDoc } from '../model/types'

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

export const WallPropsSchema = z.object({
  type: WallTypeSchema,
  thicknessCm: z.number().finite().positive(),
  locked: z.boolean().optional(),
})

export const RoomSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string(),
  vertices: z.array(VertexSchema).min(3),
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

export const MeasurementSchema = z.object({
  label: z.string().min(1),
  actualCm: z.number().finite().positive(),
  updatedAt: z.string(),
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

export const PinSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().optional(),
  at: VecSchema,
  wallStart: z.string().optional(),
  text: z.string().optional(),
  photoKeys: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const PlanDocV1Schema = z.object({
  schemaVersion: z.literal(1).optional().default(1),
  projectId: z.string().min(1).default('local'),
  title: z.string().default(''),
  background: BackgroundImageSchema.optional(),
  rooms: z.array(RoomSchema).default([]),
  elements: z.array(WallElementSchema).default([]),
  measurements: z.record(z.string(), MeasurementSchema).default({}),
  roomNotes: z.record(z.string(), z.string()).default({}),
  tapes: z.array(TapeMeasureSchema).default([]),
  pins: z.array(PinSchema).default([]),
})

export type PlanDocV1 = PlanDoc & { schemaVersion: 1; pins: NonNullable<PlanDoc['pins']> }

/** Schema for PUT /api/projects/:id/snapshot request bodies. */
export const SnapshotPutBodySchema = z.object({
  schemaVersion: z.literal(1).optional().default(1),
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
