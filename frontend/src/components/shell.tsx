import { useEffect, useState, type ReactNode } from 'react'
import { FileText, Library, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, SquarePen, Sun, type LucideIcon } from 'lucide-react'
import { API_BASE, MOCK } from '../api'
import { clock, useData, useNow } from '../lib/data'
import { Link, navigate, usePath } from '../lib/router'
import { recents, useRun, type Recent } from '../lib/run'
import { createStore } from '../lib/store'
import { Logo, STATUS_COLOR, cn } from './ui'

/* ── Theme ── */

type Theme = 'system' | 'light' | 'dark'
const readTheme = (): Theme => {
  try {
    const t = localStorage.getItem('theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}
const theme = createStore<Theme>(readTheme())

function setTheme(t: Theme) {
  theme.set(t)
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try {
    if (t === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', t)
  } catch { /* storage unavailable: the choice lasts for this page only */ }
}

function ThemeToggle() {
  const t = theme.use()
  const next: Theme = t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'
  const Icon = t === 'system' ? Monitor : t === 'light' ? Sun : Moon
  return (
    <button type="button" className="btn btn-quiet gap-2 text-[13px]" onClick={() => setTheme(next)} aria-label={`Theme: ${t}. Switch to ${next}`}>
      <Icon size={17} aria-hidden /> Theme: {t === 'system' ? 'system' : t}
    </button>
  )
}

/* ── Backend status (cold-start aware, frontend.md §4) ── */

function Health() {
  const { health, retryHealth } = useData()
  const waiting = health.state === 'checking' || health.state === 'waking'
  const now = useNow(waiting)
  const secs = Math.round((now - health.since) / 1000)
  const pill = 'whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-bold'

  if (health.state === 'ok') {
    const mock = MOCK || health.health.mock_mode
    return (
      <div className="flex items-center gap-2">
        {mock && (
          <span className={cn(pill, 'border-warn/50 bg-warn-bg text-warn')}
            title={MOCK ? 'No backend configured (VITE_API_BASE_URL). Runs replay a canned example.' : 'The backend runs with MOCK_MODE=1 and replays a recorded run.'}>
            Mock data
          </span>
        )}
        {!mock && !health.health.llm_ready && <span className={cn(pill, 'border-warn/50 bg-warn-bg text-warn')} title="The backend reports llm_ready: false">LLM not configured</span>}
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-ink-2" role="status" title={`${API_BASE}, version ${health.health.version}`}>
          <span className="size-2 rounded-full bg-ok" aria-hidden /><span className="max-sm:sr-only">Backend ready</span>
        </span>
      </div>
    )
  }
  if (health.state === 'down') {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-bad" role="status" title={health.error}>
        <span className="size-2 rounded-full bg-bad" aria-hidden /><span className="max-sm:sr-only">Backend unreachable</span>
        <button type="button" className="btn btn-quiet py-1 text-[13px]" onClick={retryHealth}>Retry</button>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-ink-2" role="status" title="Free-tier servers sleep when idle and take 30–60 s to wake.">
      <span className={cn('size-2 animate-pulse rounded-full', secs < 3 ? 'bg-ink-3' : 'bg-warn')} aria-hidden />
      <span className="max-sm:sr-only">{secs < 3 ? 'Connecting…' : `Waking up the server… ${clock(secs * 1000)}`}</span>
    </span>
  )
}

/* ── Sidebar ── */

function NavItem({ to, Icon, label, active }: { to: string; Icon: LucideIcon; label: string; active: boolean }) {
  return (
    <Link
      to={to} aria-current={active ? 'page' : undefined}
      className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14.5px] font-semibold transition-colors', active ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-surface-3/70 hover:text-ink')}
    >
      <Icon size={17} aria-hidden /> {label}
    </Link>
  )
}

function RecentItem({ r, active, title, onPick }: { r: Recent; active: boolean; title: string; onPick(): void }) {
  const run = useRun()
  const color = r.status === 'failed' ? 'var(--bad)' : r.status ? STATUS_COLOR[r.status] : 'var(--ink-3)'
  return (
    <button
      type="button" aria-current={active ? 'true' : undefined}
      onClick={() => {
        navigate('/')
        if (run.threadId !== r.threadId) run.open(r.threadId)
        onPick()
      }}
      className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] transition-colors', active ? 'bg-surface-3 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-3/70 hover:text-ink')}
    >
      <span className={cn('size-2 shrink-0 rounded-full', !r.status && 'animate-pulse')} style={{ background: color }} aria-hidden />
      <span className="truncate">{title}</span>
    </button>
  )
}

