import { useState } from 'react'
import { ChevronDown, CircleCheck, LoaderCircle } from 'lucide-react'
import { useRun, type AnsweredRound, type Clarification, type RunState } from '../lib/run'
import { AffectsTag, ClaimList, PriorityTag, RichText } from './ui'

/** A round the user already answered, folded into one line like a sent reply. */
function AnsweredBlock({ r }: { r: AnsweredRound }) {
  const byId = new Map(r.answers.map((a) => [a.question_id, a.answer]))
  const n = r.answers.length
  const label = n
    ? `You answered ${n} of ${r.questions.length} question${r.questions.length === 1 ? '' : 's'}${r.proceeded ? ' and asked to proceed' : ''}`
    : 'You chose to proceed with assumptions'
  return (
    <details className="group rounded-2xl border border-rule">
      <summary className="flex items-center gap-2 px-4 py-3 text-[14px] font-semibold">
        <CircleCheck size={16} className="shrink-0 text-ok" aria-hidden />
        {label}
        {r.round > 1 && <span className="font-normal text-ink-3">(round {r.round})</span>}
        <ChevronDown size={16} aria-hidden className="ml-auto shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
      </summary>
      <ol className="space-y-3 border-t border-rule px-4 py-4">
        {[...r.questions].sort((a, b) => a.priority - b.priority).map((q) => (
          <li key={q.question_id} className="text-[14.5px]">
            <p className="font-semibold leading-snug">{q.text}</p>
            {byId.has(q.question_id)
              ? <p className="mt-1 border-l-2 border-fact pl-3 text-fact">{byId.get(q.question_id)}</p>
              : <p className="mt-1 pl-3 text-[13.5px] italic text-ink-3">Not answered: becomes an assumption</p>}
          </li>
        ))}
      </ol>
    </details>
  )
}

function AskForm({ c }: { c: Clarification }) {
  const run = useRun()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const questions = [...c.questions].sort((a, b) => a.priority - b.priority)
  const filled = questions.filter((q) => answers[q.question_id]?.trim())
  const payload = () => filled.map((q) => ({ question_id: q.question_id, answer: answers[q.question_id].trim() }))

  return (
    <section id="asking" aria-labelledby={`ask-${c.round}`} className="scroll-mt-4 rounded-2xl border border-clarifier/40 bg-surface">
      <header className="px-5 pb-2 pt-5">
        <h3 id={`ask-${c.round}`} className="text-[16.5px] font-bold leading-snug">
          {c.round > 1 ? 'A few more questions before I continue' : 'Before I assess this, a few questions'}
        </h3>
        <p className="mt-1 text-[14.5px] text-ink-2">
          Answer what you know from the customer. Anything you skip becomes an explicit assumption.
          {c.max_rounds > 1 && <span className="text-ink-3"> Round {c.round} of {c.max_rounds}.</span>}
        </p>
        {(c.stated_facts?.length || c.key_unknowns?.length) ? (
          <details className="group mt-3">
            <summary className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-ink-2 hover:text-ink">
              <ChevronDown size={15} aria-hidden className="transition-transform group-open:rotate-180" />
              What the customer stated ({c.stated_facts?.length ?? 0}) and what is unknown ({c.key_unknowns?.length ?? 0})
            </summary>
            <div className="mt-3 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="subhead">Stated by the customer</p>
                <ClaimList claims={c.stated_facts ?? []} />
              </div>
              <div>
                <p className="subhead">Key unknowns</p>
                <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-3">{(c.key_unknowns ?? []).map((u, i) => <li key={i}><RichText text={u} /></li>)}</ul>
              </div>
            </div>
          </details>
        ) : null}
      </header>

      <ol className="divide-y divide-rule">
        {questions.map((q) => (
          <li key={q.question_id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <PriorityTag p={q.priority} />
              {q.priority === 1 && <span className="text-[12.5px] font-bold text-clarifier">Recommended</span>}
              <AffectsTag affects={q.affects} />
            </div>
            <label htmlFor={`answer-${q.question_id}`} className="mt-1.5 block text-[15.5px] font-semibold leading-snug">{q.text}</label>
            {q.why_it_matters && <p className="mt-1 text-[13.5px] text-ink-3">{q.why_it_matters}</p>}
            <textarea
              id={`answer-${q.question_id}`} rows={1} className="field mt-2.5 resize-y py-2" disabled={run.submitting}
              placeholder="The customer’s answer, if known" value={answers[q.question_id] ?? ''}
              onChange={(e) => setAnswers({ ...answers, [q.question_id]: e.target.value })}
            />
          </li>
        ))}
      </ol>

      <footer className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-rule px-5 py-4">
        <button type="button" className="btn btn-primary rounded-full" disabled={!filled.length || run.submitting} onClick={() => run.submit(payload(), false)}>
          {run.submitting && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
          {filled.length ? `Send ${filled.length} answer${filled.length === 1 ? '' : 's'}` : 'Send answers'}
        </button>
        <div className="min-w-[14rem] flex-1">
          {/* Answers already typed are sent along, so proceeding never throws them away. */}
          <button type="button" className="btn btn-secondary rounded-full" disabled={run.submitting} onClick={() => run.submit(payload(), true)}>
            Proceed with assumptions
          </button>
          {c.assumptions?.length ? (
            <div className="mt-2 text-[13px] text-ink-3">
              <p>The assistant will then assume:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{c.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          ) : null}
        </div>
        {run.answerError && <p role="alert" className="w-full text-[14px] font-semibold text-bad">{run.answerError}</p>}
      </footer>
    </section>
  )
}

/** Clarification inside the conversation: earlier rounds folded, the open round as a form. */
export function Questions({ turn, live }: { turn: RunState; live: boolean }) {
  const c = turn.clarification
  const asking = live && turn.phase === 'awaiting_clarification' && c && !turn.rounds.some((r) => r.round === c.round)
  if (!turn.rounds.length && !asking) return null
  return (
    <div className="space-y-3">
      {turn.rounds.map((r) => <AnsweredBlock key={r.round} r={r} />)}
      {asking && <AskForm key={`${turn.threadId}-${c.round}`} c={c} />}
    </div>
  )
}
