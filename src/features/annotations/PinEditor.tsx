import { useRef, useState } from 'react'
import { Camera, Trash2, X } from 'lucide-react'
import { patchPin, removePin } from './actions'
import { fileToPhoto } from './photo'
import { usePhotoUrl } from '../../sync/photos'
import type { Pin } from '../../model/types'

const field = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[15px] dark:border-white/20 dark:bg-[#12161b]'

/** One pin photo: data/blob URLs render directly, R2 keys are fetched via usePhotoUrl. */
function PhotoThumb({ src, alt }: { src: string; alt: string }) {
  const url = usePhotoUrl(src)
  if (!url) return <span className="flex size-full items-center justify-center p-1 text-center text-[11px] text-slate-500">Loading photo…</span>
  return <img src={url} alt={alt} className="size-full object-cover" />
}

/** Text, photos and delete for one pin. Edits are silent; `silent` only controls whether delete is an undo step. */
export function PinEditor({ pin, silent = true, onDeleted, label }: { pin: Pin; silent?: boolean; onDeleted?: () => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true); setError('')
    try {
      const urls: string[] = []
      for (const f of Array.from(files)) urls.push(await fileToPhoto(f))
      patchPin(pin.id, { photoKeys: [...pin.photoKeys, ...urls] })
    } catch {
      setError('Could not read this photo.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2.5" data-pin={pin.id}>
      {label && <b className="text-sm">{label}</b>}
      <textarea
        aria-label="Pin note" rows={2} placeholder="Note (radiator pipes here, panel 140 cm from floor…)"
        value={pin.text ?? ''} onChange={(e) => patchPin(pin.id, { text: e.target.value || undefined })}
        className={`${field} min-h-16 resize-y`}
      />
      {pin.photoKeys.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {pin.photoKeys.map((src, i) => (
            <li key={i} className="relative aspect-square overflow-hidden rounded-lg border border-black/10 dark:border-white/15">
              <PhotoThumb src={src} alt={`Photo ${i + 1}`} />
              <button
                type="button" aria-label={`Delete photo ${i + 1}`}
                onClick={() => patchPin(pin.id, { photoKeys: pin.photoKeys.filter((_, j) => j !== i) })}
                className="absolute right-0.5 top-0.5 flex size-9 items-center justify-center rounded-full bg-black/60 text-white"
              ><X size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
        <button
          type="button" disabled={busy} onClick={() => input.current?.click()}
          className="flex min-h-11 items-center gap-1.5 rounded-lg border border-orange-600 px-3 text-sm font-semibold text-orange-700 disabled:opacity-50 dark:border-orange-400 dark:text-orange-400"
        ><Camera size={16} /> {busy ? 'Adding…' : 'Add photo'}</button>
        <span className="flex-1" />
        <button
          type="button" onClick={() => { removePin(pin.id, silent); onDeleted?.() }}
          className="flex min-h-11 items-center gap-1.5 rounded-lg border border-black/15 px-3 text-sm font-semibold text-slate-600 dark:border-white/20 dark:text-slate-300"
        ><Trash2 size={16} /> Delete pin</button>
      </div>
    </div>
  )
}
