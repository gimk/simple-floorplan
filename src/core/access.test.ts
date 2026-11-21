import { describe, expect, it } from 'vitest'
import {
  commandScope,
  eventKindForRoute,
  generateTokenPlaintext,
  hasScope,
  hashToken,
  idempotencyCutoffIso,
  IDEMPOTENCY_TTL_MS,
  isValidTokenFormat,
  parseScopes,
  projectIdFromPath,
  requiredScopeForCommands,
  requiredScopeForRoute,
  scopeCovers,
  summarizeCommand,
} from './access'

describe('access: scopes', () => {
  it('parses comma-separated scopes and dedupes', () => {
    expect(parseScopes('read, measure ,read')).toEqual(['read', 'measure'])
    expect(parseScopes('admin')).toEqual(['admin'])
  })

  it('rejects empty or unknown scopes', () => {
    expect(() => parseScopes('')).toThrow()
    expect(() => parseScopes('read,bogus')).toThrow(/unknown scope/)
  })

  it('scopeCovers is cumulative: read < measure < edit < admin', () => {
    expect(scopeCovers('admin', 'read')).toBe(true)
    expect(scopeCovers('admin', 'admin')).toBe(true)
    expect(scopeCovers('edit', 'measure')).toBe(true)
    expect(scopeCovers('edit', 'admin')).toBe(false)
    expect(scopeCovers('measure', 'read')).toBe(true)
    expect(scopeCovers('read', 'measure')).toBe(false)
    expect(scopeCovers('read', 'read')).toBe(true)
    expect(scopeCovers('bogus', 'read')).toBe(false)
  })

  it('hasScope checks a list', () => {
    expect(hasScope(['read', 'measure'], 'measure')).toBe(true)
    expect(hasScope(['read'], 'edit')).toBe(false)
  })
})

