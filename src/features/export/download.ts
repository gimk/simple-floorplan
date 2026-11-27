// Browser download of one artboard: SVG file straight from the renderer, PNG through a canvas.
// React-free; the DOM work is kept here so the renderer stays pure and testable in Node.
import type { Artboard } from '../../model/types'
import { renderArtboardSvg, slugFilename } from './artboardSvg'
import type { ExportOptions } from './artboardSvg'

/** Page background of the exported picture (kept in step with the renderer). */
const BG = '#12161b'

/** PNG scale factor: 2x the SVG pixel size, so the picture stays sharp on paper and on screen. */
const PNG_SCALE = 2

const svgBlob = (svg: string): Blob => new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })

/** Click a temporary <a download> link, then drop the object URL. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Revoking at once is safe: the download starts from the click, and the browser keeps the data.
    URL.revokeObjectURL(url)
  }
}

/** Download the artboard as a standalone SVG file named after it. */
export function downloadArtboardSvg(artboard: Artboard, opts?: ExportOptions): void {
  const { svg } = renderArtboardSvg(artboard, opts)
  saveBlob(svgBlob(svg), slugFilename(artboard.name || opts?.projectTitle || '', 'svg'))
}

/**
 * Rasterize the artboard to a PNG blob: the SVG is drawn on a 2x canvas filled with the page
 * background, then written with `canvas.toBlob`. Used by the PNG download and the PNG copy.
 */
export async function renderArtboardPngBlob(artboard: Artboard, opts?: ExportOptions): Promise<Blob> {
  const { svg, widthPx, heightPx } = renderArtboardSvg(artboard, opts)
  const url = URL.createObjectURL(svgBlob(svg))
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('The SVG picture could not be loaded'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(widthPx * PNG_SCALE))
    canvas.height = Math.max(1, Math.round(heightPx * PNG_SCALE))
    const g = canvas.getContext('2d')
    if (!g) throw new Error('The 2D canvas context is not available')
    g.fillStyle = BG
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('The PNG could not be built')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Download the artboard as a PNG named after it. Resolves when the download has started. */
export async function downloadArtboardPng(artboard: Artboard, opts?: ExportOptions): Promise<void> {
  const blob = await renderArtboardPngBlob(artboard, opts)
  saveBlob(blob, slugFilename(artboard.name || opts?.projectTitle || '', 'png'))
}

/**
 * Copy the artboard to the clipboard as a PNG picture. The ClipboardItem gets the rasterization
 * promise itself, so the clipboard write stays inside the user gesture while the canvas works.
 */
export async function copyArtboardPng(artboard: Artboard, opts?: ExportOptions): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (typeof ClipboardItem === 'undefined' || !clipboard?.write) {
    throw new Error('Image clipboard is not supported in this browser')
  }
  await clipboard.write([new ClipboardItem({ 'image/png': renderArtboardPngBlob(artboard, opts) })])
}

/**
 * True for Option+Cmd+C (Mac) and Ctrl+Alt+C (other platforms): copy the artboard as a PNG.
 * On macOS Option+C sets `e.key` to 'ç', so the `e.code === 'KeyC'` check is required there.
 */
export function isCopyPngShortcut(e: {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    e.altKey &&
    !e.shiftKey &&
    (e.key.toLowerCase() === 'c' || e.code === 'KeyC')
  )
}
