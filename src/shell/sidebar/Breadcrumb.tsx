// Inspect breadcrumb: Apartment › Room (code) › Wall / Vertex / Element / Tape / Pin.
// Every part is a button that selects that level; Apartment clears every selection.
import { useDoc, useUi } from '../../model/store'
import { selectAnnot, useAnnotSel } from '../../features/annotations/selection'
import { selectRoom } from '../../features/rooms/interaction'
import { buildTrail, type Crumb, type CrumbSelect } from './trail'

const SEPARATOR = 'shrink-0 select-none px-0.5 text-slate-400 dark:text-slate-500'

/** Applies a crumb: the matching store selection (one place, so the levels stay in sync). */
function applyCrumb(select: CrumbSelect) {
  switch (select.kind) {
    case 'apartment':
      selectAnnot(null)
      useUi.getState().select(null)
      return
    case 'room':
      selectAnnot(null)
      selectRoom(select.roomId)
      return
    case 'wall':
      selectAnnot(null)
      useUi.getState().select({ kind: 'wall', roomId: select.roomId, wallStart: select.wallStart })
      return
    case 'storedWall':
      // A stored wall of a v2 document: one object with two sides.
      selectAnnot(null)
      useUi.getState().select({ kind: 'storedWall', wallId: select.wallId, side: select.side })
      return
    case 'vertex':
      selectAnnot(null)
      useUi.getState().select({ kind: 'vertex', roomId: select.roomId, vertexId: select.vertexId })
      return
    case 'element':
      selectAnnot(null)
      useUi.getState().select({ kind: 'element', elementId: select.elementId })
      return
    case 'trace':
      selectAnnot(null)
      useUi.getState().select({ kind: 'trace', id: select.id })
      return
    case 'tape':
    case 'pin':
      selectAnnot({ kind: select.kind, id: select.id })
  }
}

export function Breadcrumb() {
  const selection = useUi((s) => s.selection)
  const annotSel = useAnnotSel((s) => s.sel)
  const doc = useDoc((s) => s.doc)
  const crumbs = buildTrail(doc, selection, annotSel)

  return (
    <nav aria-label="Selection" className="flex min-h-9 flex-wrap items-center gap-0.5 text-sm">
      {crumbs.map((crumb: Crumb, index) => {
        const current = index === crumbs.length - 1
        return (
          <span key={crumb.level} className="flex min-w-0 items-center gap-0.5">
            {index > 0 && (
              <span className={SEPARATOR} aria-hidden="true">
                ›
              </span>
            )}
            <button
              type="button"
              onClick={() => applyCrumb(crumb.select)}
              aria-current={current ? 'page' : undefined}
              title={crumb.text}
              className={`inline-flex min-h-9 max-w-40 min-w-0 items-center truncate rounded px-1 text-sm hover:bg-black/5 hover:underline pointer-coarse:min-h-11 dark:hover:bg-white/10 ${
                current ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {crumb.text}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
