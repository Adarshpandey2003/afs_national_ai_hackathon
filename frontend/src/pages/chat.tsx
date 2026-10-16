import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Case } from '../api/types'
import { Turn } from '../components/chat'
import { Composer, type Draft } from '../components/composer'
import { Logo } from '../components/ui'
import { useData } from '../lib/data'
import { useRun } from '../lib/run'
import { draftStore } from '../lib/ui-state'

function Welcome({ composer, onPick }: { composer: ReactNode; onPick(c: Case): void }) {
  const { cases } = useData()
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[48rem] flex-col justify-center px-4 py-10">
        <div className="text-center">
          <Logo size={46} className="mx-auto text-ink" />
          <h1 className="display mt-5 text-[clamp(1.7rem,3.2vw,2.4rem)] leading-tight">What does the customer need to monitor?</h1>
          <p className="mx-auto mt-3 max-w-[54ch] text-[16px] leading-relaxed text-ink-2">
            Paste their enquiry. You get the questions to ask, the methods worth testing and a first experiment, each tied to a page in the AFS materials.
          </p>
        </div>
        <div className="mt-8">{composer}</div>
        <p className="mb-3 mt-8 text-center text-[13px] font-semibold text-ink-3">Or start from an evaluation enquiry</p>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {cases.filter((c) => c.set === 'eval').map((c) => (
            <li key={c.case_id}>
              <button
                type="button" onClick={() => onPick(c)}
                className="h-full w-full rounded-2xl border border-rule bg-surface px-4 py-3 text-left transition-colors hover:border-ink-3 hover:bg-surface-2"
              >
                <span className="text-[12px] font-bold text-ink-3">{c.case_id}</span>
                <span className="mt-0.5 block text-[14.5px] font-semibold leading-snug">{c.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function ChatPage() {
  const run = useRun()
  const [draft, setDraft] = useState<Draft>({ text: '', mode: 'interactive' })
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // "Run this enquiry live" from a precomputed report lands here with the text ready to send.
  useEffect(() => {
    const pre = draftStore.get()
    if (!pre) return
    draftStore.set(null)
    setDraft((d) => ({ ...d, ...pre }))
  }, [])

  const live = run.phase !== 'idle'
  const empty = !live && !run.turns.length
  const state = run.phase === 'starting' || run.phase === 'running' ? 'busy'
    : run.phase === 'awaiting_clarification' ? 'asking'
    : empty ? 'ready' : 'after'

  // Stay at the bottom while the assistant works, unless the reader scrolls up.
  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const onScroll = () => { pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }
    el.addEventListener('scroll', onScroll)
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight })
    ro.observe(inner)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [empty])

  // When questions or the report land, show their beginning rather than jumping to their end.
  const landed = run.report ? `answer-${run.threadId}` : run.phase === 'awaiting_clarification' ? 'asking' : undefined
  const round = run.clarification?.round
  useLayoutEffect(() => {
    if (!landed) return
    pinned.current = false
    requestAnimationFrame(() => document.getElementById(landed)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [landed, round])

  // After answering, follow the agents again.
  const previous = useRef(run.phase)
  useEffect(() => {
    if (previous.current === 'awaiting_clarification' && run.phase === 'running') {
      pinned.current = true
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
    }
    previous.current = run.phase
  }, [run.phase])

  const send = () => {
    pinned.current = true
    run.start(draft.text.trim(), draft.mode, draft.caseId)
    setDraft({ ...draft, text: '', caseId: undefined })
  }
  const composer = <Composer draft={draft} setDraft={setDraft} onSend={send} state={state} large={empty} />

  if (empty) {
    return (
      <Welcome
        composer={composer}
        onPick={(c) => { setDraft({ ...draft, text: c.text, caseId: c.case_id }); document.getElementById('composer')?.focus() }}
      />
    )
  }

  return (
    <div className="print-full flex h-full flex-col">
      <div ref={scroller} className="print-full min-h-0 flex-1 overflow-y-auto">
        <div ref={content} className="mx-auto w-full max-w-[48rem] space-y-12 px-4 pb-10 pt-4">
          {run.turns.map((t, i) => <Turn key={t.threadId ?? `turn-${i}`} turn={t} live={false} />)}
          {live && <Turn turn={run} live />}
        </div>
      </div>
      <div className="no-print shrink-0 px-4 pb-3 pt-1">{composer}</div>
    </div>
  )
}
