// Pure helpers of the read-only contractor share link (docs/plan.md 7.4).
// No I/O here: everything is a plain function of its arguments, so it is unit-tested
// in ./shareLink.test.ts.
//
// Security rule of this feature: the token lives in the URL FRAGMENT (`/share#sfp_…`),
// because a fragment never reaches the server: not in access logs, not in a Referer
// header, not in a query string. It is never written to localStorage.
import { isValidTokenFormat } from '../core/access'

/** Path of the viewer. src/main.tsx renders ShareViewer instead of App for it. */
export const SHARE_PATH = '/share'

/** Name prefix of the tokens this feature creates ("share: Apt 4B 2026-02-01"). */
export const SHARE_NAME_PREFIX = 'share:'

/** True for a token name created by the share feature. */
export const isShareTokenName = (name: string): boolean =>
  name.trim().toLowerCase().startsWith(SHARE_NAME_PREFIX)

/**
 * The token of a share link, or null when the fragment holds no valid token.
 * Accepts "#sfp_…" and "sfp_…"; anything else (empty, wrong prefix, wrong length)
 * gives null so the viewer can show its "no token" screen.
 */
export function tokenFromHash(hash: string): string | null {
  const trimmed = hash.trim()
  const raw = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  let decoded: string
  try {
    decoded = decodeURIComponent(raw.trim())
  } catch {
    return null
  }
  return isValidTokenFormat(decoded) ? decoded : null
}

/** The link to hand to a contractor: `<origin>/share#<token>`. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${SHARE_PATH}#${token}`
}

/** Token name: "share: <project title> <yyyy-mm-dd>". */
export function shareTokenName(title: string, isoDay: string): string {
  const name = title.trim() || 'Floor plan'
  return `${SHARE_NAME_PREFIX} ${name} ${isoDay}`.trim()
}

/** "2026-02-01T09:12:33.000Z" -> "2026-02-01"; empty string when there is no date. */
export const isoDay = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '')

/** Today as yyyy-mm-dd (UTC), for a token name. */
export const todayIsoDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10)

type TokenLike = { name: string; projectId: string | null; revoked: boolean }

/** The live share tokens of one project (newest first is the API's order). */
export function shareTokensFor<T extends TokenLike>(tokens: readonly T[], projectId: string): T[] {
  return tokens.filter((t) => !t.revoked && t.projectId === projectId && isShareTokenName(t.name))
}

// ---------- error screens ----------

/** What can go wrong when the viewer loads a link. */
export type ShareProblem =
  | 'no-token'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'no-project'
  | 'network'
  | 'server'

/** Map an HTTP status to a viewer screen: 401 = revoked or unknown link. */
export function problemForStatus(status: number): ShareProblem {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  return 'server'
}

const PROBLEM_TEXT: Record<ShareProblem, { title: string; hint: string }> = {
  'no-token': {
    title: 'This link is incomplete',
    hint: 'Open the full link you were given, with the part after the # sign. Ask for a new link if it still fails.',
  },
  unauthorized: {
    title: 'This link no longer works',
    hint: 'It was revoked or it is not valid. Ask the plan owner for a new link.',
  },
  forbidden: {
    title: 'This link cannot read the plan',
    hint: 'Ask the plan owner for a new read-only link.',
  },
  'not-found': {
    title: 'This plan is gone',
    hint: 'The plan was deleted. Ask the plan owner for a new link.',
  },
  'no-project': {
    title: 'This link is not for one plan',
    hint: 'Ask the plan owner for a read-only link created for this plan.',
  },
  network: {
    title: 'No connection',
    hint: 'Check your network and try again.',
  },
  server: {
    title: 'The server could not answer',
    hint: 'Try again in a moment. If it keeps failing, ask the plan owner for a new link.',
  },
}

/** Title and hint of one error screen. */
export const problemText = (problem: ShareProblem): { title: string; hint: string } => PROBLEM_TEXT[problem]
