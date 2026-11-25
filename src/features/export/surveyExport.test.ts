// Survey tables (PDF and CSV): a built-in storage has its own rows under its parent room, with the
// name "Storage (<parent name>)" (docs/storage-plan.md, step 3 rule).
import { describe, expect, it } from 'vitest'
import { applyBatch } from '../../core/commands'
import { parsePlan } from '../../core/schema'
import { itemRows, surveyCsv, surveyRows } from './surveyExport'

function base() {
  return parsePlan({
    projectId: 'p1',
    title: 'Apt',
    rooms: [],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
    pins: [],
  })
}

/** SE with a built-in storage on SE-4, then CU. */
function storageDoc() {
  return applyBatch(base(), [
    { type: 'add_room', code: 'SE', name: 'Bedroom 1', rect: { x: 0, y: 0, w: 400, h: 300 }, walkOrder: 1 },
    { type: 'add_room', code: 'CU', name: 'Kitchen', rect: { x: 400, y: 0, w: 200, h: 300 }, walkOrder: 2 },
    { type: 'add_storage', room: 'SE', wall: 'SE-4', offsetCm: 100, widthCm: 60, depthCm: 40, door: 'single' },
  ]).doc
}

describe('survey rows and built-in storage', () => {
  it('names the storage rows "Storage (Bedroom 1)" and lists them under the room', () => {
    const doc = storageDoc()
    const rows = surveyRows(doc)
    const storageCode = doc.rooms.find((r) => r.storage)!.code
    const storageRows = rows.filter((r) => r.roomCode === storageCode)
    expect(storageRows.length).toBeGreaterThan(0)
    for (const r of storageRows) expect(r.roomName).toBe('Storage (Bedroom 1)')
    // The rows of the storage come just after the rows of its parent room, before the next room.
    const lastParentRow = rows.map((r) => r.roomCode).lastIndexOf('SE')
    const firstStorageRow = rows.map((r) => r.roomCode).indexOf(storageCode)
    const nextRoomRow = rows.map((r) => r.roomCode).findIndex((c) => c !== 'SE' && c !== storageCode)
    expect(firstStorageRow).toBe(lastParentRow + 1)
    expect(nextRoomRow).toBeGreaterThan(firstStorageRow)
  })

  it('writes the storage name in the CSV and the front door like any door', () => {
    const doc = storageDoc()
    const csv = surveyCsv(doc)
    expect(csv).toContain('Storage (Bedroom 1)')
    // The front door of the storage is an item of the parent room, on the host wall.
    const items = itemRows(doc).filter((r) => r.roomCode === 'SE')
    expect(items).toHaveLength(1)
    expect(items[0].type).toContain('Door')
    expect(items[0].fromStartCm).toBe(105)
    expect(items[0].widthCm).toBe(60)
    // The storage itself has no item: its front door is the door above.
    const storageCode = doc.rooms.find((r) => r.storage)!.code
    expect(itemRows(doc).filter((r) => r.roomCode === storageCode)).toEqual([])
  })
})
