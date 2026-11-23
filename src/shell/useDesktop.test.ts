import { expect, it } from 'vitest'
import { DESKTOP_QUERY, isDesktopMatch } from './useDesktop'

it('reads a media query result, with a desktop default', () => {
  expect(DESKTOP_QUERY).toBe('(min-width: 768px)')
  expect(isDesktopMatch({ matches: true })).toBe(true)
  expect(isDesktopMatch({ matches: false })).toBe(false)
  expect(isDesktopMatch(null)).toBe(true)
  expect(isDesktopMatch(undefined)).toBe(true)
})
