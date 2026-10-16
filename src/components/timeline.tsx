import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleCheck, CircleX, FileCheck, MessageCircleQuestionMark, TriangleAlert } from 'lucide-react'
import type { AgentName, AgentStep } from '../api/types'
import { clock, useNow } from '../lib/data'
import type { Entry, Group, RunState } from '../lib/run'
import { AGENTS, AGENT_ORDER, Citations, cn } from './ui'

const busy = (t: RunState) => t.phase === 'starting' || t.phase === 'running' || t.phase === 'awaiting_clarification'

/** The light path: four agents on one fiber, with light travelling towards the next agent while it works. */
export function Pipeline({ turn, size = 'md' }: { turn: RunState; size?: 'sm' | 'md' }) {
  const started = new Set(turn.groups.map((g) => g.agent))
  const counts = turn.groups.reduce<Partial<Record<AgentName, number>>>((m, g) => ({ ...m, [g.agent]: (m[g.agent] ?? 0) + 1 }), {})
  const live = turn.phase === 'running' || turn.phase === 'starting'
  const waiting = turn.phase === 'awaiting_clarification'
  const finished = turn.phase === 'completed'
  const sm = size === 'sm'

  return (
    <ol className="flex items-center" aria-label="Agent pipeline">
      {AGENT_ORDER.map((a, i) => {
        const { Icon, label, color } = AGENTS[a]
        const active = turn.active === a && (live || waiting)
        const done = finished ? started.has(a) : started.has(a) && !active
        const next = AGENT_ORDER[i + 1]
        const fiber = next && (started.has(next) || finished) ? 'done' : active && live ? 'live' : 'pending'
        return (
          <li key={a} className="flex items-center" style={{ ['--agent' as string]: color }}>
            <span
              className={cn('relative grid place-items-center rounded-full border-2 transition-colors', sm ? 'size-6' : 'size-8', active && live && 'node-active')}
              style={{
                borderColor: active || done ? color : 'var(--rule-strong)',
                background: active ? color : 'var(--surface)',
                color: active ? 'var(--surface)' : done ? color : 'var(--ink-3)',
              }}
              title={`${label}: ${AGENTS[a].role}`}
            >
              <Icon size={sm ? 12 : 15} aria-hidden />
              {done && !sm && (
                <span className="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full border border-surface" style={{ background: color }}>
                  <Check size={9} strokeWidth={3.5} color="var(--surface)" aria-hidden />
                </span>
              )}
              {(counts[a] ?? 0) > 1 && (
                <span className="absolute -right-2 -top-1.5 rounded-full bg-ink px-1 text-[9.5px] font-bold leading-[14px] text-surface">{counts[a]}</span>
              )}
              <span className="sr-only">{label}{active ? (waiting ? ', waiting for you' : ', working') : done ? ', done' : ', not started'}</span>
            </span>
            {i < 3 && <span className={cn('fiber mx-1', sm ? 'w-3.5' : 'w-8')} data-state={fiber} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

function call(step: AgentStep) {
  const args = step.args ? Object.values(step.args).map((v) => JSON.stringify(v)).join(', ') : ''
  return `${step.tool ?? 'tool'}(${args})`
}

function EntryRow({ e }: { e: Entry }) {
  switch (e.kind) {
    case 'step': {
      const s = e.step
      if (s.step_type === 'tool_call') return (
        <div>
          <code className="inline-block max-w-full break-words rounded-md border border-rule bg-surface px-2 py-1 font-mono text-[12.5px] leading-snug text-ink">{call(s)}</code>
          {s.summary && <p className="mt-1 text-[13px] text-ink-3">{s.summary}</p>}
        </div>
      )
      if (s.step_type === 'tool_result') return (
        <details className="group">
          <summary className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-ink-2 hover:text-ink">
            <ChevronDown size={14} aria-hidden className="transition-transform group-open:rotate-180" />
            Result{s.summary ? `: ${s.summary}` : ''}
          </summary>
          {s.result_preview && (
            <p className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-rule bg-surface p-2.5 text-[13px] leading-relaxed text-ink-2">{s.result_preview}</p>
          )}
          {s.citations?.length ? <p className="mt-1.5"><Citations list={s.citations} /></p> : null}
        </details>
      )
      return (
        <p className={cn('text-[13.5px] leading-relaxed', s.step_type === 'thought' ? 'italic text-ink-2' : 'text-ink')}>
          {s.summary}
          {s.citations?.length ? <> <Citations list={s.citations} /></> : null}
        </p>
      )
    }
    case 'clarify':
      return (
        <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-clarifier">
          <MessageCircleQuestionMark size={15} aria-hidden /> Asked {e.count} question{e.count === 1 ? '' : 's'} (round {e.round})
        </p>
      )
    case 'draft':
      return <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-2"><FileCheck size={15} aria-hidden /> Draft revision {e.revision} ready</p>
    case 'critic':
      return e.passed ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-ok/35 bg-ok-bg px-3 py-2 text-[13.5px] font-bold text-ok">
          <CircleCheck size={15} aria-hidden /> Passed all checks
        </p>
      ) : (
        <div className="rounded-lg border border-bad/35 bg-bad-bg px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-bad">
            <CircleX size={15} aria-hidden /> {e.issues.length} issue{e.issues.length === 1 ? '' : 's'} found, sent back to the writer
          </p>
          <ul className="mt-2 space-y-1.5">
            {e.issues.map((i, k) => (
              <li key={k} className="text-[13px] leading-snug text-ink">
                <span className={cn('mr-1.5 rounded px-1 py-px text-[11px] font-bold', i.severity === 'error' ? 'bg-bad text-surface' : 'bg-warn-bg text-warn')}>{i.severity}</span>
                {i.message} <span className="font-mono text-[11.5px] text-ink-3">{i.check}</span>
              </li>
            ))}
          </ul>
        </div>
      )
    case 'error':
      return (
        <p className="flex items-start gap-1.5 rounded-lg border border-bad/35 bg-bad-bg px-3 py-2 text-[13.5px] text-bad">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden /> {e.message} <span className="font-mono text-[11.5px]">{e.code}</span>
        </p>
      )
  }
}

function GroupItem({ g, last, base }: { g: Group; last: boolean; base: number }) {
  const { Icon, label, color } = AGENTS[g.agent]
  return (
    <li className={cn('relative pl-10', !last && 'before:absolute before:bottom-[-1.25rem] before:left-[0.9rem] before:top-9 before:w-px before:bg-rule-strong')}>
      <span className="absolute left-0 top-0 grid size-[1.9rem] place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${color} 14%, var(--surface))`, color }}>
        <Icon size={15} aria-hidden />
      </span>
      <div className="flex items-baseline gap-2 pt-1">
        <h3 className="text-[14px] font-bold" style={{ color }}>{label}</h3>
        {g.round != null && <span className="text-[12.5px] text-ink-3">round {g.round}</span>}
        {g.revision != null && <span className="text-[12.5px] text-ink-3">revision {g.revision}</span>}
        <span className="ml-auto text-[12px] tabular-nums text-ink-3">+{clock(g.at - base)}</span>
      </div>
      {g.entries.length > 0 && <ul className="mt-2 space-y-2.5">{g.entries.map((e) => <li key={e.id}><EntryRow e={e} /></li>)}</ul>}
    </li>
  )
}

const statusLine = (t: RunState, live: boolean, elapsed: number) => {
  if (t.restoring) return 'Reconnecting to the run…'
  if (live && t.phase === 'starting') return 'Starting. A sleeping server can take up to a minute to wake.'
  if (live && t.phase === 'awaiting_clarification') return 'Waiting for your answers'
  if (live && t.link === 'reconnecting') return 'Connection dropped, reconnecting…'
  if (live && t.link === 'polling') return 'Live trace unavailable, checking every 5 s'
  if (live && t.phase === 'running') {
    if (elapsed > 5 * 60_000) return 'Taking longer than expected, still listening'
    return t.active ? `${AGENTS[t.active].label} ${AGENTS[t.active].doing}` : 'Working'
  }
  if (t.phase === 'completed') {
    const s = Math.round(elapsed / 1000)
    return `Worked for ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}`
  }
  if (t.phase === 'failed') return 'Stopped'
  return ''
}

/** Compact, Claude-style "thinking" strip above the answer: live status, expandable to the full agent trace. */
export function Activity({ turn, live }: { turn: RunState; live: boolean }) {
  const running = live && busy(turn)
  const [open, setOpen] = useState<boolean | null>(null)
  // Open while agents work; folded once the reader has questions to answer or an answer to read.
  const expanded = open ?? (running && turn.phase !== 'awaiting_clarification')
  const now = useNow(running)
  const elapsed = turn.startedAt ? (turn.endedAt ?? now) - turn.startedAt : 0
  const critic = [...turn.groups].reverse().flatMap((g) => g.entries).find((e) => e.kind === 'critic')
  const revisions = turn.groups.filter((g) => g.agent === 'writer').length
  const verdict = critic?.kind === 'critic' && !running
    ? critic.passed ? `Critic passed${revisions > 1 ? ` after ${revisions} revisions` : ''}` : 'Critic found issues'
    : ''

  // Follow new steps unless the reader scrolled up inside the trace.
  const list = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const steps = turn.groups.reduce((n, g) => n + g.entries.length + 1, 0)
  useEffect(() => {
    const el = list.current
    if (el && running && stick.current) el.scrollTop = el.scrollHeight
  }, [steps, running, expanded])

  if (!turn.groups.length && !running && !turn.traceLost) return null
  return (
    <div className="no-print overflow-hidden rounded-2xl border border-rule bg-surface-2">
      <button
        type="button" aria-expanded={expanded} onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-3/60"
      >
        <span className="max-[26rem]:hidden"><Pipeline turn={turn} size="sm" /></span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" role="status">
          {statusLine(turn, live, elapsed)}
          {verdict && <span className="font-normal text-ink-3">. {verdict}</span>}
        </span>
        {running && <span className="text-[12.5px] tabular-nums text-ink-3">{clock(elapsed)}</span>}
        <ChevronDown size={17} aria-hidden className={cn('shrink-0 text-ink-3 transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div
          ref={list} role="log" aria-label="Agent steps" className="max-h-[22rem] overflow-y-auto border-t border-rule px-4 py-4"
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          }}
        >
          {turn.traceLost ? (
            <p className="text-[14px] text-ink-3">The step-by-step trace isn’t kept after a page reload.</p>
          ) : turn.groups.length ? (
            <ol className="space-y-5">
              {turn.groups.map((g, i) => <GroupItem key={g.id} g={g} last={i === turn.groups.length - 1} base={turn.groups[0].at} />)}
            </ol>
          ) : (
            <div className="space-y-3" aria-hidden>{[70, 90, 55].map((w, i) => <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />)}</div>
          )}
        </div>
      )}
    </div>
  )
}
