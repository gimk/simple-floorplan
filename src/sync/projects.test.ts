import { describe, expect, it } from 'vitest'
import {
  POLL_FAST_MS, POLL_SLOW_MS, PRUNE_SNAPSHOTS_SQL, SNAPSHOTS_TO_KEEP, collectDataUrls, isLocalId,
  mergeProjectLists, pollIntervalMs, projectKey, pruneCutoffVersion, pruneSnapshotVersions, replacePhoto,
  titlePatchForDoc,
} from './projects'

describe('project keys', () => {
  it('are per project', () => {
    expect(projectKey('version', 'a')).not.toBe(projectKey('version', 'b'))
    expect(projectKey('since', 'a')).toBe('simple-floorplan:since:a')
  })
  it('detects local ids', () => {
    expect(isLocalId('local')).toBe(true)
    expect(isLocalId('local-abc')).toBe(true)
    expect(isLocalId('3f2a-uuid')).toBe(false)
  })
})

describe('mergeProjectLists', () => {
  it('shows only local projects when offline', () => {
    const l = mergeProjectLists(null, [{ id: 'local', title: 'Flat', savedAt: '2026-01-01T00:00:00Z' }])
    expect(l).toEqual([{ id: 'local', name: 'Flat', updatedAt: '2026-01-01T00:00:00Z', remote: false, local: true }])
  })
  it('merges by id, prefers the local title, sorts newest first', () => {
    const l = mergeProjectLists(
      [
        { id: 'a', name: 'A', title: 'Old A', updatedAt: '2026-02-01T00:00:00Z' },
        { id: 'b', name: 'B', title: null, updatedAt: '2026-03-01T00:00:00Z' },
      ],
      [{ id: 'a', title: 'New A', savedAt: '2026-02-02T00:00:00Z' }],
    )
    expect(l.map((p) => p.id)).toEqual(['b', 'a'])
    expect(l[1]).toMatchObject({ name: 'New A', remote: true, local: true })
    expect(l[0]).toMatchObject({ name: 'B', remote: true, local: false })
  })
})

describe('titlePatchForDoc', () => {
  it('sends a PATCH when the doc title changes', () => {
    expect(titlePatchForDoc('New apartment', 'Demo apartment')).toEqual({ title: 'Demo apartment' })
  })
  it('returns null when the title is unchanged or blank', () => {
    expect(titlePatchForDoc('Demo apartment', 'Demo apartment')).toBeNull()
    expect(titlePatchForDoc('A', '')).toBeNull()
    expect(titlePatchForDoc('A', '   ')).toBeNull()
  })
})

describe('pollIntervalMs', () => {
  it('is fast only when visible and measuring', () => {
    expect(pollIntervalMs(true, true)).toBe(POLL_FAST_MS)
    expect(pollIntervalMs(true, false)).toBe(POLL_SLOW_MS)
    expect(pollIntervalMs(false, true)).toBe(POLL_SLOW_MS)
  })
})

describe('snapshot pruning', () => {
  it('keeps the last 50', () => {
    expect(pruneCutoffVersion(50)).toBe(0) // versions 1..50 all stay
    expect(pruneCutoffVersion(51)).toBe(1) // version 1 is deleted
    expect(pruneCutoffVersion(120)).toBe(120 - SNAPSHOTS_TO_KEEP)
    expect(pruneCutoffVersion(3)).toBeLessThan(1) // nothing to delete
  })
})

describe('photos', () => {
  const pins = [{ id: 'p1', photoKeys: ['data:image/jpeg;base64,AAA', 'proj/x.jpg'] }, { id: 'p2' }, { id: 'p3', photoKeys: ['data:image/jpeg;base64,AAA'] }]
  it('collects unique data URLs only', () => {
    expect(collectDataUrls(pins)).toEqual(['data:image/jpeg;base64,AAA'])
    expect(collectDataUrls(undefined)).toEqual([])
  })
  it('replaces a data URL by its key everywhere, keeps identity if nothing matched', () => {
    const next = replacePhoto(pins, 'data:image/jpeg;base64,AAA', 'proj/new.jpg')
    expect(next[0].photoKeys).toEqual(['proj/new.jpg', 'proj/x.jpg'])
    expect(next[2].photoKeys).toEqual(['proj/new.jpg'])
    expect(next[1]).toBe(pins[1])
    expect(replacePhoto(pins, 'data:nope', 'k')).toBe(pins)
  })
})

