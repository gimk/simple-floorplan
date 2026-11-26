// Zod 4 validation for the v2 ProjectDoc, plus the default (empty) project.
import { z } from 'zod'
import type { Artboard, ProjectDoc } from './types'

const num = z.number().finite()
const vec = z.object({ x: num, y: num })

export const roomSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  vertices: z.array(vec),
  fill: z.string().optional(),
})

export const openingSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['door', 'window', 'opening']),
  xCm: num,
  yCm: num,
  angleDeg: num,
  widthCm: num.positive(),
  hinge: z.enum(['left', 'right']).optional(),
  swing: z.enum(['in', 'out']).optional(),
  heightCm: num.positive().optional(),
  sillCm: num.min(0).optional(),
  variant: z.enum(['standard', 'pocket', 'bypass', 'french', 'sliding']).optional(),
})

export const furnitureSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  shape: z.enum(['rect', 'circle']),
  xCm: num,
  yCm: num,
  widthCm: num.positive(),
  depthCm: num.positive(),
  rotationDeg: num,
  color: z.string(),
  heightCm: num.positive().optional(),
  showDirection: z.boolean().optional(),
  cornerRadiusCm: z.number().min(0).optional(),
})

export const artboardSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  xCm: num,
  yCm: num,
  ceilingHeightCm: num.positive().default(250),
  precisionCm: z.union([z.literal(0.1), z.literal(0.5), z.literal(1)]).default(1),
  widthCm: num.positive().optional(),
  heightCm: num.positive().optional(),
  rooms: z.array(roomSchema),
  openings: z.array(openingSchema),
  furniture: z.array(furnitureSchema),
})

export const refImageSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  src: z.string(),
  naturalWidth: num.positive(),
  naturalHeight: num.positive(),
  xCm: num,
  yCm: num,
  cmPerPx: num.positive(),
  rotationDeg: num,
  opacity: num.min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
})

export const projectDocSchema = z.object({
  schemaVersion: z.literal(3),
  id: z.string().min(1),
  title: z.string(),
  refImages: z.array(refImageSchema),
  artboards: z.array(artboardSchema).min(1),
})

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function createArtboard(name: string, xCm = 0, yCm = 0): Artboard {
  return { id: newId(), name, xCm, yCm, ceilingHeightCm: 250, precisionCm: 1, rooms: [], openings: [], furniture: [] }
}

export function createDefaultProject(): ProjectDoc {
  return { schemaVersion: 3, id: newId(), title: 'Untitled project', refImages: [], artboards: [createArtboard('Plan A')] }
}

export type ParseResult = { ok: true; doc: ProjectDoc } | { ok: false; error: string }

/** Validate unknown data as a ProjectDoc. Never throws. */
export function parseProjectDoc(data: unknown): ParseResult {
  const r = projectDocSchema.safeParse(data)
  if (r.success) return { ok: true, doc: r.data as ProjectDoc }
  const i = r.error.issues[0]
  return { ok: false, error: i ? `${i.path.join('.') || 'document'}: ${i.message}` : 'Invalid project file' }
}
