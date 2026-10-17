import { useEffect, useRef } from 'react'
import { Check, CircleX, MessageCircleQuestionMark, RotateCcw } from 'lucide-react'
import type { AgentName } from '../api/types'
import { useData, useNow } from '../lib/data'
import { Link } from '../lib/router'
import type { Entry, RunState } from '../lib/run'
import { call, nodeState, type NodeState } from './agent-log'
import { PrismMark } from './brand'
import { RollingClock } from './motion'
import { QuestionDeck } from './question-deck'
import { AGENTS, AGENT_ORDER, cn } from './ui'

// The run as light through the AFS prism: the enquiry goes in as one beam,
// four rays come out, one per agent, and each lights up while its agent works.

const ROW = 118
const GAP = 12
const HEIGHT = 4 * ROW + 3 * GAP
const MID = HEIGHT / 2
const rayY = (i: number) => i * (ROW + GAP) + ROW / 2

function lineFor(e: Entry) {
  switch (e.kind) {
    case 'step':
      return e.step.step_type === 'tool_call' ? call(e.step) : e.step.step_type === 'tool_result' ? `Result: ${e.step.summary || 'received'}` : e.step.summary
    case 'clarify': return `Asked ${e.count} question${e.count === 1 ? '' : 's'}`
    case 'draft': return `Draft revision ${e.revision} ready`
    case 'critic': return e.passed ? 'Passed all checks' : `${e.issues.length} issue${e.issues.length === 1 ? '' : 's'}: ${e.issues[0]?.message ?? ''}`
    case 'error': return e.message
  }
}

function station(run: RunState, agent: AgentName) {
  const entries = run.groups.filter((g) => g.agent === agent).flatMap((g) => g.entries)
  const writerTurns = run.groups.filter((g) => g.agent === 'writer').length
  const calls = entries.filter((e) => e.kind === 'step' && e.step.step_type === 'tool_call').length
  const asked = entries.find((e) => e.kind === 'clarify')
  const verdict = entries.findLast((e) => e.kind === 'critic')
  const summary =
    agent === 'clarifier' ? (asked?.kind === 'clarify' ? `Asked ${asked.count} questions` : 'Read the enquiry')
    : agent === 'researcher' ? `${calls} search${calls === 1 ? '' : 'es'} of the AFS sources`
    : agent === 'writer' ? `Wrote ${writerTurns} draft${writerTurns === 1 ? '' : 's'}`
    : verdict?.kind === 'critic' ? (verdict.passed ? `Passed after ${writerTurns} revision${writerTurns === 1 ? '' : 's'}` : `Found ${verdict.issues.length} issues`) : ''
  return { state: nodeState(run, agent), summary, lines: entries.slice(-2).map(lineFor).filter(Boolean) }
}

const STATE_LABEL: Record<NodeState, string> = {
  idle: 'Waiting', active: 'Working', waiting: 'Needs your answers', done: 'Done', returned: 'Sent back to the writer',
}

