import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_NAMES, projectTitleUpdate } from './projectTitle'

describe('projectTitleUpdate (pure part of the snapshot-title sync)', () => {
  it('copies a new snapshot title into projects.title', () => {
    expect(projectTitleUpdate({ name: 'My flat', title: 'Old' }, 'New title')).toEqual({ name: 'My flat', title: 'New title' })
  })
  it('replaces a default name ("New apartment" / "New project") but keeps a custom one', () => {
    expect(projectTitleUpdate({ name: 'New apartment', title: 'New apartment' }, 'Demo apartment')).toEqual({
      name: 'Demo apartment',
      title: 'Demo apartment',
    })
    expect(projectTitleUpdate({ name: 'New project', title: null }, 'Demo apartment')?.name).toBe('Demo apartment')
    expect(projectTitleUpdate({ name: 'Chez Marie', title: null }, 'Chez Marie 2')?.name).toBe('Chez Marie')
  })
  it('trims the title and ignores empty / non-string / unchanged titles', () => {
    expect(projectTitleUpdate({ name: 'A', title: 'A' }, '  A  ')).toBeNull()
    expect(projectTitleUpdate({ name: 'A', title: 'A' }, '   ')).toBeNull()
    expect(projectTitleUpdate({ name: 'A', title: 'A' }, '')).toBeNull()
    expect(projectTitleUpdate({ name: 'A', title: 'A' }, 42)).toBeNull()
    expect(projectTitleUpdate({ name: 'A', title: null }, 'B')).toEqual({ name: 'A', title: 'B' })
  })
  it('returns null without a current row', () => {
    expect(projectTitleUpdate(null, 'X')).toBeNull()
    expect(projectTitleUpdate(undefined, 'X')).toBeNull()
  })
  it('exposes the default placeholder names', () => {
    expect(DEFAULT_PROJECT_NAMES.has('New apartment')).toBe(true)
    expect(DEFAULT_PROJECT_NAMES.has('New project')).toBe(true)
    expect(DEFAULT_PROJECT_NAMES.has('My flat')).toBe(false)
  })
})
