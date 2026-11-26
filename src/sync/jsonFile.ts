// Export a ProjectDoc as a .json download, and parse / validate an imported JSON file.
import { parseProjectDoc, type ParseResult } from '../model/schema'
import type { ProjectDoc } from '../model/types'
import { convertV1ToV2, isV1Export } from './convertV1'

export const serializeProject = (doc: ProjectDoc): string => JSON.stringify(doc, null, 2)

/** Parse JSON text and validate it with Zod. Never throws. */
export function parseProjectJson(text: string): ParseResult {
  let data: unknown
  try { data = JSON.parse(text) } catch { return { ok: false, error: 'Not a valid JSON file' } }
  const r = parseProjectDoc(data)
  if (r.ok || !isV1Export(data)) return r
  try { return { ok: true, doc: convertV1ToV2(data) } } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not convert v1 file' }
  }
}

export const projectFileName = (doc: ProjectDoc): string =>
  `${doc.title.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'floorplan'}.json`

/** Trigger a browser download of the project as JSON. */
export function exportProjectJson(doc: ProjectDoc): void {
  const url = URL.createObjectURL(new Blob([serializeProject(doc)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = projectFileName(doc)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Read and validate a user-picked JSON file. */
export async function importProjectJson(file: File): Promise<ParseResult> {
  return parseProjectJson(await file.text())
}
