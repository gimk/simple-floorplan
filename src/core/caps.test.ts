import { describe, expect, it } from 'vitest'
import {
  bytesToMb,
  checkUpload,
  DEFAULT_MAX_R2_TOTAL_MB,
  DEFAULT_MAX_UPLOAD_MB,
  DEFAULT_MAX_UPLOADS_PER_DAY,
  MB,
  parseCaps,
  uploadWindowStartIso,
  type Caps,
} from './caps'

const caps: Caps = { maxUploadMb: 10, maxR2TotalMb: 5000, maxUploadsPerDay: 200 }
const usage = (over: Partial<{ sizeBytes: number; usedBytes: number; uploadsLast24h: number }> = {}) => ({
  sizeBytes: 1 * MB,
  usedBytes: 0,
  uploadsLast24h: 0,
  ...over,
})

describe('caps: parseCaps', () => {
  it('reads the strings from wrangler.toml [vars]', () => {
    expect(parseCaps({ MAX_UPLOAD_MB: '10', MAX_R2_TOTAL_MB: '5000', MAX_UPLOADS_PER_DAY: '200' })).toEqual(caps)
  })

  it('uses the defaults when the vars are missing', () => {
    expect(parseCaps(undefined)).toEqual({
      maxUploadMb: DEFAULT_MAX_UPLOAD_MB,
      maxR2TotalMb: DEFAULT_MAX_R2_TOTAL_MB,
      maxUploadsPerDay: DEFAULT_MAX_UPLOADS_PER_DAY,
    })
    expect(parseCaps({})).toEqual(parseCaps(undefined))
  })

  it('falls back per value on empty, non-numeric, zero or negative input', () => {
    const parsed = parseCaps({ MAX_UPLOAD_MB: '  ', MAX_R2_TOTAL_MB: 'lots', MAX_UPLOADS_PER_DAY: '-3' })
    expect(parsed).toEqual({
      maxUploadMb: DEFAULT_MAX_UPLOAD_MB,
      maxR2TotalMb: DEFAULT_MAX_R2_TOTAL_MB,
      maxUploadsPerDay: DEFAULT_MAX_UPLOADS_PER_DAY,
    })
    expect(parseCaps({ MAX_UPLOAD_MB: '0' }).maxUploadMb).toBe(DEFAULT_MAX_UPLOAD_MB)
  })

  it('keeps fractional values, so a small cap can be tested', () => {
    expect(parseCaps({ MAX_UPLOAD_MB: '0.5' }).maxUploadMb).toBe(0.5)
  })
})

describe('caps: bytesToMb', () => {
  it('converts bytes to MB with one decimal, rounded up', () => {
    expect(bytesToMb(0)).toBe(0)
    expect(bytesToMb(MB)).toBe(1)
    expect(bytesToMb(1.5 * MB)).toBe(1.5)
    expect(bytesToMb(1_234_567)).toBe(1.2)
    // A bucket that holds only a few bytes is not reported as 0 MB.
    expect(bytesToMb(8008)).toBe(0.1)
  })
})

describe('caps: checkUpload', () => {
  it('allows an upload inside every cap', () => {
    expect(checkUpload(usage(), caps)).toBe(null)
  })

  it('rejects a file bigger than MAX_UPLOAD_MB with 413', () => {
    expect(checkUpload(usage({ sizeBytes: 10 * MB + 1 }), caps)).toEqual({
      status: 413,
      body: { error: 'file_too_large', maxMb: 10 },
    })
  })

  it('allows a file of exactly MAX_UPLOAD_MB', () => {
    expect(checkUpload(usage({ sizeBytes: 10 * MB }), caps)).toBe(null)
  })

  it('rejects an upload that would pass MAX_R2_TOTAL_MB with 507', () => {
    expect(checkUpload(usage({ sizeBytes: 2 * MB, usedBytes: 4999 * MB }), caps)).toEqual({
      status: 507,
      body: { error: 'storage_cap_reached', usedMb: 4999, capMb: 5000 },
    })
  })

  it('allows an upload that lands exactly on MAX_R2_TOTAL_MB', () => {
    expect(checkUpload(usage({ sizeBytes: 1 * MB, usedBytes: 4999 * MB }), caps)).toBe(null)
  })

  it('reports the used size rounded to 0.1 MB', () => {
    const res = checkUpload(usage({ sizeBytes: 2 * MB, usedBytes: 4_999.25 * MB }), caps)
    expect(res?.body).toEqual({ error: 'storage_cap_reached', usedMb: 4999.3, capMb: 5000 })
  })

  it('rejects the first upload over MAX_UPLOADS_PER_DAY with 429', () => {
    expect(checkUpload(usage({ uploadsLast24h: 200 }), caps)).toEqual({
      status: 429,
      body: { error: 'daily_upload_cap', cap: 200 },
    })
    expect(checkUpload(usage({ uploadsLast24h: 199 }), caps)).toBe(null)
  })

  it('checks the file size and the total before the daily count', () => {
    const over = usage({ sizeBytes: 20 * MB, usedBytes: 6000 * MB, uploadsLast24h: 500 })
    expect(checkUpload(over, caps)?.status).toBe(413)
    expect(checkUpload({ ...over, sizeBytes: 1 * MB }, caps)?.status).toBe(507)
    expect(checkUpload({ ...over, sizeBytes: 1 * MB, usedBytes: 0 }, caps)?.status).toBe(429)
  })

  it('treats missing or nonsense numbers as zero', () => {
    const bad = { sizeBytes: Number.NaN, usedBytes: -5, uploadsLast24h: Number.NaN }
    expect(checkUpload(bad, caps)).toBe(null)
  })

  it('rejects every upload when the caps are tiny', () => {
    const tiny: Caps = { maxUploadMb: 0.001, maxR2TotalMb: 0.001, maxUploadsPerDay: 1 }
    expect(checkUpload(usage({ sizeBytes: MB }), tiny)?.status).toBe(413)
    expect(checkUpload(usage({ sizeBytes: 1 }), tiny)).toBe(null)
    expect(checkUpload(usage({ sizeBytes: 1, uploadsLast24h: 1 }), tiny)?.status).toBe(429)
  })
})

describe('caps: uploadWindowStartIso', () => {
  it('returns the start of the 24 h window', () => {
    expect(uploadWindowStartIso(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z')
  })
})
