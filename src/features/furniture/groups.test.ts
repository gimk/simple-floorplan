// Tests for flat furniture groups: actions (group/ungroup, contiguous order, undo, 1-member clean-up),
// pure click/double-click/Esc/expandToGroups helpers, duplicate new groupId, agent commands, and schema validation.
import { beforeEach, describe, expect, it } from 'vitest'
import { applyCommand } from '../../core/commands'
import { validateProject } from '../../core/validate'
import { createArtboard, createDefaultProject, parseProjectDoc } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem, ProjectDoc } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import {
  deleteFurniture,
  deleteFurnitureGroup,
  duplicateFurniture,
  duplicateFurnitureGroup,
  groupFurniture,
  setFurnitureSelection,
  ungroupFurniture,
} from './actions'
import {
  expandToGroups,
  hasAnyGroupedItem,
  isSingleWholeGroup,
  resolveEscapeGroupSelection,
  resolveFurnitureClick,
  resolveFurnitureDoubleClick,
} from './groups'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1',
  name: 'Sofa',
  shape: 'rect',
  xCm: 100,
  yCm: 100,
  widthCm: 120,
  depthCm: 80,
  rotationDeg: 0,
  color: '#4b5563',
  ...p,
})

const makeBoard = (furniture: FurnitureItem[]): Artboard => ({
  ...createArtboard('Plan A'),
  id: 'ab1',
  precisionCm: 1,
  rooms: [],
  furniture,
})

const makeDoc = (furniture: FurnitureItem[]): ProjectDoc => ({
  ...createDefaultProject(),
  artboards: [makeBoard(furniture)],
})

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length

const hydrate = (furniture: FurnitureItem[]) => {
  s().hydrate(makeDoc(furniture.map((f) => ({ ...f }))))
}

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null })
})

