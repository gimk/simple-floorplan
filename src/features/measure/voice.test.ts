import { describe, expect, it } from 'vitest'
import { parseSpokenNumber } from './voice'

describe('parseSpokenNumber: digits', () => {
  it('plain digits, dot, comma', () => {
    expect(parseSpokenNumber('342')).toBe(342)
    expect(parseSpokenNumber('342.5')).toBe(342.5)
    expect(parseSpokenNumber('342,5')).toBe(342.5)
    expect(parseSpokenNumber('342 cm')).toBe(342)
    expect(parseSpokenNumber(' 412,5 ')).toBe(412.5)
  })
  it('rejects junk, zero and negatives', () => {
    expect(parseSpokenNumber('abc')).toBeNull()
    expect(parseSpokenNumber('0')).toBeNull()
    expect(parseSpokenNumber('-5')).toBeNull()
    expect(parseSpokenNumber('')).toBeNull()
    expect(parseSpokenNumber('cm')).toBeNull()
  })
})

describe('parseSpokenNumber: decimal words', () => {
  it('french virgule / point', () => {
    expect(parseSpokenNumber('342 virgule 5', 'fr')).toBe(342.5)
    expect(parseSpokenNumber('342 point 5', 'fr')).toBe(342.5)
  })
  it('english comma / dot / point', () => {
    expect(parseSpokenNumber('342 comma 5', 'en')).toBe(342.5)
    expect(parseSpokenNumber('342 dot 5', 'en')).toBe(342.5)
    expect(parseSpokenNumber('342 point 5', 'en')).toBe(342.5)
  })
})

describe('parseSpokenNumber: meters', () => {
  it('"3 mètres 42" = 342', () => {
    expect(parseSpokenNumber('3 mètres 42', 'fr')).toBe(342)
    expect(parseSpokenNumber('3 m 42', 'fr')).toBe(342)
    expect(parseSpokenNumber('3 meters 42', 'en')).toBe(342)
    expect(parseSpokenNumber('12 mètres 5', 'fr')).toBe(1205)
  })
})

describe('parseSpokenNumber: french words', () => {
  it('units, teens, tens', () => {
    expect(parseSpokenNumber('trois cent quarante-deux', 'fr')).toBe(342)
    expect(parseSpokenNumber('quatre-vingts', 'fr')).toBe(80)
    expect(parseSpokenNumber('quatre-vingt-dix', 'fr')).toBe(90)
    expect(parseSpokenNumber('quatre-vingt-onze', 'fr')).toBe(91)
    expect(parseSpokenNumber('soixante-dix', 'fr')).toBe(70)
    expect(parseSpokenNumber('vingt et un', 'fr')).toBe(21)
    expect(parseSpokenNumber('cent', 'fr')).toBe(100)
    expect(parseSpokenNumber('deux cent cinquante', 'fr')).toBe(250)
    expect(parseSpokenNumber('mille', 'fr')).toBe(1000)
    expect(parseSpokenNumber('deux mille trois cent quarante-deux', 'fr')).toBe(2342)
    expect(parseSpokenNumber('quatre cent', 'fr')).toBe(400)
  })
  it('rejects non-numbers', () => {
    expect(parseSpokenNumber('bonjour', 'fr')).toBeNull()
    expect(parseSpokenNumber('trois pommes', 'fr')).toBeNull()
  })
})

describe('parseSpokenNumber: english words', () => {
  it('units, teens, tens, hundreds', () => {
    expect(parseSpokenNumber('three hundred forty two', 'en')).toBe(342)
    expect(parseSpokenNumber('three hundred and forty-two', 'en')).toBe(342)
    expect(parseSpokenNumber('ninety', 'en')).toBe(90)
    expect(parseSpokenNumber('one hundred twenty', 'en')).toBe(120)
    expect(parseSpokenNumber('two thousand five hundred', 'en')).toBe(2500)
    expect(parseSpokenNumber('eighty seven', 'en')).toBe(87)
  })
  it('rejects non-numbers', () => {
    expect(parseSpokenNumber('hello there', 'en')).toBeNull()
  })
})
