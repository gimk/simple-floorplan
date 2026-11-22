// Tests for the pure part of the read-only share link (src/share/shareLink.ts).
import { describe, expect, it } from 'vitest'
import { generateTokenPlaintext } from '../core/access'
import {
  isShareTokenName,
  isoDay,
  problemForStatus,
  problemText,
  shareTokenName,
  shareTokensFor,
  shareUrl,
  todayIsoDay,
  tokenFromHash,
} from './shareLink'

const TOKEN = 'sfp_' + 'A'.repeat(43)

describe('tokenFromHash', () => {
  it('reads the token of a fragment, with or without the # sign', () => {
    expect(tokenFromHash(`#${TOKEN}`)).toBe(TOKEN)
    expect(tokenFromHash(TOKEN)).toBe(TOKEN)
    expect(tokenFromHash(`  #${TOKEN}  `)).toBe(TOKEN)
  })

  it('accepts a generated token (same format the API creates)', () => {
    const generated = generateTokenPlaintext()
    expect(tokenFromHash(`#${generated}`)).toBe(generated)
  })

  it('returns null when the fragment has no valid token', () => {
    expect(tokenFromHash('')).toBeNull()
    expect(tokenFromHash('#')).toBeNull()
    expect(tokenFromHash('#not-a-token')).toBeNull()
    expect(tokenFromHash(`#${TOKEN.slice(0, -1)}`)).toBeNull() // one char short
    expect(tokenFromHash(`#${TOKEN}x`)).toBeNull() // one char too long
    expect(tokenFromHash(`#${TOKEN.replace('sfp_', 'xyz_')}`)).toBeNull() // wrong prefix
    expect(tokenFromHash('#%E0%A4%A')).toBeNull() // malformed percent-encoding
  })

  it('rejects a token followed by extra characters (no partial match)', () => {
    expect(tokenFromHash(`#${TOKEN}&x=1`)).toBeNull()
  })
})

describe('shareUrl', () => {
  it('puts the token in the fragment, never in the path or a query string', () => {
    const url = shareUrl('https://floorplan.example', TOKEN)
    expect(url).toBe(`https://floorplan.example/share#${TOKEN}`)
    expect(url).not.toContain('?')
  })

  it('does not double the slash of an origin that ends with one', () => {
    expect(shareUrl('https://floorplan.example/', TOKEN)).toBe(`https://floorplan.example/share#${TOKEN}`)
    expect(shareUrl('http://localhost:5173', TOKEN)).toBe(`http://localhost:5173/share#${TOKEN}`)
  })

  it('round-trips through tokenFromHash', () => {
    const url = shareUrl('https://x.dev', TOKEN)
    expect(tokenFromHash(new URL(url).hash)).toBe(TOKEN)
  })
})

describe('shareTokenName', () => {
  it('is "share: <title> <date>"', () => {
    expect(shareTokenName('Apt 4B', '2026-02-01')).toBe('share: Apt 4B 2026-02-01')
  })

  it('trims the title and falls back to "Floor plan" when it is empty', () => {
    expect(shareTokenName('  Apt 4B  ', '2026-02-01')).toBe('share: Apt 4B 2026-02-01')
    expect(shareTokenName('   ', '2026-02-01')).toBe('share: Floor plan 2026-02-01')
  })

  it('is recognised by isShareTokenName, unlike other token names', () => {
    expect(isShareTokenName(shareTokenName('Apt 4B', '2026-02-01'))).toBe(true)
    expect(isShareTokenName('share: X')).toBe(true)
    expect(isShareTokenName('claude code')).toBe(false)
    expect(isShareTokenName('my share: token')).toBe(false)
    expect(isShareTokenName('')).toBe(false)
  })
})

describe('isoDay / todayIsoDay', () => {
  it('keeps the day of an ISO timestamp', () => {
    expect(isoDay('2026-02-01T09:12:33.000Z')).toBe('2026-02-01')
    expect(isoDay('2026-02-01')).toBe('2026-02-01')
  })

  it('is empty when there is no date', () => {
    expect(isoDay(null)).toBe('')
    expect(isoDay(undefined)).toBe('')
  })

  it('formats today as yyyy-mm-dd', () => {
    expect(todayIsoDay(new Date('2026-02-01T23:30:00.000Z'))).toBe('2026-02-01')
  })
})

describe('shareTokensFor', () => {
  const base = { projectId: 'p1', scopes: ['read'], createdAt: '2026-02-01T09:00:00.000Z', lastUsedAt: null, revoked: false }
  const tokens = [
    { ...base, id: 'a', name: 'share: Apt 4B 2026-02-01' },
    { ...base, id: 'b', name: 'share: Apt 4B 2026-01-01', revoked: true }, // revoked
    { ...base, id: 'c', name: 'claude code' }, // not a share link
    { ...base, id: 'd', name: 'share: Other flat', projectId: 'p2' }, // other project
    { ...base, id: 'e', name: 'share: all projects', projectId: null }, // not project-limited
  ]

  it('keeps the live share links of that project, in API order', () => {
    expect(shareTokensFor(tokens, 'p1').map((t) => t.id)).toEqual(['a'])
    expect(shareTokensFor(tokens, 'p2').map((t) => t.id)).toEqual(['d'])
    expect(shareTokensFor(tokens, 'p3')).toEqual([])
  })

  it('drops revoked links so the list matches what still works', () => {
    expect(shareTokensFor(tokens, 'p1').every((t) => !t.revoked)).toBe(true)
  })
})

describe('error screens', () => {
  it('maps the statuses the API returns', () => {
    expect(problemForStatus(401)).toBe('unauthorized')
    expect(problemForStatus(403)).toBe('forbidden')
    expect(problemForStatus(404)).toBe('not-found')
    expect(problemForStatus(500)).toBe('server')
    expect(problemForStatus(0)).toBe('server')
  })

  it('gives every problem a title and a hint', () => {
    const problems = ['no-token', 'unauthorized', 'forbidden', 'not-found', 'no-project', 'network', 'server'] as const
    for (const p of problems) {
      const text = problemText(p)
      expect(text.title.length).toBeGreaterThan(0)
      expect(text.hint.length).toBeGreaterThan(0)
    }
  })

  it('says the link was revoked for a 401, and never shows the token', () => {
    expect(problemText(problemForStatus(401)).title).toMatch(/no longer works/i)
    expect(JSON.stringify(problemText(problemForStatus(401)))).not.toContain('sfp_')
  })
})
