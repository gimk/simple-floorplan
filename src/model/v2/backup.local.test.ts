// Real data, LOCAL ONLY: reads the private D1 backups in `backups/*.sql` (never committed) and runs
// the v1 -> v2 conversion on the latest snapshot of every project (docs/walls-plan.md, phase 5c).
//
// The test logs COUNTS ONLY (files, snapshots, projects, rooms, walls, report entries, problems):
// never a project name, a room name or a measured value.
// No backup folder (CI, another machine): the whole suite is skipped.
//
// The backup is a `wrangler d1 export` SQL file: one INSERT per table, with SQL string literals
// (`''` is one quote inside a literal). Only `floorplan_snapshots` is read.
import { describe, expect, it } from 'vitest'
import { parsePlan } from '../../core/schema'
import { ensureStoredGraph } from '../graphRule'
import type { PlanDoc } from '../types'
import { convertToV2 } from './convert'
import { conversionProblems } from './invariants'

// The app tsconfig holds no Node types (it is a browser app), so node:fs is loaded through a
// variable specifier: TypeScript then does not need the Node declarations. This runs in Node only.
type Fs = {
  existsSync: (path: unknown) => boolean
  readdirSync: (path: unknown) => string[]
  readFileSync: (path: unknown, encoding: string) => string
}
const fs = (await import('node:fs' as string)) as Fs

const BACKUP_DIR = new URL('../../../backups/', import.meta.url)

/** SQL files of the backup folder (empty when the folder does not exist). */
function backupFiles(): string[] {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs.readdirSync(BACKUP_DIR).filter((n) => n.endsWith('.sql')).sort()
}

type Row = Record<string, string>

/**
 * The rows of every `INSERT INTO "floorplan_snapshots"` of one SQL file, one object per row keyed
 * by column name. A string literal is read with its `''` escapes; no other value can contain a
 * quote, so the scan is enough and no SQL engine is needed.
 */
function snapshotRows(sql: string): Row[] {
  const MARK = 'INSERT INTO "floorplan_snapshots"'
  const rows: Row[] = []
  let at = sql.indexOf(MARK)
  while (at >= 0) {
    const headEnd = sql.indexOf(')', at)
    const valuesAt = sql.indexOf('VALUES', headEnd)
    if (headEnd < 0 || valuesAt < 0) break
    const columns = [...sql.slice(at + MARK.length, headEnd).matchAll(/"([^"]+)"/g)].map((m) => m[1])
    const end = readRows(sql, valuesAt + 'VALUES'.length, columns, rows)
    at = sql.indexOf(MARK, end)
  }
  return rows
}

/** Reads `('..','..'),('..','..');` into `rows`, and gives the position after the statement. */
function readRows(sql: string, start: number, columns: string[], out: Row[]): number {
  let i = start
  let row: string[] | null = null
  let field = ''
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'") {
      i++
      const next = readLiteral(sql, i)
      field += next.text
      i = next.end
      continue
    }
    if (ch === '(') {
      row = []
      field = ''
      i++
      continue
    }
    if (ch === ')') {
      if (row) {
        row.push(field)
        const record: Row = {}
        columns.forEach((c, k) => { record[c] = row?.[k] ?? '' })
        out.push(record)
      }
      row = null
      field = ''
      i++
      continue
    }
    if (ch === ',') {
      if (row) {
        row.push(field)
        field = ''
      }
      i++
      continue
    }
    if (ch === ';') return i + 1
    if (row) field += ch
    i++
  }
  return i
}

/** Value of a SQL string literal (the opening quote is already read). `''` is one quote. */
function readLiteral(sql: string, start: number): { text: string; end: number } {
  let text = ''
  let i = start
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        text += "'"
        i += 2
        continue
      }
      return { text, end: i + 1 }
    }
    text += sql[i]
    i++
  }
  return { text, end: i }
}

/** The latest snapshot of every project of the backup folder. */
function latestSnapshots(): { snapshots: number; docs: PlanDoc[] } {
  const latest = new Map<string, { version: number; createdAt: string; data: string }>()
  let snapshots = 0
  for (const name of backupFiles()) {
    let sql: string
    try {
      sql = fs.readFileSync(new URL(name, BACKUP_DIR), 'utf8')
    } catch {
      continue
    }
    for (const row of snapshotRows(sql)) {
      snapshots++
      const project = row.project_id ?? ''
      const version = Number(row.version)
      const createdAt = row.created_at ?? ''
      const known = latest.get(project)
      const newer = !known || version > known.version || (version === known.version && createdAt >= known.createdAt)
      if (newer) latest.set(project, { version, createdAt, data: row.data_json ?? '' })
    }
  }
  const docs: PlanDoc[] = []
  for (const snap of latest.values()) {
    try {
      docs.push(ensureStoredGraph(parsePlan(JSON.parse(snap.data))))
    } catch {
      // A snapshot that the schema of today cannot read says nothing about the conversion.
    }
  }
  return { snapshots, docs }
}

const backups = backupFiles()
const real = backups.length ? latestSnapshots() : { snapshots: 0, docs: [] }

describe.skipIf(backups.length === 0)('the real projects of the local backup', () => {
  it('convert without moving a room, a label, an area or a value', () => {
    let rooms = 0
    let walls = 0
    let entries = 0
    let dropped = 0
    const problems: string[] = []
    for (const doc of real.docs) {
      const { doc: v2, report } = convertToV2(doc)
      rooms += v2.rooms.length
      walls += v2.walls?.length ?? 0
      entries += report.entries.length
      dropped += report.counts.droppedRoomWalls
      for (const p of conversionProblems(doc, v2)) problems.push(p)
      expect(v2.schemaVersion).toBe(2)
    }
    // Counts only: no name, no measured value.
    console.log(
      `[v2 backup] files ${backups.length}, snapshots ${real.snapshots}, projects ${real.docs.length}; ` +
      `rooms ${rooms}, walls ${walls}, report entries ${entries}, room walls without a face ${dropped}, problems ${problems.length}`,
    )
    expect(real.docs.length).toBeGreaterThan(0)
    expect(problems).toEqual([])
  })
})
