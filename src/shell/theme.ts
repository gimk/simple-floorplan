// Light / Dark / System theme. Stored in localStorage; the effective theme is set as
// data-theme on <html> and Tailwind's dark: variant follows it (see index.css).
export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'simple-floorplan:theme'

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* ignore */ }
  return 'system'
}

export function effectiveIsDark(pref: ThemePref): boolean {
  if (pref === 'dark') return true
  if (pref === 'light') return false
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = effectiveIsDark(pref) ? 'dark' : 'light'
}

export function setThemePref(pref: ThemePref): void {
  try { localStorage.setItem(KEY, pref) } catch { /* ignore */ }
  applyTheme(pref)
}

/** Call once at app startup (module scope of App) so the first paint already has the theme. */
export function initTheme(): void {
  if (typeof document === 'undefined') return
  applyTheme(getThemePref())
  if (typeof matchMedia !== 'undefined') {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', () => applyTheme(getThemePref()))
  }
}