function Station({ run, agent, onAsk }: { run: RunState; agent: AgentName; onAsk(): void }) {
  const { Icon, label, color, role } = AGENTS[agent]
  const s = station(run, agent)
  const lit = s.state === 'active' || s.state === 'waiting'
  return (
    <li
      className={cn('glass relative flex gap-3.5 overflow-hidden px-4 py-3 transition-[box-shadow,opacity] duration-500', s.state === 'idle' && 'opacity-55', lit && 'node-active', s.state === 'active' && 'border-beam')}
      style={{ height: ROW, ['--agent' as string]: color, ['--beam' as string]: color, boxShadow: lit ? `0 0 0 1px ${color}, 0 0 36px -10px ${color}` : undefined }}
    >
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
        {s.state === 'done' ? <Check size={18} strokeWidth={2.6} aria-hidden /> : <Icon size={18} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-bold" style={{ color }}>{label}</h3>
          <span className={cn('flex items-center gap-1.5 text-[13px] font-semibold', s.state === 'returned' ? 'text-bad' : 'text-ink-3')}>
            {s.state === 'active' && <span className="size-1.5 animate-pulse rounded-full" style={{ background: color }} aria-hidden />}
            {STATE_LABEL[s.state]}
          </span>
        </div>
        {s.state === 'idle' || (s.state === 'active' && !s.lines.length) ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-3">{role}</p>
        ) : s.state === 'waiting' ? (
          <button type="button" onClick={onAsk} className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold" style={{ background: color, color: 'var(--surface)' }}>
            <MessageCircleQuestionMark size={14} aria-hidden /> Answer the questions
          </button>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {(s.state === 'done' ? [s.summary] : s.lines).map((l, i) => (
              <li key={i} className={cn('truncate text-[13px] leading-snug', /^\w+\(/.test(l) ? 'font-mono text-[13px] text-ink' : 'text-ink-2')}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

function Rays({ run }: { run: RunState }) {
  const live = run.phase === 'running' || run.phase === 'starting'
  return (
    <div className="relative @max-xl:hidden" style={{ height: HEIGHT }} aria-hidden>
      <svg viewBox={`0 0 300 ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <path d={`M0 ${MID} H96`} stroke="var(--ink)" strokeOpacity=".2" strokeWidth="9" vectorEffect="non-scaling-stroke" style={{ filter: 'blur(4px)' }} />
        <path d={`M0 ${MID} H96`} stroke="var(--ink)" strokeOpacity=".85" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {live && <path d={`M0 ${MID} H96`} stroke="var(--prism)" strokeWidth="2" vectorEffect="non-scaling-stroke" className="ray-live" />}
        {AGENT_ORDER.map((a, i) => {
          const s = nodeState(run, a)
          const d = `M106 ${MID} C190 ${MID} 214 ${rayY(i)} 300 ${rayY(i)}`
          const color = s === 'returned' ? 'var(--bad)' : AGENTS[a].color
          const lit = s === 'active' || s === 'waiting'
          return (
            <g key={a}>
              {lit && <path d={d} stroke={color} strokeWidth="10" strokeOpacity=".35" fill="none" vectorEffect="non-scaling-stroke" style={{ filter: 'blur(5px)' }} />}
              <path d={d} stroke={color} fill="none" vectorEffect="non-scaling-stroke"
                strokeWidth={lit ? 2.6 : 2} strokeOpacity={s === 'idle' ? 0.22 : lit ? 1 : 0.6} strokeDasharray={s === 'idle' ? '3 7' : undefined} />
              {s === 'active' && <path d={d} stroke="#fff" strokeOpacity=".85" strokeWidth="1.6" fill="none" vectorEffect="non-scaling-stroke" className="ray-live" />}
            </g>
          )
        })}
      </svg>
      <div className="absolute" style={{ left: 'calc(33.333% - 38px)', top: MID - 94 }}>
        <PrismMark size={88} fibers={false} className={live ? 'pulse-glow' : undefined} />
      </div>
    </div>
  )
}

function Failure({ run, retry }: { run: RunState; retry?(): void }) {
  const { outputs } = useData()
  const gone = run.error?.code === 'not_found'
  const precomputed = !!run.caseId && outputs.some((o) => o.case_id === run.caseId)
  return (
    <div className="glass mx-auto mt-6 max-w-2xl border-bad/40 px-6 py-5" role="alert">
      <p className="flex items-center gap-2 text-[17px] font-bold text-bad"><CircleX size={20} aria-hidden /> {gone ? 'This run is no longer available' : 'The run stopped'}</p>
      <p className="mt-1.5">{run.error?.message ?? 'The run finished without an answer.'} {run.error?.code && <code className="font-mono text-[13px] text-ink-3">{run.error.code}</code>}</p>
      <p className="mt-1 text-[14px] text-ink-3">{gone ? 'Start a new assessment, or open a precomputed report.' : 'If the server was asleep, trying again usually works.'}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {retry && !gone && <button type="button" className="btn btn-primary rounded-full" onClick={retry}><RotateCcw size={16} aria-hidden /> Try again</button>}
        {precomputed && <Link to={`/reports/${run.caseId}`} className="btn btn-secondary rounded-full">Open the precomputed report for {run.caseId}</Link>}
      </div>
    </div>
  )
}

/** The live run: enquiry beam, prism, four agent rays, and the clarifier's questions when they arrive. */
export function Dispersion({ run, retry }: { run: RunState; retry?(): void }) {
  const { cases } = useData()
  const running = run.phase === 'starting' || run.phase === 'running' || run.phase === 'awaiting_clarification'
  const now = useNow(running)
  const elapsed = run.startedAt ? (run.endedAt ?? now) - run.startedAt : 0
  const c = run.clarification
  const asking = run.phase === 'awaiting_clarification' && !!c && !run.rounds.some((r) => r.round === c.round)
  const title = run.caseId ? cases.find((x) => x.case_id === run.caseId)?.title : undefined
  const followUp = !!run.message && run.message !== run.enquiry
  const tone = run.active ? AGENTS[run.active].color : 'var(--ink)'
  const deck = useRef<HTMLDivElement>(null)
  const toDeck = () => deck.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  // The questions need the user, so bring them into view when they arrive.
  useEffect(() => { if (asking) toDeck() }, [asking, c?.round])

  const headline =
    run.restoring ? 'Reconnecting to the run'
    : run.phase === 'starting' ? 'Waking the agents'
    : asking ? 'The clarifier has questions for you'
    : run.phase === 'failed' ? 'The run stopped'
    : run.active ? `${AGENTS[run.active].label} ${AGENTS[run.active].doing}`
    : 'Assessing the enquiry'
  const note =
    run.phase === 'starting' ? 'A sleeping server can take up to a minute to wake.'
    : run.link === 'reconnecting' ? 'Connection dropped, reconnecting…'
    : run.link === 'polling' ? 'Live trace unavailable, checking the run every 5 s.'
    : running && elapsed > 5 * 60_000 ? 'Taking longer than expected, still listening.'
    : running ? 'Runs usually take 1–3 minutes.' : ''

  return (
    <div className="@container">
      <div className="text-center">
        <p className="tile-title">Assessment in progress</p>
        <p className={cn('display mt-1.5 text-[clamp(1.4rem,2.6vw,2.1rem)] leading-tight', running && 'shimmer-text')} style={{ color: tone, ['--shimmer' as string]: tone }} role="status">
          {headline}
        </p>
        <p className="mt-1.5 text-[14px] text-ink-3"><RollingClock ms={elapsed} />{note && <span>. {note}</span>}</p>
      </div>

      <div className="mt-8 grid items-center gap-5 @xl:grid-cols-[minmax(10rem,1fr)_minmax(6rem,0.75fr)_minmax(15rem,1.3fr)] @xl:gap-0">
        <div className="glass p-5">
          <p className="tile-title">{followUp ? 'Follow-up' : 'Customer enquiry'}</p>
          {!followUp && run.caseId && <p className="mt-1 text-[13px] font-bold text-cyan">{run.caseId}{title ? ` – ${title}` : ''}</p>}
          <p className="mt-2 max-h-[18rem] overflow-y-auto whitespace-pre-wrap text-[15px] leading-relaxed">{(followUp ? run.message : run.enquiry) || '…'}</p>
          <p className="mt-3 text-[13px] text-ink-3">{run.mode === 'interactive' ? 'Questions first' : 'Batch mode: no questions, assumptions recorded'}</p>
        </div>
        <Rays run={run} />
        <div className="flex justify-center @xl:hidden" aria-hidden><PrismMark size={64} live={running} className="pulse-glow" /></div>
        <ol className="grid grid-cols-1 gap-3" aria-label="Agents at work">
          {AGENT_ORDER.map((a) => <Station key={a} run={run} agent={a} onAsk={toDeck} />)}
        </ol>
      </div>

      {run.phase === 'failed' && !run.report && <Failure run={run} retry={retry} />}

      {asking && c && (
        <div ref={deck} className="mx-auto mt-8 max-w-2xl">
          <QuestionDeck key={`${run.threadId}-${c.round}`} c={c} />
        </div>
      )}
    </div>
  )
}
