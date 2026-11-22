// Door-swing and clearance clash check (docs/plan.md 7.4): pure logic + canvas layer + panel.
export { ClashLayer, ClashShapes } from './ClashLayer'
export { ClearancePanel, ClashList } from './ClearancePanel'
export {
  CLASH_TOLERANCE_CM2, CUPBOARD_DEPTH_CM, RADIATOR_DEPTH_CM,
  clashFootprints, clashKey, clashText, elementClashLabel, elementFootprints, findClashes, fixtureDepth, overlapArea, swingSector,
} from './clash'
export type { Clash, ClashKind, Footprint, FootprintRole } from './clash'
