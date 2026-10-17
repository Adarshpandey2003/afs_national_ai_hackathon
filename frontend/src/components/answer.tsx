import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Cable, ChevronLeft, ChevronRight, Copy, Download, FileDown, FileText, Mail, Printer, ShieldCheck, TriangleAlert, X,
} from 'lucide-react'
import { MOCK, api } from '../api'
import type { AgentName, MethodRecommendation, Question, Report } from '../api/types'
import { useData } from '../lib/data'
import { FIBERS, detectFibers, type FiberFamily } from '../lib/kb'
import kb from '../lib/kb-data.json'
import { STATUS, countKinds, normalizeReport, type Kind } from '../lib/report'
import type { RunState } from '../lib/run'
import { coverage, fmtRange, windowFor } from '../lib/spectral'
import { traceStore } from '../lib/ui-state'
import {
  Concept, KindLegend, Ladder, MethodCard, Plan, Premises, QuestionList, ROLE, Requirements, SourcesList, Spectrum, VERDICT, Verification,
  saveText, when,
} from './report'
import { AGENTS, CitationChip, Citations, ClaimList, Empty, RichText, STATUS_COLOR, StatusIcon, cn } from './ui'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const byPriority = (qs: Question[]) => [...qs].sort((a, b) => a.priority - b.priority)

/* ── Full report: every chapter, opened on demand ── */

type ChapterId = 'premises' | 'methods' | 'concept' | 'spectrum' | 'plan' | 'questions' | 'requirements' | 'risks' | 'sources' | 'verification'
const CHAPTERS: { id: ChapterId; title: string }[] = [
  { id: 'premises', title: 'Premise check' },
  { id: 'methods', title: 'Recommended methods' },
  { id: 'concept', title: 'Measurement concept' },
  { id: 'spectrum', title: 'Spectral fit' },
  { id: 'plan', title: 'First experiment' },
  { id: 'questions', title: 'Questions for the customer' },
  { id: 'requirements', title: 'Facts, unknowns, assumptions' },
  { id: 'risks', title: 'Risks and uncertainty' },
  { id: 'sources', title: 'Sources' },
  { id: 'verification', title: 'Critic verification' },
]

function Chapter({ id, r }: { id: ChapterId; r: Report }) {
  switch (id) {
    case 'premises': return r.requirements.client_premises.length ? <Premises list={r.requirements.client_premises} /> : <Empty>No premises to check</Empty>
    case 'methods': return r.recommendations.length ? <div className="grid gap-3">{rank(r.recommendations).map((m, i) => <MethodCard key={i} m={m} />)}</div> : <Empty>No method recommended</Empty>
    case 'concept': return <Concept mc={r.measurement_concept} />
    case 'spectrum': return <Spectrum ranges={r.spectral_ranges} />
    case 'plan': return <Plan fp={r.feasibility_plan} />
    case 'questions': return <QuestionList qs={r.clarification_questions} answers={r.user_answers} />
    case 'requirements': return <Requirements r={r} />
    case 'risks': return <ClaimList claims={r.risks} />
    case 'sources': return <SourcesList r={r} />
    case 'verification': return <Verification v={r.verification} />
  }
}

