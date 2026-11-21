// Pure cost-safety decisions for image uploads (no bindings, no DB: easy to test).
//
// R2 is billed per stored GB and per operation. The API keeps the bucket inside
// the free tier with three hard caps, read from the [vars] block in wrangler.toml:
//   MAX_UPLOAD_MB       biggest single file accepted (413 above it)
//   MAX_R2_TOTAL_MB     biggest total of all stored images (507 above it)
//   MAX_UPLOADS_PER_DAY biggest number of uploads in the last 24 h (429 above it)
// The route in functions/app.ts reads the usage from D1, calls
// checkUpload(), and only writes to R2 when the answer is null.

/** Bytes in one megabyte (1 MiB, the value shown to the user). */
export const MB = 1024 * 1024

export const DEFAULT_MAX_UPLOAD_MB = 10
export const DEFAULT_MAX_R2_TOTAL_MB = 5000
export const DEFAULT_MAX_UPLOADS_PER_DAY = 200

/** The three caps, in the units used by wrangler.toml. */
export type Caps = {
  maxUploadMb: number
  maxR2TotalMb: number
  maxUploadsPerDay: number
}

/** The part of the worker environment that holds the caps (all strings). */
export type CapsEnv = {
  MAX_UPLOAD_MB?: string
  MAX_R2_TOTAL_MB?: string
  MAX_UPLOADS_PER_DAY?: string
}

/** A positive finite number, else the default. Missing or empty values use the default. */
function capNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Read the caps from the environment, with defaults for missing or bad values. */
export function parseCaps(env: CapsEnv | undefined | null): Caps {
  return {
    maxUploadMb: capNumber(env?.MAX_UPLOAD_MB, DEFAULT_MAX_UPLOAD_MB),
    maxR2TotalMb: capNumber(env?.MAX_R2_TOTAL_MB, DEFAULT_MAX_R2_TOTAL_MB),
    maxUploadsPerDay: capNumber(env?.MAX_UPLOADS_PER_DAY, DEFAULT_MAX_UPLOADS_PER_DAY),
  }
}

/**
 * Megabytes for a byte count, rounded UP to 0.1 MB for the error payloads, so a
 * bucket that is nearly full never reports a value below its real size.
 */
export const bytesToMb = (bytes: number): number => Math.ceil((bytes / MB) * 10) / 10

/** Usage at the moment of the upload: the new file, the bucket total, the daily count. */
export type UploadUsage = {
  /** Size of the file that is being uploaded. */
  sizeBytes: number
  /** SUM(size_bytes) of every image row. */
  usedBytes: number
  /** Images uploaded in the last 24 h. */
  uploadsLast24h: number
}

export const ERR_FILE_TOO_LARGE = 'file_too_large'
export const ERR_STORAGE_CAP_REACHED = 'storage_cap_reached'
export const ERR_DAILY_UPLOAD_CAP = 'daily_upload_cap'

/** What the route must answer instead of writing to R2. */
export type UploadRejection =
  | { status: 413; body: { error: typeof ERR_FILE_TOO_LARGE; maxMb: number } }
  | { status: 507; body: { error: typeof ERR_STORAGE_CAP_REACHED; usedMb: number; capMb: number } }
  | { status: 429; body: { error: typeof ERR_DAILY_UPLOAD_CAP; cap: number } }

/**
 * Decide if an upload is allowed. Returns null when it may be written to R2,
 * else the status and body to send back. Checks run in this order:
 *   1. single file size   413 file_too_large
 *   2. bucket total       507 storage_cap_reached
 *   3. uploads last 24 h  429 daily_upload_cap
 * A value that is exactly at a cap is allowed: a total of MAX_R2_TOTAL_MB is fine,
 * the next byte is not.
 */
export function checkUpload(usage: UploadUsage, caps: Caps): UploadRejection | null {
  const sizeBytes = Number.isFinite(usage.sizeBytes) && usage.sizeBytes > 0 ? usage.sizeBytes : 0
  const usedBytes = Number.isFinite(usage.usedBytes) && usage.usedBytes > 0 ? usage.usedBytes : 0
  const uploads = Number.isFinite(usage.uploadsLast24h) && usage.uploadsLast24h > 0 ? usage.uploadsLast24h : 0

  if (sizeBytes > caps.maxUploadMb * MB) {
    return { status: 413, body: { error: ERR_FILE_TOO_LARGE, maxMb: caps.maxUploadMb } }
  }
  if (usedBytes + sizeBytes > caps.maxR2TotalMb * MB) {
    return {
      status: 507,
      body: { error: ERR_STORAGE_CAP_REACHED, usedMb: bytesToMb(usedBytes), capMb: caps.maxR2TotalMb },
    }
  }
  if (uploads >= caps.maxUploadsPerDay) {
    return { status: 429, body: { error: ERR_DAILY_UPLOAD_CAP, cap: caps.maxUploadsPerDay } }
  }
  return null
}

/** Start of the 24 h window used for MAX_UPLOADS_PER_DAY (ISO string, for D1). */
export const uploadWindowStartIso = (now: Date, windowMs = 24 * 60 * 60 * 1000): string =>
  new Date(now.getTime() - windowMs).toISOString()
