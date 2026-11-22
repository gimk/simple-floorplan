// Hands-free voice entry for Measuring Mode: speak a length, the FOCUSED survey input gets
// the value and focus moves to the next field. Hidden when the Web Speech API is missing.
import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { inputId } from './actions'
import { nextLabel } from './logic'
import { parseSpokenNumber } from './voice'

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((e: { results: { [i: number]: { [i: number]: { transcript: string } } } }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

const getCtor = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Write a value into a focused React <input> so its onChange fires (the store updates). */
function setInputValue(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (!setter) return
  setter.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Fill the currently focused survey input (or `fallbackId`) with `cm` and jump to the next survey field. */
export function applyVoiceToFocused(labels: string[], cm: number, fallbackId?: string | null) {
  const active = document.activeElement
  const el =
    active instanceof HTMLInputElement && active.id.startsWith('m-')
      ? active
      : fallbackId
        ? (document.getElementById(fallbackId) as HTMLInputElement | null)
        : null
  if (!(el instanceof HTMLInputElement) || !el.id.startsWith('m-')) return false
  const label = el.id.slice(2)
  setInputValue(el, String(cm).replace('.', ','))
  const nx = nextLabel(labels, label)
  if (nx) document.getElementById(inputId(nx))?.focus()
  return true
}

export function VoiceButton({ labels }: { labels: string[] }) {
  const [lang, setLang] = useState<'fr-FR' | 'en-US'>('fr-FR')
  const [listening, setListening] = useState(false)
  const [notice, setNotice] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const lastFocusedRef = useRef<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.id.startsWith('m-')) {
        lastFocusedRef.current = e.target.id
      }
    }
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      window.clearTimeout(noticeTimer.current)
      try { recRef.current?.stop() } catch { /* ignore */ }
    }
  }, [])

  const showNotice = (msg: string) => {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), 3000)
  }

  const Ctor = getCtor()
  if (!Ctor) return null // Web Speech API not available: hide the button

  const toggle = () => {
    if (listening) {
      try { recRef.current?.stop() } catch { /* ignore */ }
      setListening(false)
      return
    }
    const rec = new Ctor()
    recRef.current = rec
    rec.lang = lang
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? ''
      const n = parseSpokenNumber(transcript, lang.startsWith('fr') ? 'fr' : 'en')
      if (n != null) applyVoiceToFocused(labels, n, lastFocusedRef.current)
      else showNotice('Could not hear a number')
    }
    rec.onend = () => { recRef.current = null; setListening(false) }
    rec.onerror = () => { recRef.current = null; setListening(false); showNotice('Voice error') }
    try {
      rec.start()
      setListening(true)
    } catch {
      recRef.current = null
      setListening(false)
    }
  }

  return (
    <span className="relative flex items-center gap-1">
      <select
        name="voiceLang" aria-label="Voice language" value={lang} onChange={(e) => setLang(e.target.value as 'fr-FR' | 'en-US')}
        className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-[#12161b]"
      >
        <option value="fr-FR">FR</option>
        <option value="en-US">EN</option>
      </select>
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        aria-pressed={listening}
        aria-label={listening ? 'Listening… tap to stop' : 'Voice entry: speak a length'}
        title="Voice entry"
        className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border ${listening ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
      >
        {listening ? <MicOff size={17} /> : <Mic size={17} />}
      </button>
      {notice && (
        <span role="status" className="absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow dark:bg-slate-100 dark:text-slate-900">
          {notice}
        </span>
      )}
    </span>
  )
}
