// Display names of the layers. A separate module, so the sidebar section and the canvas
// View menu can both name them without importing each other.
import type { Layers } from '../../model/store'

export const LAYER_LABELS: Record<keyof Layers, string> = {
  background: 'Background image',
  dimensions: 'Dimensions',
  bearingHighlight: 'Bearing walls highlight',
  openings: 'Openings',
  notes: 'Notes',
  clashes: 'Clearance clashes',
  roomCodes: 'Room codes',
  wallLabels: 'Wall labels',
  outsideDims: 'Outside dimensions',
}
