// Demo apartment: 12 rooms from the on-site survey prototype, converted from prototype pixels to cm.
import { useDoc } from '../../model/store'
import type { Room } from '../../model/types'

const K = 1.6 // cm per prototype pixel (Séjour ≈ 440 cm wide)
type P = [number, number]
const rect = (x: number, y: number, w: number, h: number): P[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

const PROTOTYPE: { code: string; name: string; pts: P[]; diag?: [number, number]; outdoor?: boolean }[] = [
  { code: 'EN', name: 'Entrée', pts: [[405, 650], [561, 650], [561, 811], [521, 811], [521, 898], [405, 898]] },
  { code: 'SE', name: 'Séjour', pts: [[430, 194], [705, 194], [705, 556], [561, 556], [561, 650], [430, 650]], diag: [0, 2] },
  { code: 'CU', name: 'Cuisine', pts: rect(561, 556, 144, 255), diag: [0, 2] },
  { code: 'DG', name: 'Dégagement', pts: rect(521, 811, 184, 83) },
  { code: 'SD', name: 'Sde/wc', pts: rect(521, 894, 184, 135) },
  { code: 'C1', name: 'Chambre 1', pts: rect(705, 781, 203, 248), diag: [0, 2] },
  { code: 'CO', name: 'Couloir', pts: [[266, 470], [330, 470], [330, 669], [405, 669], [405, 751], [266, 751]] },
  { code: 'SB', name: 'Sdb', pts: rect(330, 470, 100, 139) },
  { code: 'WC', name: 'Wc', pts: rect(330, 609, 75, 60) },
  { code: 'C2', name: 'Chambre 2', pts: rect(90, 470, 176, 281), diag: [0, 2] },
  { code: 'C3', name: 'Chambre 3', pts: rect(195, 264, 235, 206), diag: [0, 2] },
  { code: 'TE', name: 'Terrasse', pts: [[240, 264], [240, 215], [422, 110], [650, 110], [650, 194], [430, 194], [430, 264]], outdoor: true },
]

/** The 12 demo rooms. Same prototype point -> same cm value, so shared walls stay exactly aligned. */
export function demoRooms(): Room[] {
  return PROTOTYPE.map((r, n) => ({
    id: `demo-${r.code}`,
    code: r.code,
    name: r.name,
    walkOrder: n,
    vertices: r.pts.map(([x, y], i) => ({ id: `demo-${r.code}-v${i}`, x: Math.round((x - 70) * K), y: Math.round((y - 95) * K) })),
    holes: [],
    walls: {},
    ...(r.diag ? { diagonal: r.diag } : {}),
    ...(r.outdoor ? { outdoor: true } : {}),
  }))
}

/** Fill an empty document with the demo apartment. */
export function loadDemoApartment() {
  useDoc.getState().update((d) => ({
    ...d,
    title: d.title === 'New apartment' ? 'Demo apartment' : d.title,
    rooms: demoRooms(),
  }))
}
