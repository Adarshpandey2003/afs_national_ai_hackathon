import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, MOCK } from '../api'
import type {
  AgentName, AgentStep, Answer, AssessmentSnapshot, ClarificationNeeded, CriticIssue, DecisionStatus, Mode, Question, Report, RunEvent,
} from '../api/types'
import { setQueryParam } from './router'
import { createStore } from './store'

// Client state machine from frontend.md §5:
// idle → starting → running ⇄ awaiting_clarification → completed | failed

export type Phase = 'idle' | 'starting' | 'running' | 'awaiting_clarification' | 'completed' | 'failed'
export type LinkState = 'idle' | 'live' | 'reconnecting' | 'polling'

export type Entry = { id: number; at: number } & (
  | { kind: 'step'; step: AgentStep }
  | { kind: 'clarify'; count: number; round: number }
  | { kind: 'draft'; revision: number }
  | { kind: 'critic'; revision: number; passed: boolean; issues: CriticIssue[] }
  | { kind: 'error'; code: string; message: string }
)
export interface Group { id: number; agent: AgentName; round?: number; revision?: number; at: number; entries: Entry[] }
export type Clarification = Pick<ClarificationNeeded, 'round' | 'max_rounds' | 'questions'> & Partial<ClarificationNeeded>
/** A clarification round the user already answered (or skipped with assumptions). */
export interface AnsweredRound { round: number; questions: Question[]; answers: Answer[]; proceeded: boolean }

export interface RunState {
  phase: Phase
  threadId?: string
  enquiry: string
  mode: Mode
  caseId?: string
  groups: Group[]
  active?: AgentName
  seq: number
  clarification?: Clarification
  rounds: AnsweredRound[]
  pending?: Omit<AnsweredRound, 'round' | 'questions'>
  report?: Report
  error?: { code: string; message: string }
  startedAt?: number
  endedAt?: number
  link: LinkState
  submitting: boolean
  answerError?: string
  restoring: boolean
  traceLost: boolean
}

const initial: RunState = {
  phase: 'idle', enquiry: '', mode: 'interactive', groups: [], seq: 0, link: 'idle', rounds: [],
  submitting: false, restoring: false, traceLost: false,
}

type Action =
  | { type: 'start'; enquiry: string; mode: Mode; caseId?: string; restoring?: boolean }
  | { type: 'started'; threadId: string }
  | { type: 'event'; ev: RunEvent; at: number }
  | { type: 'snapshot'; snap: AssessmentSnapshot; restored?: boolean }
  | { type: 'fail'; code: string; message: string }
  | { type: 'link'; link: LinkState }
  | { type: 'submitting'; answers: Answer[]; proceeded: boolean }
  | { type: 'answered'; round: number }
  | { type: 'answerError'; message: string }
  | { type: 'reset' }

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'id' | 'at'> : never) : never

function addEntry(s: RunState, agent: AgentName | undefined, at: number, entry: NewEntry): RunState {
  const groups = [...s.groups]
  let i = agent ? groups.findLastIndex((g) => g.agent === agent) : groups.length - 1
  let seq = s.seq
  if (i < 0) {
    if (!agent) return s
    groups.push({ id: seq++, agent, at, entries: [] })
    i = groups.length - 1
  }
  groups[i] = { ...groups[i], entries: [...groups[i].entries, { ...entry, id: seq++, at } as Entry] }
  return { ...s, groups, seq }
}

const finished = (status: string) => status === 'completed' || status === 'failed'

function applyEvent(s: RunState, ev: RunEvent, at: number): RunState {
  switch (ev.type) {
    case 'status':
      return { ...s, phase: ev.data.status, active: finished(ev.data.status) ? undefined : ev.data.agent ?? s.active }
    case 'agent_start': {
      const { agent, round, revision } = ev.data
      return { ...s, active: agent, groups: [...s.groups, { id: s.seq, agent, round, revision, at, entries: [] }], seq: s.seq + 1 }
    }
    case 'agent_step':
      return addEntry(s, ev.data.agent, at, { kind: 'step', step: ev.data })
    case 'clarification_needed':
      return {
        ...addEntry(s, 'clarifier', at, { kind: 'clarify', count: ev.data.questions.length, round: ev.data.round }),
        clarification: ev.data, phase: 'awaiting_clarification', active: 'clarifier',
      }
    case 'draft_ready':
      return addEntry(s, 'writer', at, { kind: 'draft', revision: ev.data.revision })
    case 'critic_result':
      return addEntry(s, 'critic', at, { kind: 'critic', ...ev.data })
    case 'report':
      return { ...s, report: ev.data.report }
    case 'error':
      return { ...addEntry(s, s.active, at, { kind: 'error', ...ev.data }), error: ev.data, phase: 'failed', active: undefined }
    case 'done':
      return { ...s, phase: ev.data.status, active: undefined, endedAt: at, link: 'idle' }
  }
}

