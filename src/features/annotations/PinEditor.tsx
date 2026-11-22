import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Camera, Trash2, X } from 'lucide-react'
import { useDoc } from '../../model/store'
import { undoToast } from '../toast'
import { patchPin, removePin } from './actions'
import { fileToPhoto } from './photo'
import { usePhotoUrl } from '../../sync/photos'
import type { Pin } from '../../model/types'

/** One pin photo: data/blob URLs render directly, R2 keys are fetched via usePhotoUrl. */
function PhotoThumb({ src, alt }: { src: string; alt: string }) {
  const url = usePhotoUrl(src)
  if (!url) return <span className="flex size-full items-center justify-center p-1 text-center text-[11px] text-slate-500 dark:text-slate-400">Loading photo…</span>
  return <img src={url} alt={alt} className="size-full object-cover" />
}

/**
 * Photos of one pin: the grid with one delete button per photo, then the hidden file
 * input and the "Add photo" button. `trailing` is drawn at the end of that last row
 * (PinEditor puts its delete button there). Shared by PinEditor and the pin inspector.
 */
export function PinPhotos({ pin, compact = false, trailing }: { pin: Pin; compact?: boolean; trailing?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const btnH = compact ? 'h-9' : 'min-h-11'

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
    <>
      {pin.photoKeys.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {pin.photoKeys.map((src, i) => (
            <li key={i} className="relative aspect-square overflow-hidden rounded-lg border border-black/10 dark:border-white/15">
              <PhotoThumb src={src} alt={`Photo ${i + 1}`} />
              <button
                type="button" aria-label={`Delete photo ${i + 1}`}
                onClick={() => patchPin(pin.id, { photoKeys: pin.photoKeys.filter((_, j) => j !== i) })}
                className={`absolute right-0.5 top-0.5 flex items-center justify-center rounded-full bg-black/60 text-white ${compact ? 'size-8' : 'size-11'}`}
              ><X size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <input ref={input} name="pinPhotos" type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
        <button
          type="button" disabled={busy} onClick={() => input.current?.click()}
          className={`flex ${btnH} items-center gap-1.5 rounded-lg border border-orange-600 px-3 text-sm font-semibold text-orange-700 disabled:opacity-50 dark:border-orange-400 dark:text-orange-400`}
        ><Camera size={16} /> {busy ? 'Adding…' : 'Add photo'}</button>
        {trailing && (
          <>
            <span className="flex-1" />
            {trailing}
          </>
        )}
      </div>
    </>
  )
}

/** Text, photos and delete for one pin. Edits are silent; `silent` only controls whether delete is an undo step. */
export function PinEditor({ pin, silent = true, compact = false, onDeleted, label }: { pin: Pin; silent?: boolean; compact?: boolean; onDeleted?: () => void; label?: string }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const field = `w-full rounded-lg border border-black/15 bg-white px-3 py-2 dark:border-white/20 dark:bg-[#12161b] ${compact ? 'text-sm' : 'text-[15px]'}`
  const btnH = compact ? 'h-9' : 'min-h-11'

  const onDelete = () => {
    if (silent && !armed) {
      setArmed(true)
      timer.current = window.setTimeout(() => setArmed(false), 3000)
      return
    }
    window.clearTimeout(timer.current)
    removePin(pin.id, silent)
    if (!silent) undoToast('Pin deleted', () => useDoc.temporal.getState().undo())
    onDeleted?.()
  }

  return (
    <div className="flex flex-col gap-2.5" data-pin={pin.id}>
      {label && <b className="text-sm">{label}</b>}
      <textarea
        name="pinNote" aria-label="Pin note" rows={2} placeholder="Note (radiator pipes here, panel 140 cm from floor…)"
        value={pin.text ?? ''} onChange={(e) => patchPin(pin.id, { text: e.target.value || undefined })}
        className={`${field} min-h-16 resize-y`}
      />
      <PinPhotos
        pin={pin}
        compact={compact}
        trailing={
          <button
            type="button" onClick={onDelete}
            className={`flex ${btnH} items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${armed ? 'border-orange-700 bg-orange-700 text-white' : 'border-red-600/40 text-red-700 hover:bg-red-500/10 dark:border-red-400/40 dark:text-red-400'}`}
          ><Trash2 size={16} /> {armed ? 'Tap to confirm' : 'Delete pin'}</button>
        }
      />
    </div>
  )
}
