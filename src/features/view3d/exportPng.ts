// Save or copy a PNG of the 3D view. No Three.js here: the blob comes from View3D's capturePngBlob.
import { slugFilename } from '../export/artboardSvg'
import { saveBlob } from '../export/download'
import { toast } from '../toast'

/** Download the blob as <slug of name>.png and confirm with a toast. */
export function downloadView3DPng(blob: Blob, name: string): void {
  try {
    saveBlob(blob, slugFilename(name, 'png'))
    toast('PNG downloaded', { kind: 'success' })
  } catch (err) {
    toast(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' })
  }
}

/** Copy the blob to the clipboard as a PNG picture. Shows an error toast when the browser cannot. */
export async function copyView3DPng(blob: Blob): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (typeof ClipboardItem === 'undefined' || !clipboard?.write) {
    toast('Copying images is not supported in this browser', { kind: 'error' })
    return
  }
  try {
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast('PNG copied', { kind: 'success' })
  } catch (err) {
    toast(`Copy failed: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' })
  }
}