/** onPick closes the phone drawer after an action that keeps the same URL. */
function Sidebar({ onClose, onPick }: { onClose(): void; onPick(): void }) {
  const run = useRun()
  const path = usePath()
  const { cases } = useData()
  const list = recents.use()
  const titleFor = (r: Recent) => {
    const c = r.caseId ? cases.find((x) => x.case_id === r.caseId) : undefined
    return c ? `${c.case_id} – ${c.title}` : r.enquiry
  }
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Logo size={28} className="text-ink" />
        <div className="min-w-0 leading-tight">
          <p className="display text-[15.5px]">AFS Assistant</p>
          <p className="text-[12px] text-ink-3">In-line spectroscopy design</p>
        </div>
        <button type="button" className="btn btn-quiet ml-auto" onClick={onClose} aria-label="Close sidebar"><PanelLeftClose size={18} /></button>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => { run.reset(); navigate('/'); onPick() }}
          className="flex w-full items-center gap-2.5 rounded-xl border border-rule-strong bg-surface px-3.5 py-2.5 text-[14.5px] font-semibold shadow-[0_1px_2px_rgb(10_18_36/0.06)] transition-colors hover:border-ink-3"
        >
          <SquarePen size={17} aria-hidden /> New assessment
        </button>
      </div>

      <nav aria-label="Main" className="mt-3 space-y-0.5 px-3">
        <NavItem to="/reports" Icon={FileText} label="Precomputed reports" active={path.startsWith('/reports')} />
        <NavItem to="/sources" Icon={Library} label="Knowledge base" active={path === '/sources'} />
      </nav>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <p className="px-3 pb-1.5 text-[12px] font-bold text-ink-3">Recent</p>
        {list.length ? (
          <ul className="space-y-0.5">
            {list.map((r) => (
              <li key={r.threadId}><RecentItem r={r} title={titleFor(r)} active={path === '/' && run.threadId === r.threadId} onPick={onPick} /></li>
            ))}
          </ul>
        ) : (
          <p className="px-3 text-[13px] leading-snug text-ink-3">{MOCK ? 'Mock runs show here until you reload.' : 'Assessments you run show here.'}</p>
        )}
      </div>

      <div className="border-t border-rule px-2 py-2">
        <ThemeToggle />
      </div>
    </div>
  )
}

/* ── Shell ── */

function useTitle() {
  const path = usePath()
  const run = useRun()
  const { cases } = useData()
  if (path !== '/') return ''
  const caseId = run.caseId ?? run.report?.case_id
  const c = caseId ? cases.find((x) => x.case_id === caseId) : undefined
  if (c) return `${c.case_id} – ${c.title}`
  if (run.phase === 'idle' && !run.turns.length) return ''
  return run.enquiry ? run.enquiry.slice(0, 80) : 'Assessment'
}

/** Chat-app layout: a sidebar for navigation and recent runs, the page beside it. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePath()
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const title = useTitle()

  useEffect(() => setDrawer(false), [path])

  return (
    <div className="print-full flex h-dvh overflow-hidden bg-surface">
      {!collapsed && (
        <aside className="no-print hidden w-[17rem] shrink-0 border-r border-rule bg-surface-2 lg:flex">
          <Sidebar onClose={() => setCollapsed(true)} onPick={() => {}} />
        </aside>
      )}
      {drawer && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-[rgb(10_18_36/0.42)]" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-[min(19rem,86vw)] bg-surface-2 shadow-2xl">
            <Sidebar onClose={() => setDrawer(false)} onPick={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="print-full flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
          <button type="button" className="btn btn-quiet lg:hidden" onClick={() => setDrawer(true)} aria-label="Open sidebar"><Menu size={19} /></button>
          {collapsed && (
            <button type="button" className="btn btn-quiet max-lg:hidden" onClick={() => setCollapsed(false)} aria-label="Open sidebar"><PanelLeftOpen size={19} /></button>
          )}
          <p className="min-w-0 truncate text-[15px] font-semibold text-ink-2">{title}</p>
          <div className="ml-auto"><Health /></div>
        </header>
        <main className="print-full min-h-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
