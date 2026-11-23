// The top-left corner of the rooms is always (0, 0) (model/origin.ts). After a finished local
// edit that moves it, the whole plan shifts back, and the view shifts by the same amount, so
// nothing moves on screen. Drags settle once, at the end.
//
// Undo / redo can bring back a doc from before a shift. Each doc version is tagged with the
// total shift applied so far (its frame); going back to a version moves the view by the
// difference, so the plan stays still on screen there too.
import { normalizeOrigin } from '../../model/origin'
import { addSettleRule, useDoc, useUi, type SettleRule } from '../../model/store'
import type { PlanDoc, Vec } from '../../model/types'

let frame: Vec = { x: 0, y: 0 }
const frameOf = new WeakMap<PlanDoc, Vec>()

const shiftView = (d: Vec) => {
  const ui = useUi.getState()
  const v = ui.view
  ui.set({ view: { ...v, x: v.x + d.x, y: v.y + d.y } })
}

const originRule: SettleRule = (doc) => {
  const { doc: next, offset } = normalizeOrigin(doc)
  if (next === doc) return doc
  frame = { x: frame.x + offset.x, y: frame.y + offset.y }
  shiftView(offset)
  return next
}

let installed = false
export function installOriginRule() {
  if (installed) return
  installed = true
  addSettleRule(originRule)
  frameOf.set(useDoc.getState().doc, frame)
  useDoc.subscribe((s, prev) => {
    if (s.doc === prev.doc) return
    const f = frameOf.get(s.doc)
    if (!f) { frameOf.set(s.doc, frame); return }
    // A known version came back (undo / redo): undo its frame difference on screen.
    const d = { x: f.x - frame.x, y: f.y - frame.y }
    frame = f
    if (d.x || d.y) shiftView(d)
  })
}
