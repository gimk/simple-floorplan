// Default vertical dimensions (cm) of the model, in one place.
// The 2D inspectors and the 3D view (docs/3d-and-finishes.md §1) both read them from here, so a
// default is never copied twice. Units: cm. y points down in 2D; heights go up from the floor.
import type { FurnitureItem, Opening, OpeningKind } from './types'

/** Default ceiling height of an artboard, in cm (also the Zod default of `ceilingHeightCm`). */
export const DEFAULT_CEILING_HEIGHT_CM = 250

/** Default vertical size of a furniture item when it sets no `heightCm`, in cm. */
export const DEFAULT_FURNITURE_HEIGHT_CM = 80

/** Default height of an opening by kind, in cm. */
export const DEFAULT_OPENING_HEIGHT_CM: Record<OpeningKind, number> = {
  door: 205,
  window: 120,
  opening: 210,
}

/** Default sill (distance from the floor to the bottom of the opening) by kind, in cm. */
export const DEFAULT_OPENING_SILL_CM: Record<OpeningKind, number> = {
  door: 0,
  window: 90,
  opening: 0,
}

/** `v` when it is a finite number, else `fallback`. */
const finiteOr = (v: number | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** A finite ceiling height, or undefined when the caller gave none (or a bad one). */
const ceilingOrUndefined = (ceilingHeightCm: number | undefined): number | undefined =>
  typeof ceilingHeightCm === 'number' && Number.isFinite(ceilingHeightCm) && ceilingHeightCm > 0
    ? ceilingHeightCm
    : undefined

/**
 * Bottom of an opening above the floor, in cm: its own `sillCm`, else the default of its kind.
 * Never negative, and never above the ceiling when a ceiling height is given.
 */
export function openingSillCm(o: Opening, ceilingHeightCm?: number): number {
  const sill = Math.max(0, finiteOr(o.sillCm, DEFAULT_OPENING_SILL_CM[o.kind]))
  const ceiling = ceilingOrUndefined(ceilingHeightCm)
  return ceiling === undefined ? sill : Math.min(sill, ceiling)
}

/**
 * Height of an opening, in cm: its own `heightCm`, else the default of its kind. Never negative.
 * With a ceiling height, the opening is clamped so that `sill + height <= ceilingHeightCm`.
 */
export function openingHeightCm(o: Opening, ceilingHeightCm?: number): number {
  const h = Math.max(0, finiteOr(o.heightCm, DEFAULT_OPENING_HEIGHT_CM[o.kind]))
  const ceiling = ceilingOrUndefined(ceilingHeightCm)
  if (ceiling === undefined) return h
  // The visible room above the sill: a sill at or above the ceiling leaves no height at all.
  return Math.max(0, Math.min(h, ceiling - openingSillCm(o, ceiling)))
}

/** Height of a furniture item above the floor, in cm: its own `heightCm`, else the default. */
export function furnitureHeightCm(f: FurnitureItem): number {
  return Math.max(0, finiteOr(f.heightCm, DEFAULT_FURNITURE_HEIGHT_CM))
}