function reducer(s: RunState, a: Action): RunState {
  switch (a.type) {
    case 'start':
      return { ...initial, phase: 'starting', enquiry: a.enquiry, mode: a.mode, caseId: a.caseId, startedAt: Date.now(), restoring: !!a.restoring }
    case 'started':
      return { ...s, phase: 'running', threadId: a.threadId }
    case 'event':
      return applyEvent(s, a.ev, a.at)
    case 'snapshot': {
      const { snap } = a
      const done = finished(snap.status)
      return {
        ...s,
        threadId: snap.thread_id,
        enquiry: snap.enquiry || s.enquiry,
        mode: snap.mode ?? s.mode,
        phase: snap.status,
        clarification: snap.clarification ? { ...s.clarification, ...snap.clarification } : s.clarification,
        report: snap.report ?? s.report,
        error: snap.error ?? s.error,
        endedAt: done ? s.endedAt ?? Date.now() : s.endedAt,
        restoring: false,
        traceLost: a.restored ? done : s.traceLost,
      }
    }
    case 'fail':
      return { ...s, phase: 'failed', error: { code: a.code, message: a.message }, endedAt: Date.now(), active: undefined, link: 'idle', restoring: false }
    case 'link':
      return { ...s, link: a.link }
    case 'submitting':
      return { ...s, submitting: true, answerError: undefined, pending: { answers: a.answers, proceeded: a.proceeded } }
    case 'answered': {
      const asked = s.clarification
      const rounds = asked && s.pending ? [...s.rounds, { round: asked.round, questions: asked.questions, ...s.pending }] : s.rounds
      // A new clarification round may already have arrived on the stream; don't override it.
      const phase = s.phase === 'awaiting_clarification' && asked?.round === a.round ? 'running' : s.phase
      return { ...s, submitting: false, pending: undefined, rounds, phase }
    }
    case 'answerError':
      return { ...s, submitting: false, answerError: a.message }
    case 'reset':
      return initial
  }
}

const errorInfo = (e: unknown) =>
  e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'unknown', message: e instanceof Error ? e.message : String(e) }

/* ── Recent runs (sidebar). Kept in localStorage for the real backend; mock runs only live in this tab. ── */

export interface Recent { threadId: string; enquiry: string; caseId?: string; at: number; status?: DecisionStatus | 'failed' }

