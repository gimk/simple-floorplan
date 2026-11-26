// Export a ProjectDoc as a .json download, and parse / validate an imported JSON file.
import { parseProjectDoc, type ParseResult } from '../model/schema'
import type { ProjectDoc } from '../model/types'

export const serializeProject = (doc: ProjectDoc): string => JSON.stringify(doc, null, 2)

/** Parse JSON text and validate it with Zod. Never throws. */
export function parseProjectJson(text: string): ParseResult {
  let data: unknown
  try { data = JSON.parse(text) } catch { return { ok: false, error: 'Not a valid JSON file' } }
  return parseProjectDoc(data)
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
