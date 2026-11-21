import type { Room, WallProps, WallType } from '../../model/types'

export const DEFAULT_THICKNESS: Record<WallType, number> = { partition: 10, bearing: 25, exterior: 30 }

/** Wall props for the wall starting at `startId`; default partition 10 cm. */
export const wallProps = (room: Room, startId: string): WallProps =>
  room.walls[startId] ?? { type: 'partition', thicknessCm: DEFAULT_THICKNESS.partition }
