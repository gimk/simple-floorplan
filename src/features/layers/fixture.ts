// Synthetic plan for the Layers tests: 2 rooms, 1 storage, 1 standalone wall, 2 overlapping walls.
import type { PlanDoc, Room, WallElement } from '../../model/types'

const rect = (id: string, code: string, name: string, x: number, y: number, w: number, h: number, walkOrder: number, extra: Partial<Room> = {}): Room => ({
  id, code, name, walkOrder, holes: [], walls: {},
  vertices: [
    { id: `${id}0`, x, y }, { id: `${id}1`, x: x + w, y }, { id: `${id}2`, x: x + w, y: y + h }, { id: `${id}3`, x, y: y + h },
  ],
  ...extra,
})

const door = (id: string, roomId: string, wallStart: string): WallElement => ({
  id, roomId, wallStart, kind: 'door', offsetCm: 20, widthCm: 90,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
})

export const layersDoc = (): PlanDoc => ({
  projectId: 'test',
  title: 'Test',
  // Walk order is not the array order: R2 comes first in the array.
  rooms: [
    rect('r2', 'R2', 'Salon', 400, 0, 300, 300, 1),
    rect('s1', 'S1', 'Placard', 0, 0, 50, 50, 2, { storage: { parentRoomId: 'r1' } }),
    rect('r1', 'R1', 'Cuisine', 0, 0, 400, 300, 0, { walls: { r10: { type: 'bearing', thicknessCm: 25, locked: true } } }),
  ],
  elements: [door('d1', 'r1', 'r10'), door('d2', 'r2', 'r20')],
  measurements: {},
  roomNotes: {},
  tapes: [],
  nodes: [
    { id: 'N1', x: 0, y: 0 }, { id: 'N2', x: 400, y: 0 },
    { id: 'N3', x: 0, y: 1000 }, { id: 'N4', x: 200, y: 1000 },
    { id: 'N5', x: 0, y: 2000 }, { id: 'N6', x: 100, y: 2000 },
    { id: 'N7', x: 50, y: 2000 }, { id: 'N8', x: 150, y: 2000 },
  ],
  walls: [
    // Wall of R1 (first side).
    { id: 'W1', a: 'N1', b: 'N2', faces: [{ side: 'L', roomId: 'r1', wallStart: 'r10', from: 0, to: 400 }] },
    // Standalone wall, alone on its line.
    { id: 'W2', a: 'N3', b: 'N4', faces: [], standalone: true },
    // Two walls on one line that overlap by 50 cm.
    { id: 'W3', a: 'N5', b: 'N6', faces: [], standalone: true },
    { id: 'W4', a: 'N7', b: 'N8', faces: [], standalone: true },
  ],
})
