// Pure parsing of spoken measurements for the voice-entry button. No DOM here, easy to test.
// Handles "342 virgule 5", "342 comma 5", "3 mètres 42", "trois cent quarante-deux", "three hundred forty two".

export type VoiceLang = 'fr' | 'en'

const FR_UNITS: Record<string, number> = {
  zéro: 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
}
const FR_TEENS: Record<string, number> = {
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
}
const FR_TENS: Record<string, number> = {
  trente: 30, quarante: 40, cinquante: 50, soixante: 60,
}

const EN_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
}
const EN_TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}
const EN_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

/** Words for a decimal separator: "342 virgule 5" / "342 comma 5" / "342 point 5". */
const DECIMAL_WORDS = /\s*(?:virgule|point|comma|dot|komma)\s*/g

/** "3 mètres 42" / "3 m 42" / "3 meters 42" = 342 cm. */
const METERS_RE = /^(\d{1,3})\s*(?:m|metre|mètre|metres|mètres|meter|meters|metres)\s*(\d{1,2})$/

/** "342 cm" / "342" with an optional unit word at the end. */
const PLAIN_RE = /^(\d+(?:[.,]\d+)?)\s*(?:cm|centimètre|centimetre|centimeters|centimeter)?$/

const norm = (text: string) =>
  text.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[’']/g, "'")

/** Sum French number words ("trois cent quarante-deux" = 342). Supports 0..999999. null when not all words are numbers. */
function frenchWords(t: string): number | null {
  const tokens = t.replace(/-/g, ' ').split(' ').filter((w) => w && w !== 'et')
  if (!tokens.length) return null
  let total = 0, cur = 0
  for (const w of tokens) {
    if ((w === 'vingt' || w === 'vingts') && cur === 4) cur = 80 // quatre-vingt(s) = 80, not 4 + 20
    else if (w in FR_UNITS) cur += FR_UNITS[w]
    else if (w in FR_TEENS) cur += FR_TEENS[w]
    else if (w === 'vingt' || w === 'vingts') cur += 20
    else if (w in FR_TENS) cur += FR_TENS[w]
    else if (w === 'cent') { total += (cur || 1) * 100; cur = 0 }
    else if (w === 'mille') { total += (cur || 1) * 1000; cur = 0 }
    else return null
  }
  return total + cur
}

/** Sum English number words ("three hundred forty two" = 342). null when not all words are numbers. */
function englishWords(t: string): number | null {
  const tokens = t.replace(/-/g, ' ').split(' ').filter((w) => w && w !== 'and')
  if (!tokens.length) return null
  let total = 0, cur = 0
  for (const w of tokens) {
    if (w in EN_UNITS) cur += EN_UNITS[w]
    else if (w in EN_TEENS) cur += EN_TEENS[w]
    else if (w in EN_TENS) cur += EN_TENS[w]
    else if (w === 'hundred') { total += (cur || 1) * 100; cur = 0 }
    else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0 }
    else return null
  }
  return total + cur
}

/**
 * Parse a spoken length into centimeters. Returns null when nothing numeric was understood.
 * Positive, finite, rounded to 0.1 cm.
 */
export function parseSpokenNumber(text: string, lang: VoiceLang = 'fr'): number | null {
  const t = norm(text)
  if (!t) return null

  // "342,5" / "342.5" / "342 cm"
  const plain = PLAIN_RE.exec(t)
  if (plain) return sane(Number(plain[1].replace(',', '.')))

  // "342 virgule 5" / "342 comma 5" / "342 point 5"
  const withSep = t.replace(DECIMAL_WORDS, '.').replace(/,/g, '.')
  if (/^\d+\.\d+$/.test(withSep)) return sane(Number(withSep))

  // "3 mètres 42" = 342
  const mtr = METERS_RE.exec(t)
  if (mtr) return sane(Number(mtr[1]) * 100 + Number(mtr[2]))

  // full number words
  const words = lang === 'fr' ? frenchWords(t) : englishWords(t)
  if (words != null) return sane(words)

  return null
}

const sane = (n: number): number | null => {
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 10) / 10
}
