// Share section of the Plan tab: create, copy and revoke read-only contractor links
// (docs/plan.md 7.4). One link = one API token with scope "read", limited to this
// project, named "share: <project title> <date>".
//
// The link is `<origin>/share#<token>`: the token is in the URL fragment, so it never
// reaches the server logs or a Referer header. It is shown once (the API stores only a
// hash) and kept in memory here, never in localStorage.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Link2, Share2, Trash2 } from 'lucide-react'
import { useDoc } from '../../model/store'
import { useSyncState } from '../../sync/sync'
import * as api from '../../sync/api'
import { isLocalId } from '../../sync/projects'
import { BTN, EmptyHint, ERROR, IconButton, MUTED, PanelSection } from '../../shell/panel'
import { isoDay, shareTokenName, shareTokensFor, shareUrl, todayIsoDay } from '../../share/shareLink'

type Created = { id: string; url: string }

/** Why the section cannot create links yet, or null when it can. */
// "online" means the server accepts this app (admin passcode, or a server without a passcode),
// so it can manage tokens. "locked" means the server wants a passcode.
function blockedReason(conn: string, localProject: boolean): string | null {
  if (localProject) return 'This project is not saved online yet. It becomes a server project at the next save.'
  if (conn === 'locked') return 'Enter your passcode (top bar) to manage share links: creating one needs admin access.'
  if (conn !== 'online') return 'Connect to the server to create a share link.'
  return null
}

export function SharePanel() {
  const doc = useDoc((s) => s.doc)
  const { conn } = useSyncState()
  const [tokens, setTokens] = useState<api.ApiTokenRow[] | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const linkRef = useRef<HTMLInputElement | null>(null)

  const projectId = doc.projectId
  const blocked = blockedReason(conn, isLocalId(projectId))

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const { tokens: all } = await api.listTokens({ signal })
        setTokens(shareTokensFor(all, projectId))
        setErr(null)
      } catch (e) {
        if (signal.aborted) return
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [projectId],
  )

  useEffect(() => {
    if (blocked) return
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [blocked, load])

  const create = async () => {
    setBusy('create')
    setErr(null)
    setCopied(false)
    try {
      const token = await api.createToken({
        name: shareTokenName(doc.title ?? '', todayIsoDay()),
        scopes: 'read',
        projectId,
      })
      setCreated({ id: token.id, url: shareUrl(location.origin, token.token) })
      const ctrl = new AbortController()
      await load(ctrl.signal)
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 404) {
        setErr('This project is not saved online yet, so no link can be created.')
      } else {
        setErr(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (id: string) => {
    setBusy(id)
    setErr(null)
    try {
      await api.revokeToken(id)
      setTokens((list) => (list ?? []).filter((t) => t.id !== id))
      if (created?.id === id) setCreated(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (insecure context or denied): select the text instead.
      linkRef.current?.focus()
      linkRef.current?.select()
    }
  }

  return (
    <PanelSection id="share" title="Share" icon={<Share2 size={16} />} collapsible defaultOpen={false}>
      <p className={MUTED}>Anyone with the link can view this plan. Revoke to stop access.</p>

      <button type="button" className={`${BTN} w-full`} disabled={!!blocked || !!busy} onClick={create}>
        <Link2 size={14} /> {busy === 'create' ? 'Creating…' : 'Create read-only link'}
      </button>
      {blocked && <EmptyHint>{blocked}</EmptyHint>}

      {created && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <input
              ref={linkRef}
              readOnly
              value={created.url}
              aria-label="Read-only link"
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-md border border-black/15 bg-white px-2 text-xs text-slate-900 dark:border-white/15 dark:bg-[#12161b] dark:text-slate-100 pointer-coarse:h-11"
            />
            <IconButton
              label={copied ? 'Copied' : 'Copy link'}
              icon={copied ? <Check size={16} /> : <Copy size={16} />}
              onClick={copy}
            />
          </div>
          <EmptyHint>This full link is shown once. Copy it now and send it to the contractor.</EmptyHint>
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="flex flex-col gap-1">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 border-t border-black/5 pt-1 text-xs dark:border-white/5"
            >
              <span className="min-w-0">
                <span className="block truncate" title={t.name}>
                  {t.name}
                </span>
                <span className={MUTED}>
                  Created {isoDay(t.createdAt) || '–'} ·{' '}
                  {t.lastUsedAt ? `last used ${isoDay(t.lastUsedAt)}` : 'never used'}
                </span>
              </span>
              <IconButton
                label={`Revoke ${t.name}`}
                icon={<Trash2 size={16} />}
                variant="danger"
                disabled={busy === t.id}
                onClick={() => revoke(t.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {tokens && tokens.length === 0 && !created && <EmptyHint>No share link yet for this project.</EmptyHint>}
      {err && (
        <p role="alert" className={ERROR}>
          {err}
        </p>
      )}
    </PanelSection>
  )
}
