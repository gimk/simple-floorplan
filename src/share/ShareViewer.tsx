// Read-only contractor view of one plan (docs/plan.md 7.4), served at /share#<token>.
//
// Security: the token is read from the URL FRAGMENT, kept in memory, and sent only as
// an `Authorization: Bearer` header. It is never put in a query string, never logged,
// never written to localStorage, and this viewer sends no passcode. src/main.tsx
// renders it instead of App, and does not hydrate the local store: the viewer never
// touches the IndexedDB plans of this browser.
import { useCallback, useEffect, useState } from 'react'
import { Link2, Loader2, Lock, RefreshCw } from 'lucide-react'
import { renderPlanSvg } from '../core/export'
import { BTN, ERROR, MUTED, PANEL_CARD, SECTION_PAD } from '../shell/panel'
import { initTheme } from '../shell/theme'
import { download, slug } from '../features/export/csv'
import { surveyCsv } from '../features/export/surveyExport'
import { ShareApiError, fetchDxf, fetchPlan, whoAmI, type SharePlan } from './shareApi'
import { problemForStatus, problemText, tokenFromHash, type ShareProblem } from './shareLink'
import { DimensionsTable, NotesList, OpeningsTable, PlanImage, RoomsTable } from './ShareSections'

// First paint in the saved light/dark theme, like App (src/shell/theme.ts is shared).
initTheme()

const CARD = `${PANEL_CARD} ${SECTION_PAD} bg-white dark:bg-[#1b2128]`

type State =
  | { phase: 'loading' }
  | { phase: 'error'; problem: ShareProblem }
  | { phase: 'ready'; token: string; projectId: string; plan: SharePlan }

/** Error screen: one clear title, one hint, and a retry when it can help. */
function ProblemScreen({ problem, onRetry }: { problem: ShareProblem; onRetry: () => void }) {
  const { title, hint } = problemText(problem)
  const retry = problem === 'network' || problem === 'server'
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-3 p-4">
      <div role="alert" className={CARD}>
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        <p className={`${MUTED} mt-1`}>{hint}</p>
        {retry && (
          <button type="button" className={`${BTN} mt-3`} onClick={onRetry}>
            <RefreshCw size={14} /> Try again
          </button>
        )}
      </div>
      <p className={`${MUTED} text-center`}>Read-only share link · nothing can be changed here.</p>
    </main>
  )
}

/** The four downloads of the link. DXF comes from the API with the same token. */
function Downloads({ token, projectId, plan }: { token: string; projectId: string; plan: SharePlan }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const name = slug(plan.title || 'floorplan')

  const run = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const svg = run('svg', async () => {
    download(`${name}.svg`, new Blob([renderPlanSvg(plan).svg], { type: 'image/svg+xml' }))
  })
  const pdf = run('pdf', async () => {
    const { exportPlanPdf } = await import('../features/export/pdfExport')
    download(`${name}.pdf`, await exportPlanPdf(plan))
  })
  const csv = run('csv', async () => {
    download(`${name}-survey.csv`, new Blob(['\ufeff' + surveyCsv(plan)], { type: 'text/csv;charset=utf-8' }))
  })
  const dxf = run('dxf', async () => {
    download(`${name}.dxf`, await fetchDxf(token, projectId))
  })

  return (
    <section aria-label="Downloads" className={CARD}>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <button type="button" className={BTN} disabled={!!busy} onClick={svg}>
          SVG
        </button>
        <button type="button" className={BTN} disabled={!!busy} onClick={pdf}>
          PDF
        </button>
        <button type="button" className={BTN} disabled={!!busy} onClick={csv}>
          Survey CSV
        </button>
        <button type="button" className={BTN} disabled={!!busy} onClick={dxf}>
          DXF
        </button>
      </div>
      {busy && <p className={`${MUTED} mt-2`}>Preparing the file…</p>}
      {err && (
        <p role="alert" className={`${ERROR} mt-2`}>
          {err}
        </p>
      )}
    </section>
  )
}

/** Load the link, then show the plan read-only. */
export function ShareViewer() {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let alive = true
    const token = tokenFromHash(location.hash)
    setState({ phase: 'loading' })
    if (!token) {
      setState({ phase: 'error', problem: 'no-token' })
      return () => {
        alive = false
      }
    }
    void (async () => {
      try {
        const me = await whoAmI(token)
        if (!me.canRead) {
          if (alive) setState({ phase: 'error', problem: 'forbidden' })
          return
        }
        if (!me.projectId) {
          if (alive) setState({ phase: 'error', problem: 'no-project' })
          return
        }
        const plan = await fetchPlan(token, me.projectId)
        if (alive) setState({ phase: 'ready', token, projectId: me.projectId, plan })
      } catch (e) {
        if (!alive) return
        const problem: ShareProblem =
          e instanceof ShareApiError ? problemForStatus(e.status) : e instanceof TypeError ? 'network' : 'server'
        setState({ phase: 'error', problem })
      }
    })()
    return () => {
      alive = false
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  // Tab title, so a contractor with several links open sees which plan is which.
  useEffect(() => {
    document.title =
      state.phase === 'ready' ? `${state.plan.title?.trim() || 'Floor plan'} · read-only` : 'Read-only plan'
  }, [state])

  if (state.phase === 'loading') {
    return (
      <main className="mx-auto flex min-h-full max-w-md items-center justify-center gap-2 p-4">
        <Loader2 size={16} className="animate-spin" aria-hidden />
        <p role="status" className={MUTED}>
          Loading the plan…
        </p>
      </main>
    )
  }
  if (state.phase === 'error') return <ProblemScreen problem={state.problem} onRetry={retry} />

  const { plan, token, projectId } = state
  const title = plan.title?.trim() || 'Floor plan'

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-3 sm:p-5">
      <header className="flex flex-col gap-1">
        <p className={`${MUTED} flex items-center gap-1`}>
          <Lock size={12} aria-hidden /> Read-only link · you cannot change this plan
        </p>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl dark:text-slate-100">{title}</h1>
      </header>

      <PlanImage doc={plan} />
      <Downloads token={token} projectId={projectId} plan={plan} />
      <RoomsTable doc={plan} />
      <DimensionsTable doc={plan} />
      <OpeningsTable doc={plan} />
      <NotesList doc={plan} />

      <footer className={`${MUTED} flex flex-col gap-1 pb-4 text-center`}>
        <span className="inline-flex items-center justify-center gap-1">
          <Link2 size={12} aria-hidden /> Shared by the plan owner. Revoking the link stops access.
        </span>
        <a href="/" className="underline hover:no-underline">
          Open the floorplan app
        </a>
      </footer>
    </main>
  )
}

export default ShareViewer
