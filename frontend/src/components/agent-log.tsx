import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleCheck, CircleX, FileCheck, MessageCircleQuestionMark, TriangleAlert, UserRound } from 'lucide-react'
import type { AgentName, AgentStep } from '../api/types'
import { clock, useData, useNow } from '../lib/data'
import type { Entry, Group, RunState } from '../lib/run'
import { citeKey, traceStore } from '../lib/ui-state'
import { RollingClock } from './motion'
import { AGENTS, AGENT_ORDER, Citations, cn } from './ui'

// The agent log sits beside the answer for the whole run: four agents on a relay at the top,
// then every step in plain words. Pointing at a source in the answer lights up the step that found it.

export type NodeState = 'idle' | 'active' | 'waiting' | 'done' | 'returned'

const NODE_LABEL: Record<NodeState, string> = {
  idle: 'waiting', active: 'working', waiting: 'needs your answers', done: 'done', returned: 'sent the draft back',
}

export function nodeState(run: RunState, agent: AgentName): NodeState {
  if (run.phase === 'completed') return 'done'
  if (run.phase === 'awaiting_clarification' && agent === 'clarifier') return 'waiting'
  if (run.active === agent && (run.phase === 'running' || run.phase === 'starting')) return 'active'
  const groups = run.groups.filter((g) => g.agent === agent)
  const verdict = groups.flatMap((g) => g.entries).findLast((e) => e.kind === 'critic')
  if (agent === 'critic' && verdict?.kind === 'critic' && !verdict.passed && run.active === 'writer') return 'returned'
  return groups.length ? 'done' : 'idle'
}

