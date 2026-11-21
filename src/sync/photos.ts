// Photo URLs for pins: a pin stores either a data URL (taken offline) or an R2 key.
import { useEffect, useState } from 'react'
import * as api from './api'
import { isInlinePhoto } from './projects'

const cache = new Map<string, Promise<string>>()

/** Object URL for an R2 key (fetched with the passcode header, cached in memory). */
export function loadPhotoUrl(key: string): Promise<string> {
  let p = cache.get(key)
  if (!p) {
    p = fetch(api.imageUrl(key), { headers: api.authHeaders() }).then(async (res) => {
      if (!res.ok) throw new Error('photo ' + res.status)
      return URL.createObjectURL(await res.blob())
    })
    p.catch(() => cache.delete(key)) // allow a retry later
    cache.set(key, p)
  }
  return p
}

/**
 * `usePhotoUrl(keyOrDataUrl)`: a data/blob URL is returned as is; an R2 key is fetched
 * and turned into an object URL. Returns null while loading or when it failed.
 */
export function usePhotoUrl(keyOrDataUrl: string | null | undefined): string | null {
  const inline = !!keyOrDataUrl && isInlinePhoto(keyOrDataUrl)
  const [fetched, setFetched] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!keyOrDataUrl || inline) return
    let alive = true
    loadPhotoUrl(keyOrDataUrl).then((url) => { if (alive) setFetched({ key: keyOrDataUrl, url }) }, () => {})
    return () => { alive = false }
  }, [keyOrDataUrl, inline])
  if (!keyOrDataUrl) return null
  if (inline) return keyOrDataUrl
  return fetched?.key === keyOrDataUrl ? fetched.url : null
}
