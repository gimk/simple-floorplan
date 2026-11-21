// OWNER: rooms agent. Contract: keep these export names and signatures.
import type { FC } from 'react'
import { roomTools } from './tools'

export { RoomsLayer } from './RoomsLayer'
export { RoomsPanel } from './RoomsPanel'
/** Tool overlays, keyed by ToolId. */
export const RoomTools: Record<'select' | 'rect' | 'polygon' | 'slice' | 'cutout', FC> = roomTools
