import { fitSize } from './logic'

export const PHOTO_MAX = 1600
export const PHOTO_QUALITY = 0.8

/** Resize an image file to max 1600 px and re-encode as JPEG 0.8. Returns a data URL. */
export async function fileToPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const { w, h } = fitSize(bmp.width, bmp.height, PHOTO_MAX)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY)
}
