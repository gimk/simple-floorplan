// Load a reference image (PNG/JPG/WebP/SVG or PDF page 1) into a RefImage. Pure helpers are tested.
import type { RefImage } from '../../model/types'
import { newId } from '../../model/schema'
import { renderPdfPage } from './pdf'

/** Default displayed width of a new reference image. */
export const DEFAULT_WIDTH_CM = 1000

/** cm per px so an image of `naturalWidth` px shows `targetCm` wide. */
export const defaultCmPerPx = (naturalWidth: number, targetCm = DEFAULT_WIDTH_CM): number =>
  naturalWidth > 0 ? targetCm / naturalWidth : 1

/** Top-left (cm) that puts the image center on `center`. */
export const topLeftForCenter = (center: { x: number; y: number }, widthCm: number, heightCm: number) => ({
  xCm: center.x - widthCm / 2,
  yCm: center.y - heightCm / 2,
})

export const isPdfFile = (f: { name: string; type: string }): boolean =>
  f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

export const isImageFile = (f: { name: string; type: string }): boolean =>
  /^image\/(png|jpe?g|webp|svg\+xml)$/.test(f.type) || /\.(png|jpe?g|webp|svg)$/i.test(f.name)

/** File name without extension. */
export const baseName = (name: string): string => name.replace(/\.[^./\\]+$/, '') || name

const readDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(file)
  })

const measure = (src: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 1000, height: img.naturalHeight || 1000 })
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = src
  })

/**
 * Build a RefImage from a file. `center` is the world point (cm) for the image center
 * (default 0,0). Throws for unsupported types.
 */
export const loadRefImageFile = async (file: File, center: { x: number; y: number } = { x: 0, y: 0 }): Promise<RefImage> => {
  let src: string, width: number, height: number
  if (isPdfFile(file)) {
    const page = await renderPdfPage(file, 1)
    src = page.dataUrl; width = page.width; height = page.height
  } else if (isImageFile(file)) {
    src = await readDataUrl(file)
    const m = await measure(src)
    width = m.width; height = m.height
  } else {
    throw new Error('Unsupported file type. Use PNG, JPG, WebP, SVG or PDF.')
  }
  const cmPerPx = defaultCmPerPx(width)
  return {
    id: newId(),
    name: baseName(file.name),
    src,
    naturalWidth: width,
    naturalHeight: height,
    ...topLeftForCenter(center, width * cmPerPx, height * cmPerPx),
    cmPerPx,
    rotationDeg: 0,
    opacity: 0.5,
    visible: true,
    locked: false,
  }
}
