// CSV helpers (RFC 4180 style). Semicolon is NOT used: plain commas, quotes doubled.
export const csvEscape = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows: (string | number | null | undefined)[][]): string =>
  rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')

/** Trigger a browser download of a Blob via <a download>. */
export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'floorplan'
