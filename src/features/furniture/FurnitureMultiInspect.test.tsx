// SSR test of the multi-selection Inspect card (FurnitureMultiInspect): a selection of circles edits
// one Diameter plus Height, any other selection edits Width / Depth / Height, and a field whose values
// differ across the items is blank with a "Mixed" placeholder.
//
// No DOM library (jsdom, happy-dom, @testing-library) is installed in this repo, so the markup comes
// from react-dom/server and the store is a fake (same approach as FurnitureLayer.test.tsx): the card
// only reads `doc` here, the patch/write path is covered by multiSize.test.ts.
//
//   r1 Sofa rect 100 x 50, height 80; r2 Desk rect 140 x 70, height 120;
//   c1 Stool circle 80 x 80, no stored height (= the default 80).
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtboard, createDefaultProject } from '../../model/schema'
import type { Artboard, FurnitureItem, ProjectDoc } from '../../model/types'

const { docRef } = vi.hoisted(() => ({ docRef: { current: null as ProjectDoc | null } }))

vi.mock('../../model/store', () => {
  const useDoc = (pick: (s: { doc: ProjectDoc }) => unknown) => pick({ doc: docRef.current as ProjectDoc })
  useDoc.getState = () => ({
    doc: docRef.current,
    update: () => {},
    updateSilent: () => {},
    undo: () => {},
  })
  useDoc.temporal = { getState: () => ({ pastStates: [] }) }
  return { useDoc }
})

import { FurnitureMultiInspect } from './FurnitureMultiInspect'

const item = (p: Partial<FurnitureItem>): FurnitureItem => ({
  id: 'i1',
  name: 'Item',
  shape: 'rect',
  xCm: 100,
  yCm: 100,
  widthCm: 100,
  depthCm: 50,
  rotationDeg: 0,
  color: '#4b5563',
  ...p,
})

const sofa = (): FurnitureItem => item({ id: 'r1', name: 'Sofa', widthCm: 100, depthCm: 50, heightCm: 80 })
const desk = (): FurnitureItem => item({ id: 'r2', name: 'Desk', widthCm: 140, depthCm: 70, heightCm: 120 })
const stool = (p: Partial<FurnitureItem> = {}): FurnitureItem =>
  item({ id: 'c1', name: 'Stool', shape: 'circle', widthCm: 80, depthCm: 80, ...p })

const render = (furniture: FurnitureItem[], ids: string[]): string => {
  const board: Artboard = { ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, rooms: [], furniture }
  docRef.current = { ...createDefaultProject(), artboards: [board] }
  return renderToStaticMarkup(<FurnitureMultiInspect artboardId="ab1" furnitureIds={ids} />)
}

/**
 * The value and placeholder of the input whose aria-label starts with `label` (the card adds the
 * unit to it, so the label reads "Furniture width (cm)").
 */
const field = (html: string, label: string): { value: string; placeholder: string } => {
  const tag = html.match(new RegExp(`<input[^>]*aria-label="${label}[^"]*"[^>]*>`))?.[0] ?? ''
  return {
    value: tag.match(/value="([^"]*)"/)?.[1] ?? '',
    placeholder: tag.match(/placeholder="([^"]*)"/)?.[1] ?? '',
  }
}

describe('FurnitureMultiInspect size fields', () => {
  it('shows Width, Depth and Height for a selection with a rect in it', () => {
    const html = render([sofa(), stool()], ['r1', 'c1'])
    expect(html).toContain('2 items selected')
    expect(html).toContain('>Width<')
    expect(html).toContain('>Depth<')
    expect(html).toContain('>Height<')
    expect(html).not.toContain('>Diameter<')
  })

  it('shows one Diameter and Height when every item is a circle', () => {
    const html = render([stool(), stool({ id: 'c2', name: 'Stool 2' })], ['c1', 'c2'])
    expect(html).toContain('>Diameter<')
    expect(html).not.toContain('>Width<')
    expect(html).not.toContain('>Depth<')
    expect(field(html, 'Furniture diameter')).toEqual({ value: '80', placeholder: '' })
  })

  it('blanks a field whose values differ and shows the Mixed placeholder', () => {
    const html = render([sofa(), desk()], ['r1', 'r2'])
    expect(field(html, 'Furniture width')).toEqual({ value: '', placeholder: 'Mixed' })
    expect(field(html, 'Furniture depth')).toEqual({ value: '', placeholder: 'Mixed' })
    expect(field(html, 'Furniture height')).toEqual({ value: '', placeholder: 'Mixed' })
    expect(html).toContain('A blank field means the items have different values.')
  })

  it('shows the shared value when every item has the same size', () => {
    const same: FurnitureItem = item({ id: 'r1', widthCm: 120, depthCm: 60, heightCm: 90 })
    const html = render([same, { ...same, id: 'r2' }], ['r1', 'r2'])
    expect(field(html, 'Furniture width')).toEqual({ value: '120', placeholder: '' })
    expect(field(html, 'Furniture depth')).toEqual({ value: '60', placeholder: '' })
    // A height that is not mixed keeps the example placeholder of the single item card.
    expect(field(html, 'Furniture height')).toEqual({ value: '90', placeholder: 'e.g. 80' })
  })

  it('treats an omitted heightCm as the default height, not as a mixed value', () => {
    const html = render([stool(), stool({ id: 'c2', heightCm: 80 })], ['c1', 'c2'])
    expect(field(html, 'Furniture height')).toEqual({ value: '80', placeholder: 'e.g. 80' })
  })

  it('shows nothing when no selected id is on the artboard', () => {
    expect(render([sofa()], ['unknown'])).toBe('')
  })
})
