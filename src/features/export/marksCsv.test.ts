import { describe, expect, it } from 'vitest'
import { parsePlan } from '../../core/schema'
import { planToDsl } from '../../core/dsl'
import { MARK_HEAD, surveyCsv } from './surveyExport'

const docWithMarks = () =>
  parsePlan({
    projectId: 'p1',
    title: 'T',
    rooms: [{ id: 'r1', code: 'SE', name: 'Living', vertices: [{ id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 400, y: 0 }, { id: 'v2', x: 400, y: 300 }] }],
    pins: [
      {
        id: 'p1',
        roomId: 'r1',
        at: { x: 10, y: 10 },
        photoKeys: ['proj/a.jpg'],
        sketches: {
          'proj/a.jpg': [
            { id: 'mk1', a: { x: 0.1, y: 0.2 }, b: { x: 0.5, y: 0.2 }, valueCm: 250 },
            { id: 'mk2', a: { x: 0.1, y: 0.6 }, b: { x: 0.9, y: 0.6 }, label: 'SE-1', note: 'window' },
          ],
        },
        createdAt: 'c',
        updatedAt: 'u',
      },
    ],
  })

describe('survey CSV: photo marks', () => {
  it('lists every mark in a third table, with the value of its survey ID', () => {
    const csv = surveyCsv(docWithMarks())
    const lines = csv.split('\r\n')
    expect(lines).toContain(MARK_HEAD.join(','))
    expect(lines).toContain('1,SE,1,250,,')
    // SE-1 is the first wall (400 cm planned), so the value of that row is 400.
    expect(lines).toContain('1,SE,1,400,SE-1,window')
  })

  it('keeps the survey and items tables first', () => {
    const csv = surveyCsv(docWithMarks())
    expect(csv.indexOf('room code')).toBe(0)
    expect(csv.indexOf(MARK_HEAD.join(','))).toBeGreaterThan(csv.indexOf('wall label'))
  })

  it('adds no marks table when there is no mark', () => {
    const doc = parsePlan({ projectId: 'p1', title: 'T', rooms: [], pins: [] })
    expect(surveyCsv(doc)).not.toContain(MARK_HEAD.join(','))
  })

  it('round-trips the marks through the DSL of the same document', () => {
    const doc = docWithMarks()
    const back = planToDsl(doc)
    expect(back).toContain('sketch=')
    expect(surveyCsv(doc)).toContain('1,SE,1,250,,')
  })
})
