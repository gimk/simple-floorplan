// SSR smoke tests of the two opening panels (react-dom/server, no DOM needed):
//   - ObjectsPanel: the three architectural pickers, the placing hint, the reference image list
//     and the upload button.
//   - OpeningInspect: the door card (type, width, flip hinge, flip swing, delete) and the window
//     card (no flip buttons), plus the null cases.
//
// react-dom/server asks zustand for the SERVER snapshot, which is the state frozen when the store
// was created: a document seeded inside a test would not be visible. The store module is therefore
// replaced by a fixed fake document:
//   artboard "ab1" (Plan A) -> o1 = door, 85 cm wide at (200, 0); o2 = window, 120 cm wide at
//   (200, 300). Two reference images: img1 visible, img2 hidden.
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
        rooms: [rect('r1')],
        openings: [
          { id: 'o1', kind: 'door', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 85, hinge: 'left', swing: 'in' },
          { id: 'o2', kind: 'window', xCm: 200, yCm: 300, angleDeg: 0, widthCm: 120 },
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
import { ObjectsPanel, PLACE_HINT } from './ObjectsPanel'
import { OpeningInspect } from './OpeningInspect'

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

  it('renders nothing for an unknown opening or artboard', () => {
    expect(renderToStaticMarkup(<OpeningInspect artboardId={AB} openingId="missing" />)).toBe('')
    expect(renderToStaticMarkup(<OpeningInspect artboardId="missing" openingId="o1" />)).toBe('')
  })
})
