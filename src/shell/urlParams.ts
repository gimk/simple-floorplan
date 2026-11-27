// Browser control through URL parameters: ?project= ?mode= ?tool= ?artboard= ?nosw=1
import { useDoc } from '../model/store'
import { useUi, type Mode, type Tool } from './uiStore'

export type ParsedUrlParams = {
  project?: string
  mode?: Mode
  tool?: Tool
  artboard?: string
  nosw: boolean
}

const MODES: readonly Mode[] = ['plan', 'design']
const TOOLS: readonly Tool[] = ['select', 'rect', 'pen', 'cutout', 'artboard', 'tape']

const clean = (v: string | null): string | undefined => {
  const t = v?.trim()
  return t ? t : undefined
}

/** Parse a location.search string. Invalid values are ignored. Never throws. */
export function parseUrlParams(search: string): ParsedUrlParams {
  const q = new URLSearchParams(search)
  const out: ParsedUrlParams = { nosw: false }
  const project = clean(q.get('project'))
  if (project) out.project = project
  const mode = clean(q.get('mode'))
  if (mode && (MODES as readonly string[]).includes(mode)) out.mode = mode as Mode
  const tool = clean(q.get('tool'))
  if (tool && (TOOLS as readonly string[]).includes(tool)) out.tool = tool as Tool
  const artboard = clean(q.get('artboard'))
  if (artboard) out.artboard = artboard
  const nosw = q.get('nosw')?.trim().toLowerCase()
  out.nosw = nosw === '1' || nosw === 'true'
  return out
}

/** Apply mode, tool and artboard to the UI store. The artboard must exist in the current doc. */
export function applyInitialUiParams(params: ParsedUrlParams): void {
  const patch: { mode?: Mode; tool?: Tool; activeArtboardId?: string } = {}
  if (params.mode) patch.mode = params.mode
  if (params.tool) patch.tool = params.tool
  const id = params.artboard
  if (id && useDoc.getState().doc.artboards.some((a) => a.id === id)) patch.activeArtboardId = id
  if (Object.keys(patch).length > 0) useUi.getState().set(patch)
}

/** With ?nosw=1, unregister every service worker so a stale PWA cache cannot serve an old build. */
export async function unregisterServiceWorkersIfRequested(nosw: boolean): Promise<void> {
  if (!nosw || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
  } catch { /* ignore: best effort */ }
}
