// The app is always dark: no theme toggle, the stored preference and the system setting are
// ignored. The theme is set as data-theme on <html>, and Tailwind's dark: variant follows it
// (see index.css).

/** Set data-theme='dark' on <html>. */
export function applyTheme(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = 'dark'
}

/** Call once at app startup (module scope of App and of ShareViewer) so the first paint is dark. */
export function initTheme(): void {
  applyTheme()
}
