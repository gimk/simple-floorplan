// Pure helpers for the element inspector (ElementsPanel). No React here.
import { fmtCm } from '../../model/geometry'
import type { ElementKind } from '../../model/types'
import { KIND_LABEL } from './geometry'

/**
 * Heading of the element inspector: the kind, then the wall label and its length.
 * `elementPanelTitle('door', 'SE-2', 580)` -> "Door · wall SE-2 (580 cm)".
 * The length part is dropped when the wall is unknown.
 */
export function elementPanelTitle(kind: ElementKind, wallLabel: string, wallLengthCm?: number): string {
  const tail = wallLengthCm == null ? '' : ` (${fmtCm(wallLengthCm)} cm)`
  return `${KIND_LABEL[kind]} · wall ${wallLabel}${tail}`
}

/** The inspector shows a height field for every kind but "other". */
export const showsHeight = (kind: ElementKind): boolean => kind !== 'other'

/** Only radiators stand out of the wall, so only they have a depth. */
export const hasDepth = (kind: ElementKind): boolean => kind === 'radiator'

/** Depth used when the stored element has none: a radiator is 10 cm deep. */
export const depthDefault = (kind: ElementKind): number => (kind === 'radiator' ? 10 : 60)

/** Inline warning under the width field when offset + width is longer than the wall. */
export const overflowWarning = (wallLengthCm: number): string =>
  `Offset + width is longer than the wall (${fmtCm(wallLengthCm)} cm).`

/**
 * `name` (and `id`) of every element field. These are the names the panel used before
 * the migration to the shared primitives: other code and the browser tests rely on
 * them, so they must not change. The trailing dash comes from the old "(cm)" labels.
 */
export const ELEMENT_FIELD_NAMES = {
  kind: 'elementKind',
  variant: 'elementVariant',
  width: 'width-cm-',
  height: 'height-cm-',
  sill: 'sill-cm-',
  depth: 'depth-cm-',
  offsetStart: 'from-start-corner-cm-',
  offsetEnd: 'from-end-corner-cm-',
  hinge: 'elementHinge',
  swing: 'elementSwing',
  note: 'elementNote',
} as const