function FullReport({ r, at, setAt, close }: { r: Report; at: ChapterId; setAt(c: ChapterId): void; close(): void }) {
  const i = CHAPTERS.findIndex((c) => c.id === at)
  const counts = useMemo(() => countKinds(r), [r])
  const [focus, setFocus] = useState<Kind | null>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const shut = useRef(close)
  shut.current = close

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    if (root) root.inert = true
    closeBtn.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && shut.current()
    addEventListener('keydown', esc)
    return () => {
      if (root) root.inert = false
      removeEventListener('keydown', esc)
      previous?.focus?.()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-[rgb(3_6_15/0.55)] backdrop-blur-[2px]" onClick={close} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby="chapter-title" className="absolute inset-y-0 right-0 flex w-[min(64rem,100vw)] border-l border-rule bg-surface shadow-2xl">
        <nav aria-label="Chapters" className="hidden w-60 shrink-0 overflow-y-auto border-r border-rule bg-surface-2 p-3 md:block">
          <p className="tile-title px-3 pb-2 pt-2">Full report</p>
          {CHAPTERS.map((c) => (
            <button key={c.id} type="button" onClick={() => setAt(c.id)} aria-current={c.id === at ? 'page' : undefined}
              className={cn('block w-full rounded-lg px-3 py-2 text-left text-[14px] font-semibold transition-colors', c.id === at ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:text-ink')}>
              {c.title}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-rule px-6 py-4">
            <select className="field w-auto py-1.5 md:hidden" value={at} onChange={(e) => setAt(e.target.value as ChapterId)} aria-label="Chapter">
              {CHAPTERS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <h2 id="chapter-title" className="display text-[1.35rem] max-md:sr-only">{CHAPTERS[i]?.title}</h2>
            <button ref={closeBtn} type="button" className="btn btn-quiet ml-auto" onClick={close} aria-label="Close the full report"><X size={20} /></button>
          </header>
          <div key={at} className="report min-h-0 flex-1 overflow-y-auto px-6 py-6 @container" data-focus={focus ?? undefined}>
            <div className="-mt-2 mb-5"><KindLegend counts={counts} focus={focus} setFocus={setFocus} /></div>
            <Chapter id={at} r={r} />
          </div>
          <footer className="flex items-center gap-2 border-t border-rule px-4 py-3">
            <button type="button" className="btn btn-quiet text-[14px]" disabled={i <= 0} onClick={() => setAt(CHAPTERS[i - 1].id)}>
              <ChevronLeft size={17} aria-hidden /> {i > 0 ? CHAPTERS[i - 1].title : 'Previous'}
            </button>
            <button type="button" className="btn btn-quiet ml-auto text-[14px]" disabled={i >= CHAPTERS.length - 1} onClick={() => setAt(CHAPTERS[i + 1].id)}>
              {i < CHAPTERS.length - 1 ? CHAPTERS[i + 1].title : 'Next'} <ChevronRight size={17} aria-hidden />
            </button>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ExportMenu({ raw, r, threadId }: { raw: Report; r: Report; threadId?: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    addEventListener('mousedown', away)
    return () => removeEventListener('mousedown', away)
  }, [open])
  const flash = (t: string) => {
    setNote(t)
    setTimeout(() => setNote(''), 1800)
  }
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-surface-2'
  return (
    <div ref={wrap} className="no-print relative">
      <button type="button" className="btn btn-secondary rounded-full py-1.5 text-[14px]" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <Download size={15} aria-hidden /> {note || 'Export'}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl border border-rule bg-surface p-2 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)]">
          {threadId && (
            <button type="button" role="menuitem" className={item} onClick={async () => {
              setOpen(false)
              try {
                saveText(await api.reportMarkdown(threadId), `assessment-${r.case_id ?? threadId}.md`)
              } catch {
                flash('Download failed')
              }
            }}>
              <FileDown size={16} aria-hidden /> Markdown file
            </button>
          )}
          <button type="button" role="menuitem" className={item} onClick={() => {
            setOpen(false)
            navigator.clipboard.writeText(JSON.stringify(raw, null, 2)).then(() => flash('JSON copied'), () => flash('Copy failed'))
          }}>
            <Copy size={16} aria-hidden /> Copy JSON
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); print() }}>
            <Printer size={16} aria-hidden /> Print or save as PDF
          </button>
        </div>
      )}
    </div>
  )
}

function emailFor(r: Report) {
  return [
    'Dear customer,',
    '',
    'thank you for your enquiry. To prepare a first feasibility test, we would like to clarify a few points:',
    '',
    ...byPriority(r.clarification_questions).map((q, i) => `${i + 1}. ${q.text}`),
    '',
    'Kind regards,',
    'Art Fiber Systems',
  ].join('\n')
}

/* ── Fiber check: can the link carry the method's light? ── */

const rank = (ms: MethodRecommendation[]) => [...ms].sort((a, b) => (ROLE[a.role]?.rank ?? 1) - (ROLE[b.role]?.rank ?? 1))

/** The window a method works in: the report's stated range, else the nominal NIR / mid-IR range from S01. */
function methodWindow(m: MethodRecommendation, r: Report): { win: [number, number]; nominal: boolean } | null {
  const stated = windowFor(m.method, r.spectral_ranges)
  if (stated) return { win: stated, nominal: false }
  const name = m.method.toLowerCase()
  if (name.includes('+')) return null
  const n = /\bnir\b|near/.test(name) ? kb.method_ranges.NIR : /mir|mid|ftir|atr/.test(name) ? kb.method_ranges.MIR : null
  return n ? { win: [n.min_nm, n.max_nm], nominal: true } : null
}

const FIT_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' }
const FIBER_PAGE = { source: 'S02', page: 6, label: 'S02 p.6' } as const

