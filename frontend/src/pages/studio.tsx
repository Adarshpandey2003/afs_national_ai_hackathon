import { useEffect, useRef, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { AgentLog } from '../components/agent-log'
import { Answer } from '../components/answer'
import { Dispersion } from '../components/dispersion'
import { Compose, PromptBox, type Draft } from '../components/compose'
import { RichText, StatusBadge, cn } from '../components/ui'
import { useRun, withContext, type RunState } from '../lib/run'
import { draftStore } from '../lib/ui-state'

/** What the user asked, as a chat bubble. */
function Bubble({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  const long = text.length > 280
  return (
    <div className="glow-bubble ml-auto w-fit max-w-[min(46rem,92%)] rounded-[1.25rem] rounded-tr-md border border-rule bg-surface-2 px-4 py-3">
      <p className={cn('whitespace-pre-wrap text-[15px] leading-relaxed', long && !full && 'line-clamp-3')}>{text}</p>
      {long && (
        <button type="button" className="mt-1 text-[13px] font-semibold text-ink-3 hover:text-ink" onClick={() => setFull(!full)}>
          {full ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
}

/** An earlier answer in the chat, folded to its verdict until opened. */
function Earlier({ turn, label, onLog }: { turn: RunState; label?: string; onLog(): void }) {
  const [open, setOpen] = useState(false)
  const r = turn.report
  if (open) return (
    <div>
      <Answer run={turn} caseLabel={label} />
      <button type="button" className="btn btn-quiet mt-2 text-[13px]" onClick={() => setOpen(false)}>Fold this answer</button>
    </div>
  )
  return (
    <div className="glass glow-card px-5 py-4">
      {r ? <StatusBadge status={r.decision_status} /> : <p className="text-[13px] font-bold text-bad">This question stopped without an answer</p>}
      {r?.summary && <p className="mt-1.5 line-clamp-2 text-[15px] leading-snug text-ink-2"><RichText text={r.summary} /></p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {r && <button type="button" className="btn btn-secondary rounded-full py-1.5 text-[13px]" onClick={() => setOpen(true)}>Show the answer</button>}
        <button type="button" className="btn btn-quiet text-[13px]" onClick={onLog}><ScrollText size={15} aria-hidden /> Its agent log</button>
      </div>
    </div>
  )
}

/** The main stage: compose an enquiry, then a chat of questions, each with its answer and the agent log beside it. */
export function StudioPage() {
  const run = useRun()
  const [draft, setDraft] = useState<Draft>({ text: '', mode: 'interactive' })
  const [more, setMore] = useState<Draft>({ text: '', mode: 'interactive' })
  const [picked, setPicked] = useState<number | null>(null)
  const last = useRef<HTMLElement>(null)

  // "Run this enquiry live" from a precomputed report arrives with the text ready.
  useEffect(() => {
    const pre = draftStore.get()
    if (!pre) return
    draftStore.set(null)
    setDraft((d) => ({ ...d, ...pre }))
  }, [])

  const composing = run.phase === 'idle'
  useEffect(() => { scrollTo({ top: 0 }) }, [composing])

  const all: RunState[] = [...run.turns, run]
  const count = all.length
  const at = Math.min(picked ?? count - 1, count - 1)

  // A new question shows its own log and scrolls into view.
  useEffect(() => {
    setPicked(null)
    if (count > 1) last.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [count, run.chatId])

  // When the answer replaces the prism, bring its top into view (the user may have scrolled down to the questions).
  const answered = !!run.report
  useEffect(() => { if (answered) last.current?.scrollIntoView({ block: 'start' }) }, [answered])

  if (composing) {
    // The input starts empty again for the next new assessment.
    const send = () => {
      run.start(draft.text.trim(), draft.mode, draft.caseId)
      setDraft({ text: '', mode: draft.mode })
    }
    return <Compose draft={draft} setDraft={setDraft} onSend={send} />
  }

  // A run that failed before we knew its enquiry (e.g. not found after a reload) has nothing to follow up on.
  const done = run.phase === 'completed' || (run.phase === 'failed' && !!run.enquiry)
  const text = more.text.trim()
  const tooLong = !!text && withContext(all, text).length > 4000

  return (
    <div className="grid w-full flex-1 lg:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="chat-glow min-w-0 px-4 pb-14 pt-5 sm:px-6 lg:px-8 lg:pt-8">
        <div className="mx-auto max-w-[84rem] space-y-5">
          {all.map((t, i) => {
            const latest = i === count - 1
            const label = i ? `Answer to question ${i + 1}` : ''
            // While the agents work, the question shows as light through the prism; the answer takes its place.
            if (latest && !run.report) return (
              <section key={t.threadId ?? `q${i}`} ref={last} className="scroll-mt-20" aria-label={`Question ${i + 1}`}>
                <Dispersion run={run} retry={run.retry} />
              </section>
            )
            return (
              <section key={t.threadId ?? `q${i}`} ref={latest ? last : undefined} className="mx-auto max-w-[62rem] scroll-mt-20 space-y-4" aria-label={`Question ${i + 1}`}>
                {(t.message || t.enquiry) && <Bubble text={t.message || t.enquiry} />}
                {latest
                  ? <Answer run={run} caseLabel={label || undefined} />
                  : <Earlier turn={t} label={label || undefined} onLog={() => setPicked(i)} />}
              </section>
            )
          })}

          {done && (
            <div className="mx-auto max-w-[62rem] pt-4">
              <PromptBox
                draft={more} setDraft={setMore} rows={2}
                onSend={() => { run.ask(text, more.mode); setMore({ ...more, text: '' }) }}
                label="Follow-up" placeholder="Ask more about this case, or add what the customer told you…"
                note="The agents re-assess the case with everything in this chat. For another customer, start a new assessment."
                blocked={tooLong ? 'This chat is too long to send as one enquiry. Start a new assessment for more questions.' : ''}
                tooShort={text.length < 2 ? 'Type a question or what the customer told you.' : ''}
              />
            </div>
          )}
        </div>
      </div>
      <AgentLog key={`${run.chatId}-${at}`} run={all[at]} turns={count} at={at} onPick={setPicked} />
    </div>
  )
}
