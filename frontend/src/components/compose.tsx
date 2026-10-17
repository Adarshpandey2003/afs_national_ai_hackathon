import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ArrowUp, BookOpenText, Check } from 'lucide-react'
import type { Mode } from '../api/types'
import { useData } from '../lib/data'
import { PrismMark } from './brand'
import { LightRays, useRotate } from './motion'
import { cn } from './ui'

export interface Draft { text: string; caseId?: string; mode: Mode }

/** All 14 scenarios, opening downwards from the input. */
function Examples({ onPick }: { onPick(text: string, caseId: string): void }) {
  const { cases } = useData()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('mousedown', away)
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('mousedown', away)
      removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={wrap} className="relative">
      <button
        type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-semibold text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <BookOpenText size={16} aria-hidden /> Examples
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-2 max-h-[min(26rem,55vh)] w-[min(27rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-rule bg-surface p-2 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)]">
          {(['eval', 'dev'] as const).map((set) => (
            <div key={set} role="group" aria-label={set === 'eval' ? 'Final evaluation' : 'Development'}>
              <p className="px-3 pb-1 pt-2 text-[13px] font-bold text-ink-3">{set === 'eval' ? 'Final evaluation' : 'Development'}</p>
              {cases.filter((c) => c.set === set).map((c) => (
                <button
                  key={c.case_id} type="button" role="menuitem"
                  onClick={() => { onPick(c.text, c.case_id); setOpen(false) }}
                  className="flex w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-surface-2"
                >
                  <span className="w-8 shrink-0 font-bold text-cyan">{c.case_id}</span>
                  <span className="leading-snug">{c.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The input with the questions-first switch and the send button: on the landing page and below an answer for follow-ups. */
export function PromptBox({ draft, setDraft, onSend, label, placeholder, note, blocked, tooShort, examples = false, counter = false, rows = 3, boxRef, beam = 'focus', hints }: {
  draft: Draft; setDraft(d: Draft): void; onSend(): void; label: string; placeholder: string; note: string
  /** A light runs around the box: always, or only while typing (Magic UI Border Beam). */
  beam?: 'always' | 'focus'
  /** Example ideas cycling under the placeholder while the box is empty (Magic UI Word Rotate). */
  hints?: string[]
  /** Shown at once and stops sending, e.g. too long. */
  blocked: string
  /** Shown after a send attempt. */
  tooShort: string
  examples?: boolean; counter?: boolean; rows?: number; boxRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const id = useId()
  const own = useRef<HTMLTextAreaElement>(null)
  const box = boxRef ?? own
  const [tried, setTried] = useState(false)
  const { item: example, i: exampleAt } = useRotate(hints ?? [])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = ''
    // Chromium counts the placeholder in scrollHeight, so only grow once there is text.
    if (draft.text) el.style.height = `${Math.min(Math.max(el.scrollHeight, rows * 32), 280)}px`
  }, [draft.text, box, rows])

  const send = () => {
    setTried(true)
    if (blocked || tooShort) return
    setTried(false)
    onSend()
  }
  const hint = blocked || (tried ? tooShort : '')

  return (
    <>
      <form className={cn('fiber-border glow-input w-full rounded-[1.75rem]', beam === 'always' ? 'border-beam' : 'border-beam-focus')} onSubmit={(e) => { e.preventDefault(); send() }}>
        <label htmlFor={id} className="sr-only">{label}</label>
        {hints && !draft.text && (
          <div aria-hidden className="pointer-events-none absolute inset-x-6 top-5 text-[16px] leading-relaxed text-ink-3">
            {placeholder}
            <span key={exampleAt} className="blur-in block truncate opacity-75">For example: {example}</span>
          </div>
        )}
        <textarea
          id={id} ref={box} value={draft.text} rows={rows} placeholder={hints ? undefined : placeholder}
          onChange={(e) => setDraft({ ...draft, text: e.target.value, caseId: undefined })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className="block w-full resize-none bg-transparent px-6 pb-2 pt-5 text-[16px] leading-relaxed outline-none placeholder:text-ink-3"
        />
        <div className="flex items-center gap-1 px-3 pb-3">
          {examples && <Examples onPick={(text, caseId) => { setDraft({ ...draft, text, caseId }); box.current?.focus() }} />}
          <button
            type="button" role="switch" aria-checked={draft.mode === 'interactive'} aria-label="Ask questions first"
            onClick={() => setDraft({ ...draft, mode: draft.mode === 'interactive' ? 'batch' : 'interactive' })}
            title={draft.mode === 'interactive' ? 'On: the assistant pauses to ask you questions first.' : 'Off: no questions; unknowns become explicit assumptions (batch mode).'}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[14px] font-semibold transition-colors',
              draft.mode === 'interactive' ? 'border-clarifier/45 bg-clarifier/10 text-clarifier' : 'border-rule text-ink-3 hover:text-ink',
            )}
          >
            <span className={cn('grid size-4 place-items-center rounded-full border', draft.mode === 'interactive' ? 'border-clarifier bg-clarifier text-surface' : 'border-ink-3')}>
              {draft.mode === 'interactive' && <Check size={11} strokeWidth={3} aria-hidden />}
            </span>
            Ask questions first
          </button>
          <div className="ml-auto flex items-center gap-2">
            {counter && draft.text.length >= 3000 && <span className={cn('text-[13px] tabular-nums', blocked ? 'font-bold text-bad' : 'text-ink-3')}>{draft.text.length} / 4000</span>}
            <button
              type="submit" aria-label={examples ? 'Assess enquiry' : 'Send'} disabled={!draft.text.trim() || !!blocked}
              className="grid size-11 place-items-center rounded-full bg-prism text-white shadow-[0_0_24px_-4px_var(--prism)] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none disabled:hover:scale-100"
            >
              <ArrowUp size={20} strokeWidth={2.4} aria-hidden />
            </button>
          </div>
        </div>
      </form>
      <p className={cn('mt-2.5 min-h-5 text-center text-[13px]', hint ? 'font-semibold text-bad' : 'text-ink-3')} role={hint ? 'alert' : undefined}>
        {hint || note}
      </p>
    </>
  )
}

const HINTS = [
  'moisture and hydrocarbons in soil, measured remotely',
  'API concentration in a tablet press feed frame',
  'fat and protein in an opaque milk concentrate',
  'water content in a petroleum line',
  'glucose and lactate during a cell culture run',
]

/** The landing stage: the prism, one question, one input. */
export function Compose({ draft, setDraft, onSend }: { draft: Draft; setDraft(d: Draft): void; onSend(): void }) {
  const { cases } = useData()
  const box = useRef<HTMLTextAreaElement>(null)
  const length = draft.text.trim().length

  return (
    <section className="relative isolate mx-auto flex w-full max-w-[54rem] flex-1 flex-col items-center justify-center px-4 py-10 sm:py-14">
      <LightRays />
      <PrismMark size={88} live className="pulse-glow" />
      <h1 className="display mt-5 text-center text-[clamp(1.75rem,4.4vw,3.5rem)] leading-[1.03] tracking-[-0.02em]">
        From customer enquiry<br />to first experiment
      </h1>
      <p className="mt-4 max-w-[58ch] text-center text-[17px] leading-relaxed text-ink-2">
        Describe what the customer needs to monitor. Four agents read it against the AFS knowledge base and return the method, the light path and the first test, with every claim sourced.
      </p>

      <div className="mt-9 w-full">
        <PromptBox
          boxRef={box} draft={draft} setDraft={setDraft} onSend={onSend} examples counter beam="always" hints={HINTS}
          label="Customer enquiry" placeholder="What does the customer need to monitor?"
          note="Enter to assess, Shift + Enter for a new line"
          blocked={draft.text.length > 4000 ? 'Shorten the enquiry to 4000 characters.' : ''}
          tooShort={length < 20 ? 'Add a little more detail: at least 20 characters.' : ''}
        />
      </div>

      <div className="mt-6 w-full">
        <p className="text-center text-[13px] font-bold text-ink-3">Try an evaluation enquiry</p>
        <ul className="mt-3 flex flex-wrap justify-center gap-2">
          {cases.filter((c) => c.set === 'eval').map((c) => (
            <li key={c.case_id}>
              <button
                type="button" onClick={() => { setDraft({ ...draft, text: c.text, caseId: c.case_id }); box.current?.focus() }}
                className="flex items-center gap-2 rounded-full border border-rule bg-surface/60 px-3.5 py-2 text-[14px] backdrop-blur transition-colors hover:border-cyan/60 hover:text-ink"
              >
                <span className="font-bold text-cyan">{c.case_id}</span>
                <span className="max-w-[19rem] truncate text-ink-2">{c.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
