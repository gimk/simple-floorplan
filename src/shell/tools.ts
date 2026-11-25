// The tools of the left tool bar, in display order. Moved out of App.tsx so that the
// command palette (docs/measurements-plan.md section 7) can list them without importing the shell.
import {
  BrickWall, Crosshair, DoorOpen, Hand, MapPin, MousePointer2, PenTool, Ruler, Scissors,
  Square, SquareDashed, SquareDashedMousePointer,
} from 'lucide-react'
import type { ToolId } from '../model/types'

export type ToolSpec = {
  id: ToolId
  label: string
  /** Letter key of the tool (lower case). */
  key: string
  icon: typeof Square
}

export const TOOLS: ToolSpec[] = [
  { id: 'select', label: 'Select', key: 'v', icon: MousePointer2 },
  { id: 'pan', label: 'Pan', key: 'h', icon: Hand },
  { id: 'rect', label: 'Rectangle room', key: 'r', icon: Square },
  { id: 'polygon', label: 'Polygon room', key: 'p', icon: PenTool },
  { id: 'wall', label: 'Wall', key: 'w', icon: BrickWall },
  { id: 'make-room', label: 'Make room', key: 'm', icon: SquareDashedMousePointer },
  { id: 'slice', label: 'Slice room', key: 's', icon: Scissors },
  { id: 'cutout', label: 'Cutout', key: 'x', icon: SquareDashed },
  { id: 'place-element', label: 'Door / window', key: 'd', icon: DoorOpen },
  { id: 'calibrate', label: 'Calibrate scale', key: 'c', icon: Crosshair },
  { id: 'tape', label: 'Tape measure', key: 't', icon: Ruler },
  { id: 'pin', label: 'Note / photo pin', key: 'n', icon: MapPin },
]
