// SSR smoke tests of the two opening panels (react-dom/server, no DOM needed):
//   - ObjectsPanel: the three architectural pickers, the placing hint, the reference image list
//     and the upload button.
//   - OpeningInspect: the door card (type, style, width, flip hinge, flip swing, delete), the window
//     card (style segmented control, no flip buttons) and the styles that hide one of the flips,
//     plus the null cases.
//
// react-dom/server asks zustand for the SERVER snapshot, which is the state frozen when the store
// was created: a document seeded inside a test would not be visible. The store module is therefore
// replaced by a fixed fake document:
//   artboard "ab1" (Plan A) -> o1 = standard door, 85 cm wide at (200, 0); o2 = standard window,
//   120 cm wide at (200, 300); o3 = french door; o4 = pocket door; o5 = sliding window;
//   o6 = plain opening; o7 = single casement window (hinge right, swing out);
//   o8 = double casement window (swing out).
//   Two reference images: img1 visible, img2 hidden.
// The interactive behaviour (arming the tool, editing, flipping, deleting) is not covered here.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProjectDoc } from '../../model/types'

const { AB, fakeDoc } = vi.hoisted(() => {
  const rect = (id: string) => ({
    id,
    name: id.toUpperCase(),
    vertices: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ],
  })
  const doc: ProjectDoc = {
    schemaVersion: 3,
    id: 'p1',
    title: 'Test project',
    refImages: [
      {
        id: 'img1',
        name: 'Ground floor scan',
        src: 'data:image/png;base64,AAAA',
        naturalWidth: 1000,
        naturalHeight: 800,
        xCm: -1200,
        yCm: 0,
        cmPerPx: 1,
        rotationDeg: 0,
        opacity: 0.6,
        visible: true,
        locked: false,
      },
      {
        id: 'img2',
        name: '',
        src: 'data:image/png;base64,BBBB',
        naturalWidth: 500,
        naturalHeight: 500,
        xCm: -2400,
        yCm: 0,
        cmPerPx: 1,
        rotationDeg: 0,
        opacity: 1,
        visible: false,
        locked: true,
      },
    ],
    artboards: [
      {
        id: 'ab1',
        name: 'Plan A',
        xCm: 0,
        yCm: 0,
        ceilingHeightCm: 250,
        precisionCm: 1,
        rooms: [rect('r1')],
        openings: [
          { id: 'o1', kind: 'door', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 85, hinge: 'left', swing: 'in' },
          { id: 'o2', kind: 'window', xCm: 200, yCm: 300, angleDeg: 0, widthCm: 120 },
          { id: 'o3', kind: 'door', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 140, hinge: 'left', swing: 'in', variant: 'french' },
          { id: 'o4', kind: 'door', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 85, hinge: 'left', swing: 'in', variant: 'pocket' },
          { id: 'o5', kind: 'window', xCm: 200, yCm: 300, angleDeg: 0, widthCm: 120, variant: 'sliding' },
          { id: 'o6', kind: 'opening', xCm: 100, yCm: 300, angleDeg: 0, widthCm: 100 },
          { id: 'o7', kind: 'window', xCm: 200, yCm: 300, angleDeg: 0, widthCm: 120, hinge: 'right', swing: 'out', variant: 'casement' },
          { id: 'o8', kind: 'window', xCm: 200, yCm: 300, angleDeg: 0, widthCm: 120, swing: 'out', variant: 'double-casement' },
        ],
        furniture: [],
      },
    ],
  }
  return { AB: 'ab1', fakeDoc: doc }
})

vi.mock('../../model/store', () => {
  const getState = () => ({ doc: fakeDoc, update: () => {}, undo: () => {}, redo: () => {} })
  const useDoc = Object.assign(
    (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()),
    { getState, getInitialState: getState, setState: () => {}, subscribe: () => () => {} },
  )
  const bounds = () => ({ minX: 0, minY: 0, maxX: 400, maxY: 300 })
  return { useDoc, artboardBounds: bounds, docBounds: bounds, ARTBOARD_GAP_CM: 150 }
})

// Imported after the mock so the fake store is the one the panels see.
import type { Opening } from '../../model/types'
import { ObjectsPanel, PLACE_HINT } from './ObjectsPanel'
import { OpeningInspect } from './OpeningInspect'
import { OpeningShape } from './OpeningsLayer'

