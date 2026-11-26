// Simple Floorplan 2 data model. Units: cm and degrees. Rooms are independent polygons (zero wall thickness).
import type { Vec } from './geometry'

export type { Vec }

export type RoomShape = { id: string; name: string; vertices: Vec[]; fill?: string }
export type Room = RoomShape

export type OpeningKind = 'door' | 'window' | 'opening'

export type Opening = {
  id: string
  kind: OpeningKind
  /** Centre of the opening on the wall, in artboard-local cm. */
  xCm: number
  yCm: number
  angleDeg: number
  widthCm: number
  hinge?: 'left' | 'right'
  swing?: 'in' | 'out'
  heightCm?: number
  sillCm?: number
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
}

export type Artboard = {
  id: string
  name: string
  xCm: number
  yCm: number
  ceilingHeightCm: number
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
  | { kind: 'opening'; artboardId: string; openingId: string }
  | { kind: 'furniture'; artboardId: string; furnitureId: string }
  | { kind: 'refImage'; imageId: string }
