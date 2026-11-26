// Selection helpers of the Artboards feature. Kept out of the component files so that
// fast refresh still works there (a module should export only components).
import { useUi } from '../../shell/uiStore'

/** Select an artboard: it becomes the active artboard and the Inspect panel follows it. */
export function selectArtboard(artboardId: string, kind: 'artboard' | 'none' = 'artboard'): void {
  useUi.getState().set({
    activeArtboardId: artboardId,
    selection: kind === 'artboard' ? { kind: 'artboard', artboardId } : { kind: 'none' },
  })
}

/** Select one room of an artboard (also makes that artboard active). */
export function selectRoom(artboardId: string, roomId: string): void {
  useUi.getState().set({
    activeArtboardId: artboardId,
    selection: { kind: 'room', artboardId, roomIds: [roomId] },
  })
}