describe('ObjectsPanel', () => {
  it('renders the three architectural pickers with their default widths', () => {
    const html = renderToStaticMarkup(<ObjectsPanel />)
    expect(html).toContain('aria-label="Architectural Objects"')
    expect(html).toContain('aria-label="Architectural objects"')
    expect(html).toContain('aria-label="Place door"')
    expect(html).toContain('aria-label="Place window"')
    expect(html).toContain('aria-label="Place opening"')
    expect(html).toContain('>Door<')
    expect(html).toContain('>Window<')
    expect(html).toContain('>Opening<')
    // default widths of a new door / window / opening
    expect(html).toContain('85 cm')
    expect(html).toContain('120 cm')
    expect(html).toContain('100 cm')
    // nothing is armed with the default tool = select
    expect(html).not.toContain('aria-pressed="true"')
    expect(html).not.toContain(PLACE_HINT)
  })

  it('lists the reference images and the upload button', () => {
    const html = renderToStaticMarkup(<ObjectsPanel onUploadImage={() => {}} />)
    expect(html).toContain('aria-label="Reference Images"')
    expect(html).toContain('aria-label="Select reference image Ground floor scan"')
    // a nameless image falls back to a placeholder, and a hidden one is marked
    expect(html).toContain('Untitled image')
    expect(html).toContain('hidden')
    expect(html).toContain('Upload image / PDF')
    // an upload handler is wired: the button is not disabled
    expect(html).not.toContain('disabled=""')
  })

  it('disables the upload button when the shell gives no handler', () => {
    const html = renderToStaticMarkup(<ObjectsPanel />)
    expect(html).toContain('disabled=""')
  })
})

describe('OpeningInspect', () => {
  it('renders the door card: type, width, flip hinge, flip swing, delete', () => {
    const html = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o1" />)
    expect(html).toContain('aria-label="Door"')
    expect(html).toContain('aria-label="Back to artboard"')
    expect(html).toContain('Plan A')
    expect(html).toContain('aria-label="Opening type"')
    // the door choice is the active one
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('value="85"')
    expect(html).toContain('cm')
    expect(html).toContain('Flip Hinge')
    expect(html).toContain('Flip Swing')
    expect(html).toContain('Delete Door')
  })

  it('renders the window card without the door flips', () => {
    const html = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o2" />)
    expect(html).toContain('aria-label="Window"')
    expect(html).toContain('value="120"')
    expect(html).not.toContain('Flip Hinge')
    expect(html).not.toContain('Flip Swing')
    expect(html).toContain('Delete Window')
  })

  it('offers the four door styles and starts on standard', () => {
    const html = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o1" />)
    expect(html).toContain('aria-label="Door style"')
    expect(html).toContain('>Standard<')
    expect(html).toContain('>French (double)<')
    expect(html).toContain('>Pocket sliding<')
    expect(html).toContain('>Bypass sliding<')
    // The standard choice is the one shown by a door without a variant.
    expect(html).toContain('<option value="standard" selected="">')
    // A plain opening has no style picker at all.
    const gap = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o6" />)
    expect(gap).toContain('Delete Opening')
    expect(gap).not.toContain('aria-label="Door style"')
    expect(gap).not.toContain('aria-label="Window style"')
    expect(gap).not.toContain('Flip Hinge')
  })

  it('keeps the hinge and the swing flips on a standard door', () => {
    const html = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o1" />)
    expect(html).toContain('Flip Hinge')
    expect(html).toContain('Flip Swing')
  })

  it('hides the hinge flip on a french door: the pair is symmetric', () => {
    const html = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o3" />)
    expect(html).toContain('<option value="french" selected="">')
    expect(html).not.toContain('Flip Hinge')
    expect(html).toContain('Flip Swing')
  })

  it('keeps the hinge flip but hides the swing flip on a pocket door', () => {
    const html = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o4" />)
    expect(html).toContain('<option value="pocket" selected="">')
    expect(html).toContain('Flip Hinge')
    expect(html).not.toContain('Flip Swing')
  })

  it('offers the four window styles in a select and starts on standard', () => {
    const standard = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o2" />)
    expect(standard).toContain('aria-label="Window style"')
    expect(standard).toContain('>Standard (fixed)<')
    expect(standard).toContain('>Sliding<')
    expect(standard).toContain('>Single casement<')
    expect(standard).toContain('>Double casement<')
    // A window without a variant shows the standard style, stored as no variant at all.
    expect(standard).toContain('<option value="standard" selected="">')

    const sliding = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o5" />)
    expect(sliding).toContain('<option value="sliding" selected="">')
    expect(sliding).not.toContain('aria-label="Door style"')

    const casement = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o7" />)
    expect(casement).toContain('<option value="casement" selected="">')

    const doubleCasement = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o8" />)
    expect(doubleCasement).toContain('<option value="double-casement" selected="">')
  })

  it('shows both flips on a single casement window, and only the swing flip on a double casement', () => {
    const casement = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o7" />)
    expect(casement).toContain('Flip Hinge')
    expect(casement).toContain('Flip Swing')
    expect(casement).toContain('Delete Window')

    const doubleCasement = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="o8" />)
    expect(doubleCasement).toContain('Flip Swing')
    expect(doubleCasement).not.toContain('Flip Hinge')

    // The fixed and sliding windows keep no flip at all.
    for (const id of ['o2', 'o5']) {
      const html = renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId={id} />)
      expect(html).not.toContain('Flip Hinge')
      expect(html).not.toContain('Flip Swing')
    }
  })

  it('renders nothing for an unknown opening or artboard', () => {
    expect(renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="missing" />)).toBe('')
    expect(renderToStaticMarkup(<OpeningInspect artboardId="missing" openingId="o1" />)).toBe('')
  })
})

