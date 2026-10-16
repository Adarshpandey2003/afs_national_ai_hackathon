import type { ReactNode } from 'react'
import { CircleX, RotateCcw } from 'lucide-react'
import { useData } from '../lib/data'
import { Link } from '../lib/router'
import { useRun, type RunState } from '../lib/run'
import { Questions } from './clarify'
import { Answer } from './report'
import { Activity } from './timeline'
import { Logo } from './ui'

/** The customer's enquiry as the user's message, right-aligned like a chat bubble. */
export function UserMessage({ text, caseId }: { text: string; caseId?: string }) {
  const { cases } = useData()
  const title = caseId ? cases.find((c) => c.case_id === caseId)?.title : undefined
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-[1.4rem] rounded-br-md bg-surface-3 px-5 py-3.5">
        {caseId && <p className="mb-1 text-[12.5px] font-bold text-ink-3">{caseId}{title ? ` – ${title}` : ''}</p>}
        <p className="whitespace-pre-wrap text-[15.5px] leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

export function AssistantMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-rule bg-surface text-ink max-sm:hidden" aria-hidden>
        <Logo size={18} />
      </span>
      <div className="min-w-0 flex-1 space-y-4">{children}</div>
    </div>
  )
}

function Failure({ turn, live }: { turn: RunState; live: boolean }) {
  const run = useRun()
  const { outputs } = useData()
  const gone = turn.error?.code === 'not_found'
  const caseId = turn.caseId
  const precomputed = !!caseId && outputs.some((o) => o.case_id === caseId)
  const retry = live && !!turn.enquiry
  return (
    <div className="rounded-2xl border border-bad/35 bg-bad-bg px-5 py-4">
      <p className="flex items-center gap-2 font-bold text-bad"><CircleX size={18} aria-hidden /> {gone ? 'This run is no longer available' : 'The run stopped'}</p>
      <p className="mt-1.5 text-[15px]">
        {turn.error?.message ?? 'Something went wrong.'} {turn.error?.code && <code className="font-mono text-[12.5px] text-ink-3">{turn.error.code}</code>}
      </p>
      <p className="mt-1 text-[13.5px] text-ink-3">{gone ? 'Start a new assessment, or open a precomputed report.' : 'If the server was asleep, trying again usually works.'}</p>
      {(retry || precomputed) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {retry && <button type="button" className="btn btn-primary rounded-full" onClick={run.retry}><RotateCcw size={16} aria-hidden /> Try again</button>}
          {precomputed && <Link to={`/reports/${caseId}`} className="btn btn-secondary rounded-full">Open the precomputed report for {caseId}</Link>}
        </div>
      )}
    </div>
  )
}

/** One assessment in the conversation: the enquiry, then the assistant's activity, questions and answer. */
export function Turn({ turn, live }: { turn: RunState; live: boolean }) {
  const writing = live && (turn.phase === 'starting' || turn.phase === 'running') && !turn.report
  return (
    <section className="space-y-6" aria-label={turn.caseId ? `Assessment ${turn.caseId}` : 'Assessment'}>
      {turn.enquiry && <UserMessage text={turn.enquiry} caseId={turn.caseId ?? turn.report?.case_id} />}
      <AssistantMessage>
        <Activity turn={turn} live={live} />
        <Questions turn={turn} live={live} />
        {turn.report ? (
          <div id={`answer-${turn.threadId}`} className="scroll-mt-4"><Answer report={turn.report} threadId={turn.threadId} /></div>
        ) : turn.phase === 'failed' ? (
          <Failure turn={turn} live={live} />
        ) : writing ? (
          <div className="space-y-3 pt-1" aria-hidden>
            {[88, 96, 70].map((w, i) => <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />)}
          </div>
        ) : null}
      </AssistantMessage>
    </section>
  )
}
