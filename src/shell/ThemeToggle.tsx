// Header toggle cycling Light -> Dark -> System (plan 7.2 #24).
import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { getThemePref, setThemePref, type ThemePref } from './theme'

const NEXT: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' }
const ICON = { light: Sun, dark: Moon, system: Monitor } as const
const LABEL: Record<ThemePref, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref())
  const Icon = ICON[pref]
  return (
    <button
      type="button"
      className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
      aria-label={`Theme: ${LABEL[pref]} (click to change)`}
      title={`Theme: ${LABEL[pref]}`}
      onClick={() => {
        const n = NEXT[pref]
        setPref(n)
        setThemePref(n)
      }}
    >
      <Icon size={16} />
      <span className="hidden lg:inline">{LABEL[pref]}</span>
    </button>
  )
}
