import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LoaderCircle, MessageCircleQuestionMark } from 'lucide-react'
import { useRun, type Clarification } from '../lib/run'
import { AffectsTag, PriorityTag, RichText, cn } from './ui'

/** The clarifier's questions as a card deck inside the answer: one question at a time, most important first. */
export function QuestionDeck({ c }: { c: Clarification }) {
  const run = useRun()
  const questions = [...c.questions].sort((a, b) => a.priority - b.priority)
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const box = useRef<HTMLTextAreaElement>(null)
  const q = questions[at]
  const filled = questions.filter((x) => answers[x.question_id]?.trim())
  const last = at === questions.length - 1
  const payload = () => filled.map((x) => ({ question_id: x.question_id, answer: answers[x.question_id].trim() }))

  useEffect(() => { box.current?.focus({ preventScroll: true }) }, [at])

  if (!q) return null
  return (
    <section aria-labelledby="deck-title" className="mt-5 overflow-hidden rounded-[1.25rem] border border-clarifier/50 bg-surface shadow-[0_30px_80px_-40px_var(--clarifier)]">
      <header className="flex items-start gap-3.5 px-6 pt-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-clarifier/15 text-clarifier"><MessageCircleQuestionMark size={21} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 id="deck-title" className="display text-[1.35rem] leading-tight">{c.round > 1 ? 'A few more questions' : 'Before the assessment, a few questions'}</h2>
          <p className="mt-1 text-[14px] text-ink-2">
            Answer what you know from the customer. Anything you skip becomes an explicit assumption.
            {c.max_rounds > 1 && <span className="text-ink-3"> Round {c.round} of {c.max_rounds}.</span>}
          </p>
        </div>
      </header>

      <ol className="flex flex-wrap gap-1.5 px-6 pt-5" aria-label="Questions">
        {questions.map((x, k) => (
          <li key={x.question_id}>
            <button
              type="button" onClick={() => setAt(k)} aria-label={`Question ${k + 1}${answers[x.question_id]?.trim() ? ', answered' : ''}`} aria-current={k === at ? 'step' : undefined}
              className={cn('block h-1.5 w-9 rounded-full transition-colors', k === at ? 'bg-clarifier' : answers[x.question_id]?.trim() ? 'bg-clarifier/55' : 'bg-surface-3 hover:bg-rule-strong')}
            />
          </li>
        ))}
      </ol>

      <div className="min-h-[15.5rem] px-6 pb-3 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <PriorityTag p={q.priority} />
          {q.priority === 1 && <span className="text-[13px] font-bold text-clarifier">Recommended</span>}
          <AffectsTag affects={q.affects} />
          <span className="ml-auto text-[13px] tabular-nums text-ink-3">{at + 1} of {questions.length}</span>
        </div>
        <label htmlFor="deck-answer" className="mt-3 block text-[20px] font-semibold leading-snug">{q.text}</label>
        {q.why_it_matters && <p className="mt-2 text-[14px] leading-relaxed text-ink-3"><RichText text={q.why_it_matters} /></p>}
        <textarea
          id="deck-answer" ref={box} rows={2} className="field mt-4 resize-y text-[16px]" disabled={run.submitting}
          placeholder="The customer’s answer, if known" value={answers[q.question_id] ?? ''}
          onChange={(e) => setAnswers({ ...answers, [q.question_id]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (!last) setAt(at + 1)
            else if (filled.length) run.submit(payload(), false)
          }}
        />
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className="btn btn-quiet text-[14px]" disabled={at === 0} onClick={() => setAt(at - 1)}>Back</button>
          {!last && (
            <button type="button" className="btn btn-secondary ml-auto rounded-full text-[14px]" onClick={() => setAt(at + 1)}>
              {answers[q.question_id]?.trim() ? 'Next question' : 'Skip'}
            </button>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-rule bg-surface-2 px-6 py-4">
        <p className="text-[14px] text-ink-2">{filled.length} of {questions.length} answered</p>
        <div className="ml-auto flex flex-wrap gap-2">
          {/* Answers already typed are sent along, so proceeding never throws them away. */}
          <button type="button" className="btn btn-secondary rounded-full" disabled={run.submitting} onClick={() => run.submit(payload(), true)}>
            Proceed with assumptions
          </button>
          <button type="button" className="btn rounded-full bg-clarifier text-surface hover:opacity-90" disabled={!filled.length || run.submitting} onClick={() => run.submit(payload(), false)}>
            {run.submitting && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {filled.length ? `Send ${filled.length} answer${filled.length === 1 ? '' : 's'}` : 'Send answers'}
          </button>
        </div>
        {c.assumptions?.length ? (
          <details className="group w-full text-[13px] text-ink-3">
            <summary className="inline-flex items-center gap-1 font-semibold hover:text-ink">
              <ChevronDown size={14} aria-hidden className="transition-transform group-open:rotate-180" /> What the assistant assumes if you proceed
            </summary>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{c.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </details>
        ) : null}
        {run.answerError && <p role="alert" className="w-full text-[14px] font-semibold text-bad">{run.answerError}</p>}
      </footer>
    </section>
  )
}