describe('photos: sketch keys follow the upload', () => {
  const mark = { id: 'mk1', a: { x: 0.1, y: 0.2 }, b: { x: 0.6, y: 0.2 }, valueCm: 250 }
  const dataUrl = 'data:image/jpeg;base64,AAA'

  it('moves the marks of the photo to its R2 key', () => {
    const pins = [{ id: 'p1', photoKeys: [dataUrl, 'proj/x.jpg'], sketches: { [dataUrl]: [mark] } }]
    const next = replacePhoto(pins, dataUrl, 'proj/new.jpg')
    expect(next[0].photoKeys).toEqual(['proj/new.jpg', 'proj/x.jpg'])
    expect(next[0].sketches).toEqual({ 'proj/new.jpg': [mark] })
    expect(pins[0].sketches).toEqual({ [dataUrl]: [mark] }) // input untouched
  })

  it('merges with marks already stored on the new key', () => {
    const other = { ...mark, id: 'mk2' }
    const pins = [{ id: 'p1', photoKeys: [dataUrl], sketches: { [dataUrl]: [mark], 'proj/new.jpg': [other] } }]
    const next = replacePhoto(pins, dataUrl, 'proj/new.jpg')
    expect(next[0].sketches).toEqual({ 'proj/new.jpg': [other, mark] })
  })

  it('leaves pins without sketches and other photos alone', () => {
    const pins = [{ id: 'p1', photoKeys: [dataUrl] }, { id: 'p2', photoKeys: ['proj/x.jpg'], sketches: { 'proj/x.jpg': [mark] } }]
    const next = replacePhoto(pins, dataUrl, 'proj/new.jpg')
    expect(next[0]).toEqual({ id: 'p1', photoKeys: ['proj/new.jpg'] })
    expect(next[1]).toBe(pins[1])
  })
})

describe('snapshot pruning (walls-plan 5c: no v1 snapshot is deleted after the conversion)', () => {
  const v1 = (version: number) => ({ version, schemaVersion: 1 })
  const v2 = (version: number) => ({ version, schemaVersion: 2 })
  const unversioned = (version: number) => ({ version })

  it('keeps the last 50 versions and deletes the older ones', () => {
    const rows = Array.from({ length: 60 }, (_, i) => v2(i + 1))
    expect(pruneCutoffVersion(60)).toBe(10)
    expect(pruneSnapshotVersions(rows)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(pruneSnapshotVersions([v2(1), v2(2)])).toEqual([])
    expect(pruneSnapshotVersions([], 50)).toEqual([])
  })

  it('never deletes a v1 (or unversioned) snapshot while the project has a v2 snapshot', () => {
    // 60 snapshots before the conversion, then the conversion wrote v2 at version 61.
    const rows = [...Array.from({ length: 60 }, (_, i) => v1(i + 1)), v2(61)]
    expect(pruneSnapshotVersions(rows)).toEqual([])
    // A snapshot saved long ago without schemaVersion is a v1 snapshot too.
    const mixed = [...Array.from({ length: 55 }, (_, i) => unversioned(i + 1)), v2(56)]
    expect(pruneSnapshotVersions(mixed)).toEqual([])
  })

  it('prunes v2 snapshots of a converted project, and keeps the v1 ones', () => {
    const rows = [v1(1), v1(2), ...Array.from({ length: 55 }, (_, i) => v2(i + 3))]
    // Newest version 57: versions <= 7 go, but not 1 and 2 (they are v1 snapshots).
    expect(pruneSnapshotVersions(rows)).toEqual([3, 4, 5, 6, 7])
  })

  it('prunes normally when the project has no v2 snapshot (a project not converted yet)', () => {
    const rows = Array.from({ length: 55 }, (_, i) => v1(i + 1))
    expect(pruneSnapshotVersions(rows)).toEqual([1, 2, 3, 4, 5])
  })

  it('the SQL applies the same rule, and takes the project id twice', () => {
    expect(PRUNE_SNAPSHOTS_SQL).toContain("json_extract(data_json, '$.schemaVersion')")
    expect(PRUNE_SNAPSHOTS_SQL).toContain('COALESCE')
    expect(PRUNE_SNAPSHOTS_SQL).toContain('EXISTS')
    // Bind order: project id, cutoff version, project id of the subquery.
    expect(PRUNE_SNAPSHOTS_SQL.split('?')).toHaveLength(4)
  })
})
