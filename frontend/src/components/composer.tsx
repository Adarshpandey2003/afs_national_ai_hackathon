import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, BookOpenText, Check } from 'lucide-react'
import type { Mode } from '../api/types'
import { useData } from '../lib/data'
import { cn } from './ui'

export interface Draft { text: string; caseId?: string; mode: Mode }

/** The example enquiries (H01–H06, D01–D08), opening upwards from the composer. */
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
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <BookOpenText size={16} aria-hidden /> Examples
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-30 mb-2 max-h-[min(26rem,60vh)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-rule bg-surface p-2 shadow-[0_18px_48px_-12px_rgb(10_18_36/0.35)]">
          {(['eval', 'dev'] as const).map((set) => (
            <div key={set} role="group" aria-label={set === 'eval' ? 'Final evaluation' : 'Development'}>
              <p className="px-3 pb-1 pt-2 text-[12px] font-bold text-ink-3">{set === 'eval' ? 'Final evaluation' : 'Development'}</p>
              {cases.filter((c) => c.set === set).map((c) => (
                <button
                  key={c.case_id} type="button" role="menuitem"
                  onClick={() => { onPick(c.text, c.case_id); setOpen(false) }}
                  className="flex w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-surface-2"
                >
                  <span className="w-8 shrink-0 font-bold text-ink-3">{c.case_id}</span>
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

export function Composer({ draft, setDraft, onSend, state, large = false }: {
  draft: Draft
  setDraft(d: Draft): void
  onSend(): void
  /** What the conversation is doing; the composer locks while the assistant works. */
  state: 'ready' | 'busy' | 'asking' | 'after'
  large?: boolean
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const [tried, setTried] = useState(false)
  const length = draft.text.trim().length
  const tooShort = length < 20
  const tooLong = draft.text.length > 4000
  const locked = state === 'busy' || state === 'asking'

  // Grow with the text, up to about ten lines.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
  }, [draft.text, large])

  const send = () => {
    setTried(true)
    if (locked || tooShort || tooLong) return
    setTried(false)
    onSend()
  }

  const placeholder =
    state === 'busy' ? 'Working on the assessment…'
    : state === 'asking' ? 'Answer the questions above…'
    : state === 'after' ? 'Describe another enquiry…'
    : 'Describe what the customer needs to monitor…'

  const hint = tooLong ? 'Shorten the enquiry to 4000 characters.' : tried && tooShort ? 'Add a little more detail: at least 20 characters.' : ''

  return (
    <form
      className="mx-auto w-full max-w-[48rem]"
      onSubmit={(e) => { e.preventDefault(); send() }}
    >
      <div className={cn(
        'rounded-[1.6rem] border bg-surface shadow-[0_10px_34px_-16px_rgb(10_18_36/0.3)] transition-colors',
        locked ? 'border-rule' : 'border-rule-strong focus-within:border-ink-3',
      )}>
        <label htmlFor="composer" className="sr-only">Customer enquiry</label>
        <textarea
          id="composer" ref={box} rows={large ? 3 : 1} value={draft.text} disabled={locked} placeholder={placeholder}
          onChange={(e) => setDraft({ ...draft, text: e.target.value, caseId: undefined })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className={cn(
            'block w-full resize-none bg-transparent px-5 pb-2 pt-4 leading-relaxed outline-none placeholder:text-ink-3 disabled:cursor-not-allowed',
            large ? 'min-h-[5.5rem] text-[16px]' : 'text-[15.5px]',
          )}
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
          <Examples onPick={(text, caseId) => { setDraft({ ...draft, text, caseId }); box.current?.focus() }} />
          <button
            type="button" role="switch" aria-checked={draft.mode === 'interactive'} aria-label="Ask questions first" disabled={locked}
            onClick={() => setDraft({ ...draft, mode: draft.mode === 'interactive' ? 'batch' : 'interactive' })}
            title={draft.mode === 'interactive' ? 'On: the assistant pauses to ask you questions first.' : 'Off: no questions; unknowns become explicit assumptions (batch mode).'}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13.5px] font-semibold transition-colors disabled:opacity-50',
              draft.mode === 'interactive' ? 'border-clarifier/40 bg-clarifier/10 text-clarifier' : 'border-rule text-ink-3 hover:text-ink',
            )}
          >
            <span className={cn('grid size-4 place-items-center rounded-full border', draft.mode === 'interactive' ? 'border-clarifier bg-clarifier text-surface' : 'border-ink-3')}>
              {draft.mode === 'interactive' && <Check size={11} strokeWidth={3} aria-hidden />}
            </span>
            Ask questions first
          </button>
          <div className="ml-auto flex items-center gap-2">
            {draft.text.length >= 3000 && (
              <span className={cn('text-[12px] tabular-nums', tooLong ? 'font-bold text-bad' : 'text-ink-3')}>{draft.text.length} / 4000</span>
            )}
            <button
              type="submit" aria-label="Send enquiry" disabled={locked || !length || tooLong}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-action text-on-action transition-opacity hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp size={19} strokeWidth={2.4} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <p className={cn('mt-2 px-4 text-center text-[12.5px]', hint ? 'font-semibold text-bad' : 'text-ink-3 max-sm:hidden')} role={hint ? 'alert' : undefined}>
        {hint || 'Enter to send, Shift + Enter for a new line. Check the cited sources before sharing an answer with a customer.'}
      </p>
    </form>
  )
}