/** Checks the method's window against the AFS fiber families (S02 p.6), and warns when a fiber the customer wants to use can't carry it. */
function fiberCheck(m: MethodRecommendation, r: Report): { tone: keyof typeof FIT_COLOR; text: string } | null {
  const w = methodWindow(m, r)
  if (!w) return null
  const range = `${w.nominal ? 'the nominal ' : ''}${fmtRange(w.win)}`
  const fits = FIBERS.map((f) => ({ f, share: coverage(w.win, [f.min_nm, f.max_nm]) })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share)
  if (!fits.length) return { tone: 'bad', text: `None of the AFS fiber families carries ${range}.` }
  // Only the customer's own statements count as "their" fiber; the report's link may name fibers meant for another method.
  const theirs = detectFibers(r.requirements.client_premises.map((p) => p.statement).join(' '))
  const blocked = theirs.find((f) => !fits.some((x) => x.f === f))
  if (blocked) return { tone: 'bad', text: `The customer’s ${blocked.name} fiber cannot carry ${range}; ${fits.slice(0, 2).map((x) => x.f.name).join(' or ')} can.` }
  const named = [...theirs, ...detectFibers(r.measurement_concept.fiber_link.map((c) => c.text).join(' '))]
  // With no fiber named, show the family made for this band: the narrowest one that still carries 90%.
  const span = (f: FiberFamily) => Math.log(f.max_nm / f.min_nm)
  const made = fits.filter((x) => x.share >= 0.9).sort((a, b) => span(a.f) - span(b.f))[0]
  const pick = fits.find((x) => named.includes(x.f)) ?? made ?? fits[0]
  return { tone: pick.share >= 0.9 ? 'ok' : 'warn', text: `${pick.f.name} carries ${pick.share >= 0.98 ? 'all' : `${Math.round(pick.share * 100)}%`} of ${range}.` }
}

/* ── The answer ── */

