// OWNER: rooms agent. Contract: keep these export names and signatures.
import type { FC } from 'react'
import { roomTools } from './tools'

export { RoomsLayer } from './RoomsLayer'
export { RoomsPanel } from './RoomsPanel'
/** Traced walls of the Wall tool (docs/walls-plan.md phase 6). */
export { TracesLayer } from './TracesLayer'
/** Tool overlays of the Wall tool and the Make room tool (phase 6). */
export { WallTool } from './wallTool'
export { MakeRoomTool } from './makeRoomTool'
/** Tool overlays, keyed by ToolId. */
export const RoomTools: Record<'select' | 'rect' | 'polygon' | 'slice' | 'cutout', FC> = roomTools
