// The wall number badges against every text of the plan (round 2 finding R2-2): with the demo
// apartment, at 100 %, 80 % and 64 % zoom, no `data-wall-number` badge may touch a dimension text,
// neither a wall value nor an outside chain value. The boxes come from the drawing itself (the text
// and the badge positions of the markup), and the text box is grown by 2 px: the real glyph box of
// the browser is about that much bigger than the approximation of dimBoxes.ts (font and halo), so
// the plan keeps a margin with the clearance DIM_STYLE.badgeGap.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../../canvas/Viewport'
import { emptyDoc, useDoc, useUi, type Layers } from '../../../model/store'
import { surveyIds } from '../../../model/survey'
import type { PlanDoc } from '../../../model/types'
import { ensureV2 } from '../../../model/v2/ensure'
import { useSidebar } from '../../../shell/sidebar/store'
import { demoRooms } from '../../measure/demo'
import { RoomsLayer } from '../RoomsLayer'
import { RoomsOverlay } from '../RoomsOverlay'
import { OutsideDimsLayer } from '../outside/OutsideDimsLayer'
import { badgeSizePx, boxAt, boxHit, growBox, textBox, type Box } from './dimBoxes'

const BASE_LAYERS: Layers = {
  background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true, clashes: true,
  roomCodes: 'auto', wallLabels: 'auto', outsideDims: true,
}

const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

/** The demo apartment as a v2 document, with a measured value on every face (longest texts). */
const demo = (measured: boolean): PlanDoc => {
  const doc = ensureV2({ ...emptyDoc(), rooms: demoRooms() })
  if (!measured) return doc
  const m: PlanDoc['measurements'] = {}
  for (const r of doc.rooms) for (const s of surveyIds(r)) m[s.label] = { label: s.label, actualCm: 200, updatedAt: '' }
  return { ...doc, measurements: m }
}

/** The texts of the plan, as the drawing places them, with the box of the browser (grown by 2 px). */
const dimTexts = (html: string, zoom: number) =>
  [...html.matchAll(/<g pointer-events="none" data-dim="([^"]+)" data-dim-key="([^"]+)">((?:(?!data-dim-key)[\s\S])*?)<\/g>/g)]
    .flatMap((m) => {
      const t = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*?(?:transform="rotate\(([-\d.]+)[^"]*")?[^>]*>([^<]*)</.exec(m[3])
      return t
        ? [{
          kind: m[1], key: m[2], text: t[4],
          box: growBox(textBox({ x: Number(t[1]), y: Number(t[2]) }, Number(t[3] ?? 0), t[4], zoom), 2 / zoom),
        }]
        : []
    })

/** The badges of the plan: their number, their room wall and their box. */
const badges = (html: string, zoom: number) =>
  [...html.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\)" pointer-events="none" data-wall-number="([^"]+)"[^>]*data-wall-label="([^"]+)"/g)]
    .map((m) => ({
      label: m[4], n: m[3],
      box: growBox(boxAt({ x: Number(m[1]), y: Number(m[2]) }, badgeSizePx(m[3]).w / zoom, badgeSizePx(m[3]).h / zoom), 0.5 / zoom),
    }))

/** Draw the plan as the app does: rooms, their overlays, then the outside chains. */
const draw = (over: { zoom: number; layers?: Partial<Layers>; measured?: boolean; roomTag?: object }) => {
  applyState(useUi, {
    layers: { ...BASE_LAYERS, wallLabels: 'on', ...over.layers },
    mode: 'edit',
    tool: 'select',
    selection: null,
    multi: [],
    dimStyle: 'lines',
    hoverLabel: null,
    hoverDiagonal: null,
    view: { x: 0, y: 0, zoom: over.zoom },
    roomTag: { code: true, name: true, area: true, perimeter: false, ceiling: false, progress: false, areaDecimals: 2, ...over.roomTag },
  })
  applyState(useSidebar, { tab: 'solve' })
  applyState(useDoc, { doc: demo(!!over.measured) })
  return renderToString(<Viewport><RoomsLayer /><RoomsOverlay /><OutsideDimsLayer /></Viewport>)
}

beforeEach(() => {
  applyState(useUi, { layers: BASE_LAYERS, selection: null, multi: [], view: { x: 0, y: 0, zoom: 1 } })
  applyState(useDoc, { doc: emptyDoc() })
})

describe('wall number badges vs the texts of the plan (R2-2)', () => {
  for (const zoom of [1, 0.8, 0.64]) {
    it(`draws no badge on a dimension text at ${Math.round(zoom * 100)} % zoom`, () => {
      const html = draw({ zoom })
      const texts = dimTexts(html, zoom)
      const marks = badges(html, zoom)
      // The plan of the test really shows both kinds of text and many badges.
      expect(texts.filter((t) => t.kind === 'wall').length).toBeGreaterThan(30)
      expect(texts.filter((t) => t.kind === 'outside').length).toBeGreaterThan(10)
      expect(marks.length).toBeGreaterThan(30)
      const hits = marks.flatMap((b) => texts
        .filter((t) => boxHit(b.box, t.box))
        .map((t) => `${b.label} (${b.n}) on [${t.kind} ${t.key}] "${t.text}"`))
      expect(hits).toEqual([])
    })
  }

  it('also keeps every badge off the texts when every tag row is on and the walls are measured', () => {
    const zoom = 0.8
    const html = draw({ zoom, measured: true, roomTag: { perimeter: true, ceiling: true, progress: true } })
    const texts = dimTexts(html, zoom)
    const hits = badges(html, zoom).flatMap((b) => texts.filter((t) => boxHit(b.box, t.box)).map((t) => `${b.label} ${t.key}`))
    expect(hits).toEqual([])
  })

  it('does not waste a badge: most walls keep their number, thanks to the second place of the badge', () => {
    const html = draw({ zoom: 1 })
    // 57 walls show a badge at this zoom before round 2, and the same 57 after it: the mask costs
    // no number on this plan, because the second place of a badge is free where the first is taken.
    expect(badges(html, 1).length).toBeGreaterThan(50)
  })

  it('draws no badge on a text when the badges are laid on a plan without outside chains', () => {
    const zoom = 1
    const html = draw({ zoom, layers: { outsideDims: false } })
    expect(dimTexts(html, zoom).some((t) => t.kind === 'outside')).toBe(false)
    const hits = badges(html, zoom).flatMap((b) => dimTexts(html, zoom).filter((t) => boxHit(b.box, t.box)))
    expect(hits).toEqual([])
  })
})

/** The boxes type is used by the helpers above; keep it exported here for the reader. */
export type { Box }
