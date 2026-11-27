// Non-destructive in-memory downscaled display cache for large reference images.
// Never touches the document: results are blob URLs keyed by the original `src`.
export const MAX_DISPLAY_PX = 1600

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()
const failed = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

export const subscribeDisplayCache = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export const displayCacheVersion = () => version

export const getCachedDisplay = (src: string): string | undefined => cache.get(src)

export function needsDownscale(naturalWidth: number, naturalHeight: number): boolean {
  return Math.max(naturalWidth, naturalHeight) > MAX_DISPLAY_PX
}

/** Start (once) generating a downscaled blob URL for src. Resolves null on any failure. */
export function requestDisplay(src: string): Promise<string | null> {
  const hit = cache.get(src)
  if (hit) return Promise.resolve(hit)
  if (failed.has(src)) return Promise.resolve(null)
  const running = pending.get(src)
  if (running) return running
  const p = build(src)
    .then((url) => {
      if (url) { cache.set(src, url); version++; listeners.forEach((l) => l()) } else failed.add(src)
      return url
    })
    .catch(() => { failed.add(src); return null })
    .finally(() => { pending.delete(src) })
  pending.set(src, p)
  return p
}

async function build(src: string): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('load')) })
  const nw = img.naturalWidth, nh = img.naturalHeight
  if (!nw || !nh || !needsDownscale(nw, nh)) return null
  const k = MAX_DISPLAY_PX / Math.max(nw, nh)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(nw * k))
  canvas.height = Math.max(1, Math.round(nh * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  if (typeof canvas.toBlob !== 'function') return null
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.9))
  return blob ? URL.createObjectURL(blob) : null
}