// The canvas symbol of one opening (the viewport context defaults to px = cm, zoom 1, so the
// markup below is directly readable in cm).
const shape = (p: Partial<Opening>) =>
  renderToStaticMarkup(
    <svg>
      <OpeningShape op={{ id: 'o1', kind: 'door', xCm: 100, yCm: 50, angleDeg: 0, widthCm: 80, hinge: 'left', swing: 'in', ...p }} />
    </svg>,
  )
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe('OpeningShape (canvas)', () => {
  it('draws a standard door as one leaf and one quarter-circle arc', () => {
    const html = shape({})
    // One leaf and one arc, so two path commands.
    expect(countOf(html, 'M ')).toBe(2)
    expect(html).toContain('A 80 80 0 0 1 60 130')
    expect(html).toContain('d="M 60 50 L 60 130"')
    expect(html).not.toContain('Z"')
  })

  it('draws a french door as two half-width leaves with their own arc, meeting in the middle', () => {
    const html = shape({ variant: 'french', widthCm: 80 })
    // Two leaves and two arcs.
    expect(countOf(html, 'M ')).toBe(4)
    expect(countOf(html, 'A 40 40')).toBe(2)
    expect(html).toContain('d="M 60 50 L 60 90"')
    expect(html).toContain('d="M 140 50 L 140 90"')
    expect(html).toContain('A 40 40 0 0 1 60 90')
    expect(html).toContain('A 40 40 0 0 0 140 90')
  })

  it('draws a pocket door with a panel, a dashed pocket box and a slide line', () => {
    const html = shape({ variant: 'pocket' })
    expect(html).toContain('stroke-dasharray="3 3"')
    expect(countOf(html, 'Z"')).toBe(2)
    expect(html).not.toContain('A 80 80')
  })

  it('draws a bypass door with two overlapping parallel panels', () => {
    const html = shape({ variant: 'bypass' })
    expect(countOf(html, 'Z"')).toBe(2)
    expect(html).not.toContain('stroke-dasharray="3 3"')
    expect(html).not.toContain('A 80 80')
  })

  it('draws a sliding window as two staggered sashes, in the window colour', () => {
    const html = shape({ kind: 'window', variant: 'sliding', hinge: undefined, swing: undefined })
    expect(countOf(html, 'Z"')).toBe(2)
    expect(html).toContain('stroke="#7dd3fc"')
    // The plain window keeps its triple-line frame.
    const standard = shape({ kind: 'window', hinge: undefined, swing: undefined })
    expect(countOf(standard, 'Z"')).toBe(0)
    expect(countOf(standard, 'stroke-width="1.5"')).toBe(1)
  })

  it('draws a single casement window as the frame plus one swinging leaf and one arc', () => {
    const html = shape({ kind: 'window', variant: 'casement', hinge: undefined, swing: undefined })
    // Three frame lines, one sash leaf and one quarter-circle arc.
    expect(countOf(html, 'M ')).toBe(5)
    expect(countOf(html, 'A 80 80')).toBe(1)
    expect(html).toContain('d="M 60 50 L 140 50"')
    expect(html).toContain('d="M 60 50 L 60 130"')
    expect(html).toContain('A 80 80 0 0 1 60 130')
    expect(html).not.toContain('Z"')
  })

  it('draws a double casement window as the frame plus two half-width leaves and two arcs', () => {
    const html = shape({ kind: 'window', variant: 'double-casement', hinge: undefined, swing: undefined })
    // Three frame lines, two sash leaves and two arcs.
    expect(countOf(html, 'M ')).toBe(7)
    expect(countOf(html, 'A 40 40')).toBe(2)
    expect(html).toContain('d="M 60 50 L 140 50"')
    expect(html).toContain('d="M 60 50 L 60 90"')
    expect(html).toContain('d="M 140 50 L 140 90"')
    expect(html).toContain('A 40 40 0 0 1 60 90')
    expect(html).toContain('A 40 40 0 0 0 140 90')
    expect(html).not.toContain('Z"')
  })

  it('keeps a plain opening a bare gap with its jamb ticks', () => {
    const html = shape({ kind: 'opening', hinge: undefined, swing: undefined })
    expect(html).not.toContain('Z"')
    expect(html).not.toContain('A 80 80')
    // background gap plus the two ticks
    expect(countOf(html, '<line')).toBe(3)
  })
})