/** One part of the answer, owned by the agent that writes it. Its colour matches that agent in the log. */
function Part({ title, agent, i, more, children }: {
  title: string; agent: AgentName; i: number; more?: { label: string; onClick(): void }; children?: ReactNode
}) {
  const { label, color, Icon } = AGENTS[agent]
  const hit = traceStore.use() === `agent:${agent}`
  return (
    <section aria-label={title} className={cn('min-w-0 transition-[outline-color]', hit && 'part-hit')} style={{ ['--agent' as string]: color }}>
      <header className="flex items-center gap-2 border-t-2 pt-3" style={{ borderColor: color }}>
        <h2 className="text-[18px] font-bold">{title}</h2>
        <span className="flex items-center gap-1 text-[13px] font-semibold" style={{ color }}><Icon size={12} aria-hidden /> {label}</span>
        {more && (
          <button type="button" onClick={more.onClick} className="no-print ml-auto flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[13px] font-semibold text-ink-3 hover:text-ink">
            {more.label} <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </header>
      <div className="blur-in mt-3" style={{ ['--i' as string]: i }}>{children}</div>
    </section>
  )
}

/** The answer on one sheet: the verdict, then four short parts (methods, questions, experiment, risks); the rest is one click away in the full report. */
export function Answer({ run, report, caseLabel, enquiry }: { run?: RunState; report?: Report; caseLabel?: string; enquiry?: string }) {
  const { cases, health } = useData()
  const raw = report ?? run?.report
  const r = useMemo(() => (raw ? normalizeReport(raw) : undefined), [raw])
  const [chapter, setChapter] = useState<ChapterId | null>(null)
  const [showEnquiry, setShowEnquiry] = useState(false)
  const [copied, setCopied] = useState(false)
  const open = (c: ChapterId) => () => setChapter(c)

  // Mock modes replay a canned report whatever was typed: say so instead of naming the typed case.
  const replay = !!run && (MOCK || (health.state === 'ok' && health.health.mock_mode))
  const caseId = replay ? undefined : run?.caseId ?? r?.case_id
  const label = replay ? 'Mock replay, not your enquiry' : caseLabel ?? (caseId ? `${caseId} – ${cases.find((c) => c.case_id === caseId)?.title ?? ''}` : 'Your enquiry')
  const text = enquiry ?? r?.enquiry

  const questions = byPriority(r?.clarification_questions ?? [])
  const answers = new Map([...(r?.user_answers ?? []), ...(run?.rounds.flatMap((x) => x.answers) ?? [])].map((a) => [a.question_id, a.answer]))
  const methods = r ? rank(r.recommendations) : []
  const shown = methods.filter((m) => m.role !== 'not_recommended').slice(0, 3)
  const out = methods.filter((m) => m.role === 'not_recommended')
  const premises = (r?.requirements.client_premises ?? []).filter((p) => p.verdict !== 'supported').sort((a, b) => (VERDICT[a.verdict]?.rank ?? 1) - (VERDICT[b.verdict]?.rank ?? 1))
  const steps = r ? [...r.feasibility_plan.steps].sort((a, b) => a.order - b.order) : []
  const color = r ? STATUS_COLOR[r.decision_status] : undefined
  const v = r?.verification

  if (!r) return null
  return (
    <article className="glass glow-card light-sweep rise relative overflow-hidden p-6 @container sm:p-8" aria-label="Answer">
      {color && <span aria-hidden className="pointer-events-none absolute -left-20 -top-24 size-64 rounded-full opacity-20 blur-3xl" style={{ background: color }} />}

      <header className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-[1_1_14rem] truncate text-[14px] font-semibold text-ink-3" title={label}>{label}</p>
        {!run && text && (
          <button type="button" onClick={() => setShowEnquiry(!showEnquiry)} aria-expanded={showEnquiry}
            className="no-print rounded-full border border-rule px-3 py-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
            {showEnquiry ? 'Hide enquiry' : 'Customer enquiry'}
          </button>
        )}
        {raw && <ExportMenu raw={raw} r={r} threadId={run?.threadId} />}
      </header>
      {showEnquiry && text && <p className="relative mt-3 rounded-xl bg-surface-2 px-4 py-3 text-[15px] leading-relaxed text-ink-2">{text}</p>}

      {/* Verdict */}
      <div className="relative">
        <div className="blur-in mt-4" style={{ ['--status' as string]: color }}>
          <p className="display flex items-center gap-3 text-[clamp(1.6rem,2.8vw,2.4rem)] leading-tight" style={{ color }}>
            <span style={{ filter: `drop-shadow(0 0 10px ${color})` }}><StatusIcon status={r.decision_status} size={32} /></span>
            {STATUS[r.decision_status].label}
          </p>
          {r.decision_rationale && <p className="prose-measure mt-2 text-[15px] leading-relaxed text-ink-2"><RichText text={r.decision_rationale} /></p>}
          <Ladder status={r.decision_status} />
          {r.summary && <p className="prose-measure mt-5 text-[17px] leading-[1.6]"><RichText text={r.summary} /></p>}

          {premises.length > 0 && (
            <ul className="mt-5 space-y-2.5">
              {premises.slice(0, 2).map((p, k) => {
                const vd = VERDICT[p.verdict] ?? VERDICT.unverified
                return (
                  <li key={k} className="flex gap-3 rounded-xl border px-4 py-3" style={{ borderColor: `color-mix(in oklab, ${vd.color} 40%, transparent)`, background: `color-mix(in oklab, ${vd.color} 7%, transparent)` }}>
                    <vd.Icon size={18} aria-hidden className="mt-0.5 shrink-0" style={{ color: vd.color }} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold" style={{ color: vd.color }}>Customer assumption, {p.verdict === 'refuted' ? 'contradicted by' : 'not confirmed by'} the AFS sources</p>
                      <p className="mt-0.5 font-semibold leading-snug">“{p.statement}”</p>
                      {p.verdict === 'refuted' && <p className="mt-1 line-clamp-3 text-[14px] leading-snug text-ink-2"><RichText text={p.explanation} /> <Citations list={p.citations} /></p>}
                    </div>
                  </li>
                )
              })}
              {premises.length > 2 && <li><button type="button" onClick={open('premises')} className="text-[13px] font-semibold text-ink-3 hover:text-ink">+{premises.length - 2} more assumptions</button></li>}
            </ul>
          )}

          {v && (v.checks.length > 0 || v.revisions > 0) && (
            <button type="button" onClick={open('verification')} className="no-print mt-5 flex items-center gap-1.5 text-[14px] font-semibold text-ink-2 hover:text-ink">
              <ShieldCheck size={16} aria-hidden className="text-critic" />
              {v.passed ? 'Checked by the Critic' : 'Not passed by the Critic'}: {plural(v.checks.length, 'check')} after {plural(v.revisions, 'revision')}
            </button>
          )}
        </div>
      </div>

      {/* The four parts */}
      <div className="relative mt-9 grid gap-x-10 gap-y-9 @2xl:grid-cols-2 print:hidden">
        <Part i={2} title="Test first" agent="writer" more={{ label: 'All methods', onClick: open('methods') }}>
          {shown.length ? (
            <ul className="space-y-4">
              {shown.map((m, k) => {
                const fc = r && fiberCheck(m, r)
                const reason = m.rationale[0]
                return (
                  <li key={k}>
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[17px] font-bold">{m.method}</span>
                      {m.technique && <span className="text-[14px] text-ink-3"><RichText text={m.technique} /></span>}
                      <span className={cn('ml-auto rounded-md px-1.5 py-0.5 text-[12px] font-bold', ROLE[m.role]?.cls)}>{ROLE[m.role]?.label}</span>
                    </p>
                    {reason && <p className="mt-1 line-clamp-3 text-[15px] leading-snug text-ink-2"><RichText text={reason.text} /> <Citations list={reason.citations} /></p>}
                    {fc && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[13px] font-semibold leading-snug" style={{ color: FIT_COLOR[fc.tone] }}>
                        <Cable size={14} aria-hidden className="mt-0.5 shrink-0" /> <span>{fc.text} <CitationChip c={FIBER_PAGE} /></span>
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : <Empty>No method recommended yet</Empty>}
          {out.length > 0 && <p className="mt-3 text-[14px] text-ink-3"><span className="font-semibold text-bad">Not recommended:</span> {out.map((m) => m.method).join(', ')}</p>}
        </Part>

        <Part i={3} title="Ask the customer" agent="clarifier"
          more={r && questions.length > 3 ? { label: `All ${questions.length}`, onClick: open('questions') } : undefined}>
          {questions.length ? (
            <ol className="space-y-3">
              {questions.slice(0, 3).map((q, k) => (
                <li key={q.question_id} className="flex gap-3">
                  <span title={q.priority === 1 ? 'Could change the method or set-up' : undefined}
                    className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[13px] font-bold', q.priority === 1 ? 'bg-clarifier text-surface' : 'border border-clarifier/50 text-clarifier')}>
                    {k + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-snug">{q.text}</p>
                    {answers.has(q.question_id) && <p className="mt-1 text-[14px] text-fact">Answer: {answers.get(q.question_id)}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty>No open questions</Empty>}
          {r && questions.length > 0 && (
            <button type="button" className="no-print mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2 hover:text-ink"
              onClick={() => navigator.clipboard.writeText(emailFor(r)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }, () => {})}>
              <Mail size={14} aria-hidden /> {copied ? 'Email draft copied' : 'Copy as an email to the customer'}
            </button>
          )}
        </Part>

        <Part i={4} title="First experiment" agent="writer" more={{ label: 'Full plan', onClick: open('plan') }}>
          {r?.feasibility_plan.objective && <p className="line-clamp-3 text-[15px] leading-snug"><RichText text={r.feasibility_plan.objective} /></p>}
          {steps.length > 0 && (
            <ol className="mt-3 space-y-2">
              {steps.map((s) => (
                <li key={s.order} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-writer text-[13px] font-bold text-writer">{s.order}</span>
                  <span className="pt-0.5 text-[14px] font-semibold leading-snug">{s.title}</span>
                </li>
              ))}
            </ol>
          )}
          {r?.feasibility_plan.go_no_go && (
            <p className="mt-3 line-clamp-3 text-[14px] leading-snug text-ink-2"><span className="font-bold text-ink">Go / no-go: </span><RichText text={r.feasibility_plan.go_no_go} /></p>
          )}
          {r && !steps.length && !r.feasibility_plan.objective && <Empty>No experiment proposed</Empty>}
        </Part>

        <Part i={5} title="Watch out" agent="writer" more={r && r.risks.length > 3 ? { label: `All ${r.risks.length}`, onClick: open('risks') } : undefined}>
          {r?.risks.length ? (
            <ul className="space-y-2.5">
              {r.risks.slice(0, 3).map((k, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-snug">
                  <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-warn" />
                  <span><RichText text={k.text} /> <Citations list={k.citations} /></span>
                </li>
              ))}
            </ul>
          ) : <Empty>No risks listed</Empty>}
        </Part>
      </div>

      {r && (
        <footer className="no-print relative mt-9 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-rule pt-5">
          <button type="button" className="btn btn-secondary rounded-full" onClick={open(r.requirements.client_premises.length ? 'premises' : 'methods')}>
            <FileText size={16} aria-hidden /> Open the full report
          </button>
          <p className="text-[13px] text-ink-3">
            {[r.meta.model, r.meta.mode === 'batch' ? 'batch mode' : 'interactive mode', when(r.meta.generated_at)].filter(Boolean).join(', ')}
          </p>
        </footer>
      )}

      {chapter && r && <FullReport r={r} at={chapter} setAt={setChapter} close={() => setChapter(null)} />}

      {/* Printing gives the full report, chapter by chapter. */}
      {r && (
        <div className="print-only report mt-8">
          {CHAPTERS.map((ch) => (
            <section key={ch.id} className="mt-6 break-inside-avoid-page">
              <h2 className="display mb-3 text-[1.2rem]">{ch.title}</h2>
              <Chapter id={ch.id} r={r} />
            </section>
          ))}
        </div>
      )}
    </article>
  )
}