function Relay({ run }: { run: RunState }) {
  return (
    <ol className="relative grid grid-cols-4" aria-label="Agents">
      <span aria-hidden className="absolute inset-x-[12.5%] top-[15px] h-0.5 rounded-full bg-[image:var(--fibers)] opacity-30" />
      {AGENT_ORDER.map((a) => {
        const { Icon, label, color } = AGENTS[a]
        const s = nodeState(run, a)
        const lit = s === 'active' || s === 'waiting'
        return (
          <li key={a} className="relative flex flex-col items-center gap-1.5" aria-label={`${label}, ${NODE_LABEL[s]}`}>
            <span
              className={cn('grid size-[30px] place-items-center rounded-full border transition-[opacity,background-color] duration-500', lit && 'node-active', s === 'idle' && 'opacity-40')}
              style={{
                ['--agent' as string]: color,
                color: s === 'returned' ? 'var(--bad)' : color,
                borderColor: lit || s === 'returned' ? 'currentColor' : 'var(--rule-strong)',
                background: lit ? `color-mix(in oklab, ${color} 24%, var(--surface))` : 'var(--surface)',
              }}
            >
              {s === 'done' ? <Check size={15} strokeWidth={2.6} aria-hidden /> : <Icon size={15} aria-hidden />}
            </span>
            <span className={cn('text-[12px] font-semibold', lit ? 'text-ink' : 'text-ink-3')}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export const call = (step: AgentStep) =>
  `${step.tool ?? 'tool'}(${step.args ? Object.values(step.args).map((v) => JSON.stringify(v)).join(', ') : ''})`

/** Tool calls in words where the tool is known; anything else as the raw call. */
function ToolCall({ s }: { s: AgentStep }) {
  const a = s.args ?? {}
  const strong = (t: unknown) => <span className="font-semibold text-ink">{String(t)}</span>
  const line =
    s.tool === 'search_kb' && a.query ? <>Searched the AFS sources for <q>{strong(a.query)}</q></>
    : s.tool === 'lookup_method_table' ? <>Looked up {strong([a.method, a.technique].filter(Boolean).join(', '))} in the method table</>
    : s.tool === 'check_citations' ? <>Checked every claim against its source</>
    : <code className="break-words font-mono text-[13px] text-ink">{call(s)}</code>
  return (
    <p className="text-[14px] leading-snug text-ink-2">
      {line}
      {s.summary && <span className="block text-[13px] text-ink-3">{s.summary}</span>}
    </p>
  )
}

function EntryRow({ e }: { e: Entry }) {
  switch (e.kind) {
    case 'step': {
      const s = e.step
      if (s.step_type === 'tool_call') return <ToolCall s={s} />
      if (s.step_type === 'tool_result') return (
        <div className="-mx-2 rounded-lg px-2 py-1 transition-[background-color,box-shadow]" data-cites={(s.citations ?? []).map(citeKey).join(' ')}>
          <p className="text-[14px] leading-snug text-ink-2">
            {/^\d/.test(s.summary) ? `Found ${s.summary}` : s.summary || 'Found results'} {s.citations?.length ? <Citations list={s.citations} /> : null}
          </p>
          {s.result_preview && (
            <details className="group mt-0.5">
              <summary className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-3 hover:text-ink">
                <ChevronDown size={13} aria-hidden className="transition-transform group-open:rotate-180" /> What it read
              </summary>
              <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[13px] leading-relaxed text-ink-2">{s.result_preview}</p>
            </details>
          )}
        </div>
      )
      return (
        <p className={cn('text-[14px] leading-snug', s.step_type === 'thought' ? 'italic text-ink-2' : 'text-ink')}>
          {s.summary} {s.citations?.length ? <Citations list={s.citations} /> : null}
        </p>
      )
    }
    case 'clarify':
      return (
        <p className="flex items-center gap-1.5 text-[14px] font-bold text-clarifier">
          <MessageCircleQuestionMark size={15} aria-hidden /> Asked {e.count} question{e.count === 1 ? '' : 's'}
        </p>
      )
    case 'draft':
      return <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-2"><FileCheck size={15} aria-hidden /> Draft {e.revision} ready</p>
    case 'critic':
      return e.passed ? (
        <p className="flex items-center gap-1.5 text-[14px] font-bold text-ok"><CircleCheck size={15} aria-hidden /> All checks passed</p>
      ) : (
        <div className="rounded-lg border border-bad/35 bg-bad-bg px-3 py-2">
          <p className="flex items-center gap-1.5 text-[14px] font-bold text-bad">
            <CircleX size={15} aria-hidden /> {e.issues.length} issue{e.issues.length === 1 ? '' : 's'}, sent back to the Writer
          </p>
          <ul className="mt-1.5 space-y-1">
            {e.issues.map((i, k) => <li key={k} className="text-[13px] leading-snug text-ink">{i.message}</li>)}
          </ul>
        </div>
      )
    case 'error':
      return (
        <p className="flex items-start gap-1.5 text-[14px] text-bad">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden /> {e.message}
        </p>
      )
  }
}

function GroupItem({ g, base, live }: { g: Group; base: number; live: boolean }) {
  const { Icon, label, color } = AGENTS[g.agent]
  const point = () => traceStore.set(`agent:${g.agent}`)
  const leave = () => traceStore.set(null)
  return (
    <li className={cn('relative pl-11', live && 'log-in')}>
      <span className="absolute left-0 top-0 grid size-8 place-items-center rounded-full shadow-[0_0_0_4px_var(--surface)]" style={{ background: `color-mix(in oklab, ${color} 18%, var(--surface))`, color }}>
        <Icon size={15} aria-hidden />
      </span>
      <div className="flex items-baseline gap-2 pt-1.5" onMouseEnter={point} onMouseLeave={leave}>
        <h3 className="text-[14px] font-bold" style={{ color }}>{label}</h3>
        {g.round != null && <span className="text-[13px] text-ink-3">round {g.round}</span>}
        {g.revision != null && (g.agent === 'writer' || g.agent === 'critic') && <span className="text-[13px] text-ink-3">draft {g.revision}</span>}
        <span className="ml-auto text-[12px] tabular-nums text-ink-3">{clock(Math.max(0, g.at - base))}</span>
      </div>
      {g.entries.length > 0 && <ul className="mt-1.5 space-y-2">{g.entries.map((e) => <li key={e.id} className={live ? 'log-in' : undefined}><EntryRow e={e} /></li>)}</ul>}
    </li>
  )
}

/** The log of one question in the chat; with several questions, numbered buttons switch between their logs. */
export function AgentLog({ run, turns = 1, at = 0, onPick }: { run: RunState; turns?: number; at?: number; onPick?(i: number): void }) {
  const { cases } = useData()
  const running = run.phase === 'starting' || run.phase === 'running' || run.phase === 'awaiting_clarification'
  const now = useNow(running)
  const elapsed = run.startedAt ? (run.endedAt ?? now) - run.startedAt : 0
  const base = run.startedAt ?? run.groups[0]?.at ?? 0
  const [open, setOpen] = useState(true)
  const [full, setFull] = useState(false)
  const feed = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const focus = traceStore.use()
  const steps = run.groups.reduce((n, g) => n + g.entries.length, 0)
  const title = run.caseId ? cases.find((c) => c.case_id === run.caseId)?.title : undefined
  const followUp = !!run.message && run.message !== run.enquiry
  const said = followUp ? run.message! : run.enquiry
  const passed = run.groups.flatMap((g) => g.entries).findLast((e) => e.kind === 'critic')

  // Follow new steps while the reader is at the bottom; leave them alone once they scroll up.
  useLayoutEffect(() => {
    const el = feed.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [run.seq, run.phase])

  // On phones the log folds away once the answer is there.
  const answered = !!run.report
  useEffect(() => { if (answered) setOpen(false) }, [answered])

  // A source pointed at in the answer lights up the step that found it, scrolled into view.
  useEffect(() => {
    const el = feed.current
    if (!el) return
    const hits = [...el.querySelectorAll<HTMLElement>('[data-cites]')].filter((x) => !!focus && x.dataset.cites!.split(' ').includes(focus))
    el.querySelectorAll<HTMLElement>('[data-hit]').forEach((x) => x.removeAttribute('data-hit'))
    hits.forEach((x) => x.setAttribute('data-hit', ''))
    const first = hits[0]
    if (!first || el.matches(':hover')) return
    const r = first.getBoundingClientRect()
    const f = el.getBoundingClientRect()
    if (r.top < f.top || r.bottom > f.bottom) el.scrollBy({ top: r.top - f.top - f.height / 3, behavior: 'smooth' })
  }, [focus])

  const status =
    run.restoring ? 'Reconnecting to the run…'
    : run.phase === 'starting' ? 'Waking the agents…'
    : run.phase === 'awaiting_clarification' ? 'The Clarifier is waiting for your answers'
    : run.phase === 'failed' ? 'The run stopped'
    : run.phase === 'completed' ? `Answer ready in ${clock(elapsed)}${passed?.kind === 'critic' ? (passed.passed ? ', checked by the Critic' : ', not passed by the Critic') : ''}`
    : run.active ? `${AGENTS[run.active].label} ${AGENTS[run.active].doing}…`
    : 'Assessing the enquiry…'

  return (
    <aside
      aria-label="Agent log"
      className="no-print flex min-h-0 flex-col border-rule bg-[color-mix(in_oklab,var(--surface)_72%,transparent)] backdrop-blur-md max-lg:mx-4 max-lg:mb-8 max-lg:rounded-2xl max-lg:border lg:sticky lg:top-[52px] lg:h-[calc(100dvh-52px)] lg:border-l"
    >
      <header className="border-b border-rule px-5 pb-4 pt-4">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-[16px] font-bold">Agent log</h2>
          <span className="text-[13px] text-ink-3"><RollingClock ms={elapsed} /></span>
          <div className="ml-auto flex items-center gap-1">
            {turns > 1 && onPick && (
              <div className="flex items-center gap-1" role="group" aria-label="Show the log of question">
                {Array.from({ length: turns }, (_, i) => (
                  <button
                    key={i} type="button" aria-pressed={i === at} aria-label={`Question ${i + 1}`} onClick={() => onPick(i)}
                    className={cn('grid size-6 place-items-center rounded-full text-[13px] font-bold transition-colors', i === at ? 'bg-ink text-surface' : 'text-ink-3 hover:bg-surface-3 hover:text-ink')}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-quiet py-1 text-[13px] lg:hidden" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide' : `Show ${steps} steps`} <ChevronDown size={15} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
            </button>
          </div>
        </div>
        <Relay run={run} />
        <p className={cn('mt-3.5 text-center text-[13px] font-semibold', running && 'shimmer-text')} role="status" style={{ color: running && run.active ? AGENTS[run.active].color : run.phase === 'failed' ? 'var(--bad)' : undefined, ['--shimmer' as string]: running && run.active ? AGENTS[run.active].color : 'var(--ink-2)' }}>
          {status}
        </p>
        {run.link === 'reconnecting' && <p className="mt-1 text-center text-[13px] text-warn">Connection dropped, reconnecting…</p>}
        {run.link === 'polling' && <p className="mt-1 text-center text-[13px] text-warn">Live log unavailable, checking the run every 5 s.</p>}
      </header>

      <div
        ref={feed} data-feed
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}
        className={cn('fade-edges min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5 max-lg:max-h-[55vh]', !open && 'max-lg:hidden')}
      >
        <ol className="log-line space-y-5" data-live={running || undefined}>
          <li className="relative pl-11">
            <span className="absolute left-0 top-0 grid size-8 place-items-center rounded-full bg-surface-3 text-ink-2 shadow-[0_0_0_4px_var(--surface)]"><UserRound size={15} aria-hidden /></span>
            <p className="pt-1.5 text-[14px] font-bold">
              {followUp ? `Follow-up, question ${at + 1}` : 'Customer enquiry'} {!followUp && run.caseId && <span className="text-cyan">{run.caseId}{title ? ` – ${title}` : ''}</span>}
            </p>
            <p className={cn('mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2', !full && 'line-clamp-4')}>{said || '…'}</p>
            {said.length > 220 && (
              <button type="button" className="text-[13px] font-semibold text-ink-3 hover:text-ink" onClick={() => setFull(!full)}>{full ? 'Show less' : 'Show all'}</button>
            )}
            {followUp && (
              <details className="group mt-1">
                <summary className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-3 hover:text-ink">
                  <ChevronDown size={13} aria-hidden className="transition-transform group-open:rotate-180" /> What the agents received
                </summary>
                <p className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[13px] leading-relaxed text-ink-2">{run.enquiry}</p>
              </details>
            )}
            <p className="mt-1 text-[13px] text-ink-3">{run.mode === 'interactive' ? 'Questions first' : 'Batch mode: no questions, unknowns become assumptions'}</p>
          </li>
          {run.traceLost && <li className="pl-11 text-[13px] text-ink-3">The step-by-step log isn’t kept after a page reload.</li>}
          {run.groups.map((g) => <GroupItem key={g.id} g={g} base={base} live={running} />)}
          {run.phase === 'completed' && (
            <li className="relative pl-11">
              <span className="absolute left-0 top-0 grid size-8 place-items-center rounded-full bg-ok text-surface shadow-[0_0_0_4px_var(--surface)]"><Check size={16} strokeWidth={2.6} aria-hidden /></span>
              <p className="pt-1.5 text-[14px] font-bold text-ok">Answer ready</p>
            </li>
          )}
        </ol>
      </div>
    </aside>
  )
}
