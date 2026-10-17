import { useEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { FileText, Library, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Sun, Trash2, X, type LucideIcon } from 'lucide-react'
import { API_BASE, MOCK } from '../api'
import { session, signOut } from '../lib/auth'
import { clock, useData, useNow } from '../lib/data'
import { Link, navigate, setQueryParam, usePath } from '../lib/router'
import { chats, deleteChat, useRun } from '../lib/run'
import { createStore } from '../lib/store'
import { BrandLogo } from './brand'
import { STATUS_COLOR, cn } from './ui'

/* ── Theme: dark by default, light for projectors ── */

type Theme = 'dark' | 'light'
const readTheme = (): Theme => {
  try {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}
const theme = createStore<Theme>(readTheme())

function ThemeToggle() {
  const t = theme.use()
  const next: Theme = t === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button" className="btn btn-quiet" aria-label={`Switch to the ${next} theme`} title={`Switch to the ${next} theme`}
      onClick={(e) => {
        const apply = () => {
          theme.set(next)
          document.documentElement.dataset.theme = next
          try {
            localStorage.setItem('theme', next)
          } catch { /* storage unavailable: the choice lasts for this page only */ }
        }
        // The new theme spreads in a circle from the button (Magic UI Animated Theme Toggler); a plain switch without View Transitions.
        if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return apply()
        const b = e.currentTarget.getBoundingClientRect()
        const x = b.left + b.width / 2
        const y = b.top + b.height / 2
        const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
        document.startViewTransition(() => flushSync(apply)).ready.then(() => {
          document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
            { duration: 600, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
          )
        })
      }}
    >
      {t === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}

/* ── Backend status (cold-start aware, frontend.md §4) ── */

function Health() {
  const { health, retryHealth } = useData()
  const waiting = health.state === 'checking' || health.state === 'waking'
  const now = useNow(waiting)
  const secs = Math.round((now - health.since) / 1000)
  const pill = 'whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-bold'

  if (health.state === 'ok') {
    const mock = MOCK || health.health.mock_mode
    return (
      <div className="flex items-center gap-2">
        {mock && (
          <span className={cn(pill, 'border-warn/50 bg-warn-bg text-warn')}
            title={MOCK ? 'No backend configured (VITE_API_BASE_URL). Runs replay a canned example.' : 'The backend runs with MOCK_MODE=1 and replays a recorded run.'}>
            Mock<span className="max-sm:hidden"> data</span>
          </span>
        )}
        {!mock && !health.health.llm_ready && <span className={cn(pill, 'border-warn/50 bg-warn-bg text-warn')} title="The backend reports llm_ready: false">LLM not configured</span>}
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-ink-2" role="status" title={`${API_BASE}, version ${health.health.version}`}>
          <span className="size-2 rounded-full bg-ok shadow-[0_0_8px_var(--ok)]" aria-hidden /><span className="max-md:sr-only">Backend ready</span>
        </span>
      </div>
    )
  }
  if (health.state === 'down') {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-bad" role="status" title={health.error}>
        <span className="size-2 rounded-full bg-bad" aria-hidden /><span className="max-md:sr-only">Backend unreachable</span>
        <button type="button" className="btn btn-quiet py-1 text-[14px]" onClick={retryHealth}>Retry</button>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-ink-2" role="status" title="Free-tier servers sleep when idle and take 30–60 s to wake.">
      <span className={cn('size-2 animate-pulse rounded-full', secs < 3 ? 'bg-ink-3' : 'bg-warn')} aria-hidden />
      <span className="max-md:sr-only">{secs < 3 ? 'Connecting…' : `Waking up the server… ${clock(secs * 1000)}`}</span>
    </span>
  )
}

/* ── Sidebar: new assessment, pages and the chat history, like a chat app ── */

const day = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function ChatHistory({ onPick }: { onPick(): void }) {
  const run = useRun()
  const { cases } = useData()
  const list = chats.use()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      <h2 className="px-3 pb-1.5 pt-5 text-[13px] font-semibold text-ink-3">Recent chats</h2>
      {list.length ? (
        <ul className="space-y-0.5">
          {list.map((chat) => {
            const first = chat.turns[0]
            const last = chat.turns[chat.turns.length - 1]
            const c = first.caseId ? cases.find((x) => x.case_id === first.caseId) : undefined
            const status = last.report?.decision_status
            const color = last.phase === 'failed' && !status ? 'var(--bad)' : status ? STATUS_COLOR[status] : 'var(--ink-3)'
            const n = chat.turns.length
            const current = run.chatId === chat.id
            return (
              <li key={chat.id} className="group relative">
                <button
                  type="button" aria-current={current ? 'page' : undefined}
                  onClick={() => { onPick(); navigate('/'); if (!current) run.openChat(chat.id) }}
                  className={cn('flex w-full items-start gap-2.5 rounded-lg py-2 pl-3 pr-9 text-left transition-colors', current ? 'bg-surface-3' : 'hover:bg-surface-2')}
                >
                  <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', !status && last.phase !== 'failed' && 'animate-pulse')} style={{ background: color }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium leading-snug">{c ? `${c.case_id} – ${c.title}` : first.message ?? first.enquiry}</span>
                    <span className="mt-0.5 block text-[13px] text-ink-3">{n > 1 ? `${n} questions, ` : ''}{day(chat.at)}</span>
                  </span>
                </button>
                <button
                  type="button" aria-label="Delete chat" title="Delete chat"
                  className="absolute right-1.5 top-2 rounded-md p-1.5 text-ink-3 opacity-0 transition-opacity hover:bg-surface-3 hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => {
                    if (!window.confirm('Delete this chat and its saved results? This cannot be undone.')) return
                    if (current) run.reset()
                    deleteChat(chat.id)
                  }}
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      ) : <p className="px-3 py-1 text-[14px] leading-snug text-ink-3">Your chats show here, with every question you asked in them.</p>}
      {MOCK && list.length > 0 && <p className="px-3 pt-3 text-[13px] text-ink-3">Mock chats are kept in this browser only.</p>}
    </div>
  )
}

/** Who is signed in, with a way out. Only shown when the backend uses sign-in. */
function Account() {
  const s = session.use()
  if (!s) return null
  return (
    <div className="flex items-center gap-2.5 border-t border-rule px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[image:var(--fibers)] text-[14px] font-bold text-[#060b19]" aria-hidden>
        {s.user.trim()[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{s.user}</span>
        <span className="block text-[13px] text-ink-3">Signed in</span>
      </span>
      <button type="button" className="btn btn-quiet p-2" aria-label="Sign out" title="Sign out"
        onClick={() => { setQueryParam('thread', null); navigate('/'); signOut() }}>
        <LogOut size={17} />
      </button>
    </div>
  )
}

function Sidebar({ onPick, close }: { onPick(): void; close: { label: string; Icon: LucideIcon; onClick(): void } }) {
  const path = usePath()
  const run = useRun()
  const item = (active: boolean) =>
    cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors', active ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')
  return (
    <>
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <Link to="/" onClick={onPick} className="flex min-w-0 items-center gap-2.5" aria-label="AFS Spectroscopy Assistant, home">
          <BrandLogo className="h-8 w-auto" />
          <span className="whitespace-nowrap border-l border-rule-strong pl-2.5 text-[13px] font-semibold leading-tight text-ink-2">Spectroscopy<br />Assistant</span>
        </Link>
        <button type="button" className="btn btn-quiet ml-auto p-1.5" onClick={close.onClick} aria-label={close.label} title={close.label}><close.Icon size={18} /></button>
      </div>
      <nav aria-label="Main" className="space-y-0.5 px-3">
        <button type="button" onClick={() => { onPick(); run.reset(); navigate('/') }} className={cn(item(false), 'font-semibold text-ink')}>
          <span className="grid size-6 place-items-center rounded-full bg-prism text-white"><Plus size={16} strokeWidth={2.6} aria-hidden /></span> New assessment
        </button>
        <Link to="/reports" onClick={onPick} aria-current={path.startsWith('/reports') ? 'page' : undefined} className={item(path.startsWith('/reports'))}>
          <FileText size={18} className="mx-[3px]" aria-hidden /> Reports
        </Link>
        <Link to="/sources" onClick={onPick} aria-current={path === '/sources' ? 'page' : undefined} className={item(path === '/sources')}>
          <Library size={18} className="mx-[3px]" aria-hidden /> Knowledge base
        </Link>
      </nav>
      <ChatHistory onPick={onPick} />
      <Account />
    </>
  )
}

/* ── Shell ── */

const readSidebar = () => {
  try {
    const v = localStorage.getItem('sidebar')
    if (v) return v === 'open'
  } catch { /* storage unavailable */ }
  return innerWidth >= 1280
}
const sidebar = createStore<boolean>(readSidebar())
const setSidebar = (open: boolean) => {
  sidebar.set(open)
  try {
    localStorage.setItem('sidebar', open ? 'open' : 'closed')
  } catch { /* storage unavailable: the choice lasts for this page only */ }
}

export function Shell({ children }: { children: ReactNode }) {
  const open = sidebar.use()
  const [drawer, setDrawer] = useState(false)
  const path = usePath()
  const shut = () => setDrawer(false)

  useEffect(shut, [path])
  useEffect(() => {
    if (!drawer) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [drawer])

  return (
    <div className="atmosphere print-full flex min-h-dvh">
      {/* Desktop: a sidebar that can be folded away. */}
      {open && (
        <aside aria-label="Chats and pages" className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-rule bg-[color-mix(in_oklab,var(--surface)_72%,transparent)] backdrop-blur-md lg:flex">
          <Sidebar onPick={() => {}} close={{ label: 'Close the sidebar', Icon: PanelLeftClose, onClick: () => setSidebar(false) }} />
        </aside>
      )}
      {/* Phones and small windows: the same sidebar as a drawer. */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-[rgb(3_6_15/0.55)] backdrop-blur-[2px]" onClick={shut} aria-hidden />
          <aside aria-label="Chats and pages" className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col border-r border-rule bg-surface shadow-2xl">
            <Sidebar onPick={shut} close={{ label: 'Close the menu', Icon: X, onClick: shut }} />
          </aside>
        </div>
      )}

      <div className="print-full flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-1.5 border-b border-rule/70 bg-canvas/70 px-3 backdrop-blur-md sm:px-4">
          <button type="button" className="btn btn-quiet p-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open the menu"><Menu size={20} /></button>
          {!open && <button type="button" className="btn btn-quiet hidden p-2 lg:inline-flex" onClick={() => setSidebar(true)} aria-label="Open the sidebar" title="Open the sidebar"><PanelLeftOpen size={19} /></button>}
          <Link to="/" className={cn('flex items-center', open && 'lg:hidden')} aria-label="AFS Spectroscopy Assistant, home">
            <BrandLogo className="h-7 w-auto max-sm:hidden" />
            <img src="/brand/afs-mark.png" alt="ArtFiberSystems" className="h-7 w-auto sm:hidden" />
          </Link>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Health />
            <ThemeToggle />
          </div>
        </header>
        <main className="print-full flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  )
}