describe('access: tokens', () => {
  it('generates sfp_ tokens with a 43-char base64url body', () => {
    const t = generateTokenPlaintext()
    expect(isValidTokenFormat(t)).toBe(true)
    expect(t.length).toBe(4 + 43)
    // deterministic RNG: all zero bytes -> known body
    const zero = generateTokenPlaintext(() => new Uint8Array(32))
    expect(zero).toBe('sfp_' + 'A'.repeat(43))
    expect(isValidTokenFormat(zero)).toBe(true)
  })

  it('rejects malformed tokens', () => {
    expect(isValidTokenFormat('')).toBe(false)
    expect(isValidTokenFormat('sfp_short')).toBe(false)
    expect(isValidTokenFormat('sfp_' + 'A'.repeat(44))).toBe(false)
    expect(isValidTokenFormat('xxx_' + 'A'.repeat(43))).toBe(false)
    expect(isValidTokenFormat('sfp_' + 'A'.repeat(42) + '!')).toBe(false)
  })

  it('hashToken is SHA-256 hex (known vector for "abc")', async () => {
    const h = await hashToken('abc')
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('access: requiredScopeForRoute', () => {
  it('public discovery routes need no scope', () => {
    expect(requiredScopeForRoute('GET', '/api/openapi.json')).toBeNull()
    expect(requiredScopeForRoute('GET', '/api/schema/plan.v1.json')).toBeNull()
    expect(requiredScopeForRoute('GET', '/openapi.json')).toBeNull()
  })

  it('read routes require read', () => {
    expect(requiredScopeForRoute('GET', '/api/projects')).toBe('read')
    expect(requiredScopeForRoute('GET', '/api/projects/p1')).toBe('read')
    expect(requiredScopeForRoute('POST', '/api/projects/p1/query')).toBe('read')
    expect(requiredScopeForRoute('GET', '/api/projects/p1/render.svg')).toBe('read')
    expect(requiredScopeForRoute('GET', '/api/projects/p1/changes')).toBe('read')
    expect(requiredScopeForRoute('GET', '/api/projects/p1/events')).toBe('read')
    expect(requiredScopeForRoute('GET', '/api/images/p1/x.png')).toBe('read')
  })

  it('measure routes require measure', () => {
    expect(requiredScopeForRoute('PUT', '/api/projects/p1/measurements/SE-2')).toBe('measure')
    expect(requiredScopeForRoute('DELETE', '/api/projects/p1/measurements/SE-2')).toBe('measure')
    expect(requiredScopeForRoute('PUT', '/api/projects/p1/items/el_1')).toBe('measure')
    expect(requiredScopeForRoute('DELETE', '/api/projects/p1/items/el_1')).toBe('measure')
    expect(requiredScopeForRoute('PUT', '/api/projects/p1/notes/SE')).toBe('measure')
  })

  it('edit and admin routes', () => {
    expect(requiredScopeForRoute('POST', '/api/projects')).toBe('edit')
    expect(requiredScopeForRoute('PUT', '/api/projects/p1/snapshot')).toBe('edit')
    expect(requiredScopeForRoute('PATCH', '/api/projects/p1')).toBe('edit')
    expect(requiredScopeForRoute('POST', '/api/projects/p1/images')).toBe('edit')
    expect(requiredScopeForRoute('POST', '/api/projects/p1/commands')).toBe('measure') // raised per command
    expect(requiredScopeForRoute('DELETE', '/api/projects/p1')).toBe('admin')
    expect(requiredScopeForRoute('POST', '/api/tokens')).toBe('admin')
    expect(requiredScopeForRoute('GET', '/api/tokens')).toBe('admin')
    expect(requiredScopeForRoute('DELETE', '/api/tokens/t1')).toBe('admin')
  })

  it('unknown routes require admin (safe default)', () => {
    expect(requiredScopeForRoute('GET', '/api/nope')).toBe('admin')
    expect(requiredScopeForRoute('POST', '/api/projects/p1/snapshot')).toBe('admin') // wrong method on known path
  })
})

describe('access: projectIdFromPath', () => {
  it('extracts the project id', () => {
    expect(projectIdFromPath('/api/projects/abc-123/commands')).toBe('abc-123')
    expect(projectIdFromPath('/api/projects/abc-123')).toBe('abc-123')
    expect(projectIdFromPath('/api/projects')).toBeNull()
    expect(projectIdFromPath('/api/tokens')).toBeNull()
  })
})

describe('access: command scopes', () => {
  it('measure-level commands require measure, others edit', () => {
    for (const t of ['set_measurement', 'clear_measurement', 'set_room_note', 'add_pin', 'add_tape']) {
      expect(commandScope(t)).toBe('measure')
    }
    expect(commandScope('add_room')).toBe('edit')
    expect(commandScope('delete_element')).toBe('edit')
  })

  it('a batch needs the max of its commands', () => {
    expect(requiredScopeForCommands(['set_measurement', 'add_pin'])).toBe('measure')
    expect(requiredScopeForCommands(['set_measurement', 'add_room'])).toBe('edit')
    expect(requiredScopeForCommands(['add_room', 'delete_room'])).toBe('edit')
  })
})

describe('access: event kinds and summaries', () => {
  it('maps write routes to event kinds', () => {
    expect(eventKindForRoute('PUT', '/api/projects/p1/snapshot')).toBe('snapshot')
    expect(eventKindForRoute('PUT', '/api/projects/p1/measurements/SE-1')).toBe('measurement')
    expect(eventKindForRoute('DELETE', '/api/projects/p1/items/x')).toBe('item')
    expect(eventKindForRoute('PUT', '/api/projects/p1/notes/SE')).toBe('note')
    expect(eventKindForRoute('POST', '/api/projects/p1/commands')).toBe('commands')
    expect(eventKindForRoute('POST', '/api/projects/p1/images')).toBe('image')
    expect(eventKindForRoute('PATCH', '/api/projects/p1')).toBe('rename')
    expect(eventKindForRoute('DELETE', '/api/projects/p1')).toBe('project_delete')
    expect(eventKindForRoute('POST', '/api/projects')).toBe('project_create')
    expect(eventKindForRoute('GET', '/api/projects/p1')).toBeNull()
  })

  it('summarizes commands', () => {
    expect(summarizeCommand({ type: 'set_measurement', label: 'CU-1', actualCm: 281.5 })).toBe(
      'set_measurement CU-1 = 281.5 cm',
    )
    expect(summarizeCommand({ type: 'add_room', code: 'CU', name: 'Kitchen' })).toBe('add_room CU (Kitchen)')
    expect(summarizeCommand({ type: 'place_element', wall: 'CU-2', kind: 'window' })).toBe('place_element CU-2 window')
    expect(summarizeCommand({ type: 'unknown_thing' })).toBe('unknown_thing')
  })
})

describe('access: idempotency TTL', () => {
  it('cutoff is 24 h before now', () => {
    const now = Date.parse('2026-11-22T12:00:00.000Z')
    expect(IDEMPOTENCY_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(idempotencyCutoffIso(now)).toBe('2026-11-21T12:00:00.000Z')
  })
})
