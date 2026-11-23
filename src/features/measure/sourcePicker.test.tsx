// Tests for the measurement source picker and the tag it leaves on a measured value
// (docs/walls-plan.md phase 3a).
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import { allSurveyIds } from '../../model/survey'
import type { PlanDoc } from '../../model/types'
import { demoRooms } from './demo'
import { MeasureMode } from './index'
import { RoomCard } from './RoomCard'
import { PICKER_SOURCES, SourcePicker } from './SourcePicker'
import { setMeasurement } from './actions'

const picker = (value: Parameters<typeof SourcePicker>[0]['value']) =>
  renderToString(<SourcePicker value={value} onChange={() => {}} />)

describe('SourcePicker', () => {
  it('shows Tape, Laser and Plan, in this order', () => {
    expect(PICKER_SOURCES).toEqual(['tape', 'laser', 'plan'])
    const html = picker('tape')
    const tape = html.indexOf('Tape')
    const laser = html.indexOf('Laser')
    const plan = html.indexOf('Plan')
    expect(tape).toBeGreaterThan(-1)
    expect(laser).toBeGreaterThan(tape)
    expect(plan).toBeGreaterThan(laser)
    // 'other' exists for API / MCP values only: the compact picker does not show it.
    expect(html).not.toContain('>Other<')
  })

  it('marks the current source as pressed', () => {
    expect(picker('tape')).toContain('aria-pressed="true" title="Tape · ±1 cm"')
    expect(picker('laser')).toContain('aria-pressed="true" title="Laser · ±0.3 cm"')
    expect(picker('plan')).toContain('aria-pressed="true" title="Plan · ±3 cm"')
    expect(picker('laser').match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('is an accessible group with the sources as choices', () => {
    const html = picker('tape')
    expect(html).toContain('aria-label="Measurement source"')
    expect(html.match(/aria-pressed="/g)).toHaveLength(3)
  })

  it('is in the header of Measuring Mode', () => {
    const html = renderToString(<MeasureMode />)
    expect(html).toContain('aria-label="Measurement source"')
  })
})

describe('measured value tags', () => {
  const docWith = (source?: 'tape' | 'laser' | 'plan' | 'other'): PlanDoc => ({
    ...emptyDoc(),
    rooms: demoRooms(),
    measurements: { 'SE-1': { label: 'SE-1', actualCm: 440, updatedAt: '', ...(source ? { source } : {}) } },
  })
  /** The card of the Séjour: SE-1 is one of its walls. */
  const card = (doc: PlanDoc) => {
    const room = doc.rooms.find((r) => r.code === 'SE')!
    return renderToString(<RoomCard doc={doc} room={room} allLabels={allSurveyIds(doc).map((s) => s.label)} />)
  }

  it('shows L for a laser value and P for a plan value, with a title', () => {
    const laser = card(docWith('laser'))
    expect(laser).toContain('title="Laser measurement"')
    expect(laser).toContain('>L</span>')
    const plan = card(docWith('plan'))
    expect(plan).toContain('title="Plan measurement"')
    expect(plan).toContain('>P</span>')
  })

  it('shows no tag for a tape value, an other value or a value without source', () => {
    for (const source of ['tape', 'other', undefined] as const) {
      const html = card(docWith(source))
      expect(html).toContain('verified')
      expect(html).not.toContain('title="Laser measurement"')
      expect(html).not.toContain('title="Plan measurement"')
      expect(html).not.toContain('>L</span>')
      expect(html).not.toContain('>P</span>')
    }
  })
})

describe('values typed in Measuring Mode carry the source', () => {
  beforeEach(() => {
    useDoc.setState({ doc: { ...emptyDoc(), rooms: demoRooms() } })
    useUi.setState({ measureSource: 'tape' })
  })

  it('saves the source of the value', () => {
    setMeasurement('SE-1', 440, 'laser')
    expect(useDoc.getState().doc.measurements['SE-1'].source).toBe('laser')
  })

  it('saves no source field when there is none (it then counts as tape)', () => {
    setMeasurement('SE-1', 440)
    expect(useDoc.getState().doc.measurements['SE-1'].source).toBeUndefined()
    expect(useDoc.getState().doc.measurements['SE-1'].actualCm).toBe(440)
  })

  it('removes the value and its source together', () => {
    setMeasurement('SE-1', 440, 'plan')
    setMeasurement('SE-1', null, 'plan')
    expect(useDoc.getState().doc.measurements['SE-1']).toBeUndefined()
  })
})
