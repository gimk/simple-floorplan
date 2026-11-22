// Tests for the read-only share link endpoint GET /api/share/whoami
// (route in functions/routes/access.ts, scope in src/core/access.ts).
import { describe, expect, it } from 'vitest'
import { requiredScopeForRoute } from '../../src/core/access'
import { shareWhoamiBody } from './access'

describe('shareWhoamiBody (pure part of GET /api/share/whoami)', () => {
  it('reports the project and scopes of a project-limited read token', () => {
    const body = shareWhoamiBody({
      actor: 'share: Apt 4B 2026-02-01',
      scopes: ['read'],
      projectId: 'proj_4b',
      viaToken: true,
    })
    expect(body).toEqual({
      projectId: 'proj_4b',
      scopes: ['read'],
      actor: 'share: Apt 4B 2026-02-01',
      viaToken: true,
      canRead: true,
    })
  })

  it('never returns the token itself (the body holds only scopes and the project id)', () => {
    const body = shareWhoamiBody({ actor: 'share', scopes: ['read'], projectId: 'p1', viaToken: true })
    expect(JSON.stringify(body)).not.toContain('sfp_')
    expect(Object.keys(body).sort()).toEqual(['actor', 'canRead', 'projectId', 'scopes', 'viaToken'])
  })

  it('copies the scope list, so a caller cannot mutate the auth info', () => {
    const scopes = ['read']
    const body = shareWhoamiBody({ actor: 'x', scopes, projectId: 'p1', viaToken: true })
    body.scopes.push('admin')
    expect(scopes).toEqual(['read'])
  })

  it('flags a token without read scope as not able to read', () => {
    expect(shareWhoamiBody({ actor: 'x', scopes: [], projectId: null, viaToken: true }).canRead).toBe(false)
  })

  it('treats a stronger scope (measure/edit/admin) as able to read', () => {
    for (const scope of ['measure', 'edit', 'admin']) {
      expect(shareWhoamiBody({ actor: 'x', scopes: [scope], projectId: null, viaToken: true }).canRead).toBe(true)
    }
  })

  it('answers an anonymous body when no auth info is on the context', () => {
    expect(shareWhoamiBody(undefined)).toEqual({
      projectId: null,
      scopes: [],
      actor: 'anonymous',
      viaToken: false,
      canRead: false,
    })
  })
})

describe('GET /api/share/whoami scope', () => {
  it('needs read, so a read-only share token may call it', () => {
    expect(requiredScopeForRoute('GET', '/api/share/whoami')).toBe('read')
  })

  it('rejects other methods on that path with the admin default', () => {
    expect(requiredScopeForRoute('POST', '/api/share/whoami')).toBe('admin')
  })

  it('does not match a longer path (no accidental exposure)', () => {
    expect(requiredScopeForRoute('GET', '/api/share/whoami/secret')).toBe('admin')
  })

  it('lets a read token download the DXF and .sfp exports the viewer offers', () => {
    expect(requiredScopeForRoute('GET', '/api/projects/p1/plan.dxf')).toBe('read')
    expect(requiredScopeForRoute('GET', '/api/projects/p1/plan.sfp')).toBe('read')
  })

  it('keeps other methods on the format exports at the admin default', () => {
    expect(requiredScopeForRoute('PUT', '/api/projects/p1/plan.sfp')).toBe('admin')
  })
})