const RECENTS_KEY = 'recent-runs'
const readRecents = (): Recent[] => {
  if (MOCK) return []
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
export const recents = createStore<Recent[]>(readRecents())

function saveRecent(r: Recent) {
  const next = [r, ...recents.get().filter((x) => x.threadId !== r.threadId)].slice(0, 15)
  recents.set(next)
  if (MOCK) return
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch { /* storage unavailable: the list lasts for this tab */ }
}

export interface Run extends RunState {
  /** Earlier assessments in this conversation, oldest first. */
  turns: RunState[]
  start(enquiry: string, mode: Mode, caseId?: string): void
  submit(answers: Answer[], proceed: boolean): void
  retry(): void
  /** Start a new, empty conversation. */
  reset(): void
  /** Show a run the server still has (from the URL or the recent list). */
  open(threadId: string): void
}

const Ctx = createContext<Run | null>(null)

export function RunProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [turns, setTurns] = useState<RunState[]>([])
  const latest = useRef(state)
  latest.current = state
  const token = useRef(0)
  const unsubscribe = useRef<() => void>(() => {})
  const poller = useRef<number | undefined>(undefined)

  const close = useCallback(() => {
    unsubscribe.current()
    unsubscribe.current = () => {}
    clearInterval(poller.current)
  }, [])

  // frontend.md §5: after 3 failed reconnects, poll the snapshot every 5 s.
  const poll = useCallback((threadId: string) => {
    dispatch({ type: 'link', link: 'polling' })
    clearInterval(poller.current)
    poller.current = window.setInterval(async () => {
      try {
        const snap = await api.snapshot(threadId)
        dispatch({ type: 'snapshot', snap })
        if (finished(snap.status)) {
          clearInterval(poller.current)
          dispatch({ type: 'link', link: 'idle' })
        }
      } catch { /* keep polling */ }
    }, 5000)
  }, [])

  const listen = useCallback((threadId: string) => {
    close()
    unsubscribe.current = api.subscribe(
      threadId,
      (ev) => {
        dispatch({ type: 'event', ev, at: Date.now() })
        if (ev.type === 'done') close()
      },
      (failures, closedByBrowser) => {
        if (failures === 0) return dispatch({ type: 'link', link: 'live' })
        if (failures < 3 && !closedByBrowser) return dispatch({ type: 'link', link: 'reconnecting' })
        unsubscribe.current()
        unsubscribe.current = () => {}
        poll(threadId)
      },
    )
  }, [close, poll])

  const launch = useCallback(async (enquiry: string, mode: Mode, caseId: string | undefined, keepCurrent: boolean) => {
    close()
    const previous = latest.current
    // A finished assessment stays in the conversation above the new one.
    if (keepCurrent && previous.phase !== 'idle' && !previous.restoring) setTurns((t) => [...t, previous])
    const mine = ++token.current
    dispatch({ type: 'start', enquiry, mode, caseId })
    try {
      const r = await api.startAssessment({ enquiry, mode, ...(caseId ? { case_id: caseId } : {}) })
      if (mine !== token.current) return
      dispatch({ type: 'started', threadId: r.thread_id })
      setQueryParam('thread', r.thread_id)
      listen(r.thread_id)
    } catch (e) {
      if (mine === token.current) dispatch({ type: 'fail', ...errorInfo(e) })
    }
  }, [close, listen])

  const start = useCallback((enquiry: string, mode: Mode, caseId?: string) => void launch(enquiry, mode, caseId, true), [launch])

  // Retrying replaces the failed attempt instead of stacking it in the conversation.
  const retry = useCallback(() => {
    const { enquiry, mode, caseId } = latest.current
    void launch(enquiry, mode, caseId, false)
  }, [launch])

  const submit = useCallback(async (answers: Answer[], proceed: boolean) => {
    const { threadId, clarification } = latest.current
    if (!threadId) return
    dispatch({ type: 'submitting', answers, proceeded: proceed })
    try {
      await api.answer(threadId, { answers, proceed_with_assumptions: proceed })
      dispatch({ type: 'answered', round: clarification?.round ?? 0 })
    } catch (e) {
      dispatch({ type: 'answerError', message: errorInfo(e).message })
    }
  }, [])

  const reset = useCallback(() => {
    close()
    token.current++
    setTurns([])
    dispatch({ type: 'reset' })
    setQueryParam('thread', null)
  }, [close])

  const open = useCallback((id: string) => {
    close()
    const mine = ++token.current
    setTurns([])
    setQueryParam('thread', id)
    dispatch({ type: 'start', enquiry: '', mode: 'interactive', restoring: true })
    api.snapshot(id).then(
      (snap) => {
        if (mine !== token.current) return
        dispatch({ type: 'snapshot', snap, restored: true })
        if (!finished(snap.status)) listen(id)
      },
      (e) => {
        if (mine !== token.current) return
        dispatch({ type: 'fail', ...errorInfo(e) })
        setQueryParam('thread', null)
      },
    )
  }, [close, listen])

  // Restore a run from ?thread=… after a reload (frontend.md §5).
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('thread')
    if (id) open(id)
    return close
  }, [open, close])

  // Keep the sidebar's recent list in step with the active run.
  const { threadId, enquiry, caseId, startedAt, report, phase } = state
  useEffect(() => {
    if (!threadId || !enquiry) return
    saveRecent({
      threadId, enquiry, caseId: caseId ?? report?.case_id, at: startedAt ?? Date.now(),
      status: report?.decision_status ?? (phase === 'failed' ? 'failed' : undefined),
    })
  }, [threadId, enquiry, caseId, startedAt, report, phase])

  const value = useMemo<Run>(
    () => ({ ...state, turns, start, submit, retry, reset, open }),
    [state, turns, start, submit, retry, reset, open],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRun() {
  const run = useContext(Ctx)
  if (!run) throw new Error('useRun needs <RunProvider>')
  return run
}
