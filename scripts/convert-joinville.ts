// One-off: convert the saved v1 Joinville backup to a v2 JSON file (inside git-ignored backups/).
// Run: npx tsx scripts/convert-joinville.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { convertV1ToV2 } from '../src/sync/convertV1'
import { parseProjectDoc } from '../src/model/schema'
import { area } from '../src/model/geometry'

const dir = 'backups/v1-export-2026-11-26'
const raw = JSON.parse(readFileSync(`${dir}/joinville-plan.json`, 'utf8'))
const webp = readdirSync(`${dir}/r2`, { recursive: true }).map(String).find((f) => f.endsWith('.webp'))
if (!webp) throw new Error('no webp scan found')
const dataUrl = `data:image/webp;base64,${readFileSync(`${dir}/r2/${webp}`).toString('base64')}`
const doc = convertV1ToV2(raw, { refImageDataUrl: dataUrl, refImageName: 'Joinville scan' })
const check = parseProjectDoc(doc)
if (!check.ok) throw new Error(check.error)
writeFileSync(`${dir}/joinville-v2.json`, JSON.stringify(doc, null, 2))
const rooms = doc.artboards.flatMap((a) => a.rooms)
console.log({
  artboards: doc.artboards.length,
  rooms: rooms.length,
  totalAreaM2: Math.round(rooms.reduce((s, r) => s + area(r.vertices), 0) / 100) / 100,
  openings: doc.artboards.reduce((s, a) => s + a.openings.length, 0),
  refImages: doc.refImages.length,
})