describe('groupFurniture & ungroupFurniture actions', () => {
  it('assigns one new groupId, moves items contiguous at topmost position, keeps relative order, in one undo step', () => {
    hydrate([
      item({ id: 'a' }),
      item({ id: 'b', groupId: 'old-g' }),
      item({ id: 'c' }),
      item({ id: 'd' }),
      item({ id: 'e' }),
    ])
    const before = past()
    const ok = groupFurniture('ab1', ['b', 'd'])
    expect(ok).toBe(true)
    expect(past()).toBe(before + 1)

    const list = s().doc.artboards[0].furniture
    expect(list.map((f) => f.id)).toEqual(['a', 'c', 'b', 'd', 'e'])
    const gid = list[2].groupId
    expect(gid).toBeTruthy()
    expect(gid).not.toBe('old-g')
    expect(list[3].groupId).toBe(gid)
    expect(list[0].groupId).toBeUndefined()
    expect(ui().selection).toEqual({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['b', 'd'] })

    s().undo()
    const restored = s().doc.artboards[0].furniture
    expect(restored.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(restored[1].groupId).toBe('old-g')
    expect(restored[3].groupId).toBeUndefined()
  })

  it('cleans up 1-member orphan group when grouping steals one member of a 2-member group', () => {
    hydrate([
      item({ id: 'a', groupId: 'g1' }),
      item({ id: 'b', groupId: 'g1' }),
      item({ id: 'c' }),
    ])
    groupFurniture('ab1', ['b', 'c'])
    const list = s().doc.artboards[0].furniture
    expect(list.find((f) => f.id === 'a')?.groupId).toBeUndefined()
    expect(list.find((f) => f.id === 'b')?.groupId).toBe(list.find((f) => f.id === 'c')?.groupId)
  })

  it('ungroupFurniture removes groupId from every member of touched groups in one undo step and keeps furnitureMulti', () => {
    hydrate([
      item({ id: 'a', groupId: 'g1' }),
      item({ id: 'b', groupId: 'g1' }),
      item({ id: 'c', groupId: 'g2' }),
      item({ id: 'd', groupId: 'g2' }),
    ])
    const before = past()
    const ok = ungroupFurniture('ab1', ['a', 'c'])
    expect(ok).toBe(true)
    expect(past()).toBe(before + 1)

    const list = s().doc.artboards[0].furniture
    expect(list.every((f) => f.groupId === undefined)).toBe(true)
    expect(ui().selection).toEqual({
      kind: 'furnitureMulti',
      artboardId: 'ab1',
      furnitureIds: ['a', 'c', 'b', 'd'],
    })

    s().undo()
    expect(s().doc.artboards[0].furniture.map((f) => f.groupId)).toEqual(['g1', 'g1', 'g2', 'g2'])
  })

  it('deleteFurniture and deleteFurnitureGroup clean up 1-member groups', () => {
    hydrate([
      item({ id: 'a', groupId: 'g1' }),
      item({ id: 'b', groupId: 'g1' }),
      item({ id: 'c', groupId: 'g2' }),
      item({ id: 'd', groupId: 'g2' }),
    ])
    deleteFurniture('ab1', 'a')
    expect(s().doc.artboards[0].furniture.find((f) => f.id === 'b')?.groupId).toBeUndefined()

    deleteFurnitureGroup('ab1', ['c'])
    expect(s().doc.artboards[0].furniture.find((f) => f.id === 'd')?.groupId).toBeUndefined()
  })
})

describe('pure group selection helpers', () => {
  const ab = makeBoard([
    item({ id: 'g1a', groupId: 'g1' }),
    item({ id: 'g1b', groupId: 'g1' }),
    item({ id: 'g2a', groupId: 'g2' }),
    item({ id: 'g2b', groupId: 'g2' }),
    item({ id: 'u1' }),
  ])

  it('expandToGroups expands any grouped id to all members without duplicates', () => {
    expect(expandToGroups(ab, ['g1a'])).toEqual(['g1a', 'g1b'])
    expect(expandToGroups(ab, ['u1', 'g2b', 'g2a'])).toEqual(['u1', 'g2b', 'g2a'])
  })

  it('setFurnitureSelection expands marquee/multi ids to whole groups', () => {
    hydrate(ab.furniture)
    setFurnitureSelection('ab1', ['g1a'])
    expect(ui().selection).toEqual({
      kind: 'furnitureMulti',
      artboardId: 'ab1',
      furnitureIds: ['g1a', 'g1b'],
    })
  })

  it('resolveFurnitureClick selects whole group, toggles whole group on Shift+click, and allows single-member clicks after double-click', () => {
    expect(resolveFurnitureClick(ab, { kind: 'none' }, 'g1a', { shiftKey: false })).toEqual(['g1a', 'g1b'])

    // Shift+click adds g2
    expect(
      resolveFurnitureClick(
        ab,
        { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['g1a', 'g1b'] },
        'g2a',
        { shiftKey: true },
      ),
    ).toEqual(['g1a', 'g1b', 'g2a', 'g2b'])

    // Shift+click removes g1
    expect(
      resolveFurnitureClick(
        ab,
        { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['g1a', 'g1b', 'g2a', 'g2b'] },
        'g1b',
        { shiftKey: true },
      ),
    ).toEqual(['g2a', 'g2b'])

    // Double-click enters g1
    expect(resolveFurnitureDoubleClick(ab, 'g1a')).toEqual(['g1a'])

    // While g1a is selected as single 'furniture', clicking g1b selects g1b only
    expect(
      resolveFurnitureClick(
        ab,
        { kind: 'furniture', artboardId: 'ab1', furnitureId: 'g1a' },
        'g1b',
        { shiftKey: false },
      ),
    ).toEqual(['g1b'])

    // Clicking a different group g2a selects all of g2
    expect(
      resolveFurnitureClick(
        ab,
        { kind: 'furniture', artboardId: 'ab1', furnitureId: 'g1a' },
        'g2a',
        { shiftKey: false },
      ),
    ).toEqual(['g2a', 'g2b'])
  })

  it('resolveEscapeGroupSelection returns whole group only for single grouped selection', () => {
    expect(resolveEscapeGroupSelection(ab, { kind: 'furniture', artboardId: 'ab1', furnitureId: 'g1a' })).toEqual([
      'g1a',
      'g1b',
    ])
    expect(resolveEscapeGroupSelection(ab, { kind: 'furniture', artboardId: 'ab1', furnitureId: 'u1' })).toBeNull()
    expect(
      resolveEscapeGroupSelection(ab, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['g1a', 'g1b'] }),
    ).toBeNull()
  })

  it('isSingleWholeGroup and hasAnyGroupedItem', () => {
    expect(isSingleWholeGroup(ab, ['g1a', 'g1b'])).toBe(true)
    expect(isSingleWholeGroup(ab, ['g1a', 'g1b', 'u1'])).toBe(false)
    expect(hasAnyGroupedItem(ab, ['u1', 'g1a'])).toBe(true)
    expect(hasAnyGroupedItem(ab, ['u1'])).toBe(false)
  })
})

