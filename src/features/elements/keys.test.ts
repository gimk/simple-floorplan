import { describe, expect, it } from 'vitest'
import { placeKeyAction } from './keys'

describe('place-element keys', () => {
  it('maps F to flip and L to repeat, in both cases', () => {
    expect(placeKeyAction('f')).toBe('flip')
    expect(placeKeyAction('F')).toBe('flip')
    expect(placeKeyAction('l')).toBe('repeat')
    expect(placeKeyAction('L')).toBe('repeat')
  })

  it('ignores the other keys so the shell shortcuts keep them', () => {
    expect(placeKeyAction('v')).toBeNull()
    expect(placeKeyAction('Escape')).toBeNull()
    expect(placeKeyAction('Delete')).toBeNull()
    expect(placeKeyAction('')).toBeNull()
  })

  it('is ignored while the focus is in a text control', () => {
    expect(placeKeyAction('f', { typing: true })).toBeNull()
    expect(placeKeyAction('l', { typing: true })).toBeNull()
  })

  it('is ignored with a modifier key and on a held key', () => {
    expect(placeKeyAction('f', { mod: true })).toBeNull()
    expect(placeKeyAction('l', { mod: true })).toBeNull()
    expect(placeKeyAction('f', { repeat: true })).toBeNull()
  })
})
