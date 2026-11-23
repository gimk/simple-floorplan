// The v1 -> v2 conversion report in words (docs/walls-plan.md 5c, step 4).
// One toast after the load, and a "Wall conversion" section in the Apartment card that the user
// can read once and hide (`conversion.seen = true`).
// The text helpers are pure (no store, no DOM), so the tests can check the words.
import { useEffect } from 'react'
import type { ConversionReport, ConversionReportEntry, PlanDoc } from '../../model/types'
import { fmtCm } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import { useSidebar } from '../../shell/sidebar/store'
import { toast } from '../toast'

/** Memory key of the collapsible section (also its aria-label, used to scroll to it). */
export const CONVERSION_SECTION_ID = 'apt-conversion'
export const CONVERSION_SECTION_TITLE = 'Wall conversion'

/** How many walls the conversion merged (a wall between two rooms counts once). */
export const mergedWallCount = (report: ConversionReport): number => report.counts?.sharedWalls ?? report.entries.length

/** Toast text: `Plan converted to walls: 16 shared walls, 2 adjusted.` */
export const conversionToastText = (report: ConversionReport): string => {
  const n = mergedWallCount(report)
  const adjusted = report.entries.length
  // Shared walls are now one wall each; "adjusted" = copies that did not agree (line or thickness).
  return `Plan converted to walls: ${n} shared wall${n === 1 ? '' : 's'}, ${adjusted} adjusted.`
}

/** The conversion report of a document, or null when there is nothing to show (no report, or seen). */
export const conversionToShow = (doc: PlanDoc): PlanDoc['conversion'] | null =>
  doc.conversion && doc.conversion.seen !== true ? doc.conversion : null

/** Toast text for a document, or null when there is nothing to show (no report, or seen). */
export function conversionNoticeText(conversion: PlanDoc['conversion']): string | null {
  if (!conversion || conversion.seen === true) return null
  return conversionToastText(conversion.report)
}

/** Distinct values, in order, without repetition. */
const unique = <T,>(list: T[]): T[] => list.filter((v, i) => list.indexOf(v) === i)

/** Thicknesses of the copies as "10 / 12 cm", then the kept one: "-> 12 cm". */
function thicknessText(entry: ConversionReportEntry): string {
  const list = unique(entry.thicknesses)
  const kept = entry.chosen.thicknessCm
  if (!list.length) return `thickness ${fmtCm(kept)} cm`
  if (list.length === 1) return `thickness ${fmtCm(list[0])} cm`
  return `thickness ${list.map((t) => fmtCm(t)).join(' / ')} cm -> ${fmtCm(kept)} cm`
}

/** Wall types of the copies, only when they differ: "type exterior / partition -> partition". */
function typeText(entry: ConversionReportEntry): string | null {
  const list = unique(entry.types)
  if (list.length < 2) return null
  return `type ${list.join(' / ')} -> ${entry.chosen.type}`
}

/**
 * One report line in words, e.g. \`EN | CO: lines 1,5 cm apart, thickness 10 / 12 cm -> 12 cm\`.
 * Only what changed is written: the lines, the thickness, the type.
 */
export function conversionEntryText(entry: ConversionReportEntry): string {
  const rooms = entry.rooms.length ? entry.rooms.join(' | ') : entry.wallId
  const parts: string[] = [
    entry.linesApartCm >= 0.05 ? `lines ${fmtCm(entry.linesApartCm)} cm apart` : 'lines in line',
    thicknessText(entry),
  ]
  const type = typeText(entry)
  if (type) parts.push(type)
  return `${rooms}: ${parts.join(', ')}`
}

/** Counts line, e.g. \`3 rooms, 8 walls, 4 shared walls. 2 room walls left as they are.\` */
export function conversionCountsText(report: ConversionReport): string {
  const { rooms, walls, sharedWalls, droppedRoomWalls } = report.counts
  const main = `${rooms} room${rooms === 1 ? '' : 's'}, ${walls} wall${walls === 1 ? '' : 's'}, ${sharedWalls} shared`
  const dropped =
    droppedRoomWalls > 0
      ? ` ${droppedRoomWalls} room wall${droppedRoomWalls === 1 ? '' : 's'} of zero length left as ${droppedRoomWalls === 1 ? 'it is' : 'they are'}.`
      : ''
  return `${main}.${dropped}`
}

/** Scroll the "Wall conversion" section into view (best effort: the sidebar may be closed). */
function scrollToSection(): void {
  if (typeof document === 'undefined') return
  try {
    document.querySelector(`section[aria-label="${CONVERSION_SECTION_TITLE}"]`)?.scrollIntoView({ block: 'start' })
  } catch {
    // no layout (tests, older browsers): the section is open, the user scrolls
  }
}

/**
 * "Details" of the toast: clear the selection so the Apartment card is shown, open the Inspect
 * tab and expand the report.
 */
export function openConversionSection(): void {
  useUi.getState().select(null)
  useSidebar.getState().setTab('inspect')
  useSidebar.getState().setSection(CONVERSION_SECTION_ID, true)
  // After the render that shows the card.
  setTimeout(scrollToSection, 0)
}

/** Mark the report as read (one undo step, so the user can get it back with Undo). */
export function hideConversionReport(): void {
  useDoc.getState().update((doc) =>
    doc.conversion ? { ...doc, conversion: { ...doc.conversion, seen: true } } : doc,
  )
}

/** Reports already toasted in this session, so a re-render never shows the toast again. */
const toastedAt = new Set<string>()

/**
 * Show the conversion toast once per project, after the load. Call it from a component that is
 * always mounted (the Apartment panel).
 */
export function useConversionNotice(): void {
  const at = useDoc((s) => s.doc.conversion?.at ?? null)
  const seen = useDoc((s) => s.doc.conversion?.seen === true)
  useEffect(() => {
    if (!at || seen || toastedAt.has(at)) return
    toastedAt.add(at)
    const text = conversionNoticeText(useDoc.getState().doc.conversion)
    if (!text) return
    toast(text, { actionLabel: 'Details', onAction: openConversionSection })
  }, [at, seen])
}