describe('duplicate of a group', () => {
  it('duplicateFurnitureGroup assigns one new groupId per source group', () => {
    hydrate([
      item({ id: 'a', groupId: 'g1' }),
      item({ id: 'b', groupId: 'g1' }),
    ])
    const copyIds = duplicateFurnitureGroup('ab1', ['a', 'b'], 20)
    expect(copyIds).toHaveLength(2)
    const list = s().doc.artboards[0].furniture
    expect(list.map((f) => f.id)).toEqual(['a', copyIds[0], 'b', copyIds[1]])
    const copyGid = list[1].groupId
    expect(copyGid).toBeTruthy()
    expect(copyGid).not.toBe('g1')
    expect(list[3].groupId).toBe(copyGid)
  })

  it('single duplicateFurniture drops groupId', () => {
    hydrate([item({ id: 'a', groupId: 'g1' }), item({ id: 'b', groupId: 'g1' })])
    const copyId = duplicateFurniture('ab1', 'a', 20)
    expect(copyId).toBeTruthy()
    expect(s().doc.artboards[0].furniture.find((f) => f.id === copyId)?.groupId).toBeUndefined()
  })
})

describe('agent commands & validation', () => {
  it('group_furniture and ungroup_furniture commands', () => {
    const doc = makeDoc([item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })])
    const grouped = applyCommand(doc, { type: 'group_furniture', furnitureIds: ['a', 'c'] })
    expect(grouped.ok).toBe(true)
    if (!grouped.ok) return
    const list = grouped.doc.artboards[0].furniture
    expect(list.map((f) => f.id)).toEqual(['b', 'a', 'c'])
    expect(list[1].groupId).toBeTruthy()
    expect(list[1].groupId).toBe(list[2].groupId)

    const ungrouped = applyCommand(grouped.doc, { type: 'ungroup_furniture', furnitureIds: ['a'] })
    expect(ungrouped.ok).toBe(true)
    if (!ungrouped.ok) return
    expect(ungrouped.doc.artboards[0].furniture.every((f) => f.groupId === undefined)).toBe(true)
  })

  it('rejects invalid group_furniture / ungroup_furniture', () => {
    const doc = makeDoc([item({ id: 'a' })])
    expect(applyCommand(doc, { type: 'group_furniture', furnitureIds: ['a'] }).ok).toBe(false)
    expect(applyCommand(doc, { type: 'ungroup_furniture', furnitureIds: [] }).ok).toBe(false)
  })

  it('validation accepts optional groupId and rejects empty string', () => {
    const valid = makeDoc([item({ id: 'a', groupId: 'g1' }), item({ id: 'b', groupId: 'g1' })])
    expect(parseProjectDoc(valid).ok).toBe(true)
    expect(validateProject(valid).ok).toBe(true)

    const invalid = makeDoc([item({ id: 'a', groupId: '' })])
    expect(parseProjectDoc(invalid).ok).toBe(false)
  })
})
