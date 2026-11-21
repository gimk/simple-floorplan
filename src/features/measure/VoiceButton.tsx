// Hands-free voice entry for Measuring Mode: speak a length, the FOCUSED survey input gets
// the value and focus moves to the next field. Hidden when the Web Speech API is missing.
import { useState } from 'react'
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

/** Fill the currently focused survey input with `cm` and jump to the next survey field. */
export function applyVoiceToFocused(labels: string[], cm: number) {
  const el = document.activeElement
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
  const Ctor = getCtor()
  if (!Ctor) return null // Web Speech API not available: hide the button

  const start = () => {
    const rec = new Ctor()
    rec.lang = lang
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? ''
      const n = parseSpokenNumber(transcript, lang.startsWith('fr') ? 'fr' : 'en')
      if (n != null) applyVoiceToFocused(labels, n)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    try {
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  return (
    <span className="flex items-center gap-1">
      <select
        aria-label="Voice language" value={lang} onChange={(e) => setLang(e.target.value as 'fr-FR' | 'en-US')}
        className="h-9 rounded-lg border border-slate-300 bg-white px-1 text-xs dark:border-slate-600 dark:bg-[#12161b]"
      >
        <option value="fr-FR">fr-FR</option>
        <option value="en-US">en-US</option>
      </select>
      <button
        type="button" onClick={start} aria-pressed={listening} aria-label={listening ? 'Listening… tap to stop' : 'Voice entry: speak a length'}
        title="Voice entry"
        className={`flex h-9 min-w-9 items-center justify-center rounded-lg border ${listening ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
      >
        {listening ? <MicOff size={17} /> : <Mic size={17} />}
      </button>
    </span>
  )
}
