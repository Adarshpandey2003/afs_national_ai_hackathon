import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Ban, CircleQuestionMark, ExternalLink, FlaskConical, MessageCircleQuestionMark, PenLine, Search, ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import type { AgentName, Citation, Claim, DecisionStatus, EvidenceLevel, Question } from '../api/types'
import { EVIDENCE, pageTopic, sourceMeta } from '../lib/kb'
import { KIND, STATUS, citeLabel, splitInlineCitations } from '../lib/report'
import { openSource, tipStore, tooltip } from '../lib/ui-state'

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/** Three fibers fanning out of one probe tip, after the AFS mark. */
export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" strokeLinecap="round" strokeWidth="2.6" aria-hidden className={className}>
      <path d="M7 27C10 17 15 9 27 5" stroke="#6A3FD0" />
      <path d="M7 27C12 20 18 14 28 12" stroke="#12A3B8" />
      <path d="M7 27C13 23 20 20 28 19" stroke="#F08A24" />
      <circle cx="7" cy="27" r="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

export const AGENTS: Record<AgentName, { label: string; Icon: LucideIcon; color: string; role: string; doing: string }> = {
  clarifier: { label: 'Clarifier', Icon: MessageCircleQuestionMark, color: 'var(--clarifier)', role: 'Separates what the customer stated from what is unknown, and asks about the gaps.', doing: 'is reading the enquiry' },
  researcher: { label: 'Researcher', Icon: Search, color: 'var(--researcher)', role: 'Searches the AFS sources for methods, probes, fibers and application examples.', doing: 'is searching the AFS sources' },
  writer: { label: 'Writer', Icon: PenLine, color: 'var(--writer)', role: 'Drafts methods, spectral range, probe concept, risks and the first experiment.', doing: 'is drafting the report' },
  critic: { label: 'Critic', Icon: ShieldCheck, color: 'var(--critic)', role: 'Checks every claim against its source and sends the draft back if needed.', doing: 'is checking the draft' },
}
export const AGENT_ORDER: AgentName[] = ['clarifier', 'researcher', 'writer', 'critic']

export const STATUS_COLOR: Record<DecisionStatus, string> = {
  provisional: 'var(--ok)',
  insufficient_information: 'var(--warn)',
  outside_supported_scope: 'var(--bad)',
}

export function StatusIcon({ status, size = 18 }: { status: DecisionStatus; size?: number }) {
  const I = status === 'provisional' ? FlaskConical : status === 'insufficient_information' ? CircleQuestionMark : Ban
  return <I size={size} aria-hidden strokeWidth={2.2} />
}

export function StatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: STATUS_COLOR[status] }}>
      <StatusIcon status={status} size={15} />
      {STATUS[status].label}
    </span>
  )
}

const TONE = {
  info: 'bg-surface-3 text-ink-2',
  neutral: 'bg-surface-3 text-ink-2',
  warn: 'bg-warn-bg text-warn',
  muted: 'bg-surface-3 text-ink-3',
  ext: 'bg-surface-3 text-clarifier',
}

export function EvidenceTag({ level }: { level: EvidenceLevel }) {
  const e = EVIDENCE[level] ?? { label: level, tone: 'neutral' as const }
  return <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11.5px] font-bold', TONE[e.tone])}>{e.label}</span>
}

export const Empty = ({ children = 'None stated' }: { children?: ReactNode }) => (
  <p className="text-[14px] italic text-ink-3">{children}</p>
)

/* ── Citations ── */

function CitePreview({ c }: { c: Citation }) {
  const isTable = c.source === 'TABLE'
  const meta = sourceMeta(isTable ? 'S01' : c.source)
  const topic = pageTopic(isTable ? 'S01' : c.source, isTable ? 6 : c.page)
  const level: EvidenceLevel | undefined = c.source === 'EXT' ? 'external' : sourceMeta(c.source)?.evidence_level
  return (
    <div className="space-y-1.5">
      <p className="font-bold text-ink">{citeLabel(c)}</p>
      <p className="text-[13px] leading-snug text-ink-2">
        {c.source === 'EXT' ? c.url : meta?.title ?? c.source}
        {topic && <span className="mt-0.5 block text-ink-3">{topic}</span>}
      </p>
      {level && <EvidenceTag level={level} />}
      {c.quote && <blockquote className="border-l-2 border-sourced pl-2 text-[13px] italic leading-snug text-ink">“{c.quote}”</blockquote>}
      <p className="text-[12px] text-ink-3">{c.source === 'EXT' ? 'Opens the external page' : 'Click to read the page'}</p>
    </div>
  )
}

export function CitationChip({ c }: { c: Citation }) {
  const label = citeLabel(c)
  const level = c.source === 'EXT' ? 'external' : sourceMeta(c.source)?.evidence_level
  const show = (e: MouseEvent | FocusEvent) => tooltip.show(e.currentTarget, <CitePreview c={c} />)
  const events = { onMouseEnter: show, onFocus: show, onMouseLeave: tooltip.hide, onBlur: tooltip.hide }
  if (c.source === 'EXT' && c.url) {
    return (
      <a className="cite" data-tone="ext" href={c.url} target="_blank" rel="noopener noreferrer" {...events}>
        {label} <ExternalLink size={11} aria-hidden />
      </a>
    )
  }
  return (
    <button
      type="button" className="cite" data-tone={level ? EVIDENCE[level].tone : undefined} aria-haspopup="dialog" {...events}
      onClick={() => openSource({ source: c.source, page: c.page, quote: c.quote, label, url: c.url })}
    >
      {label}
    </button>
  )
}

export const Citations = ({ list }: { list: Citation[] }) =>
  list.length ? <>{list.map((c, i) => <CitationChip key={`${c.label}-${i}`} c={c} />)}</> : null

/** Text that may carry inline references like "[S01 p.10]". */
export function RichText({ text }: { text: string }) {
  return <>{splitInlineCitations(text).map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <CitationChip key={i} c={p} />))}</>
}

/* ── Claims (frontend.md §4 ClaimItem) ── */

export function KindChip({ kind }: { kind: Claim['kind'] }) {
  return <span className="kind-chip" data-kind={kind} title={KIND[kind].hint}>{KIND[kind].label}</span>
}

export function ClaimItem({ claim }: { claim: Claim }) {
  return (
    <li className="claim" data-kind={claim.kind}>
      <KindChip kind={claim.kind} />
      <RichText text={claim.text} /> <Citations list={claim.citations} />
    </li>
  )
}

export function ClaimList({ claims, empty }: { claims: Claim[]; empty?: string }) {
  if (!claims.length) return <Empty>{empty}</Empty>
  return <ul className="space-y-2.5 leading-relaxed">{claims.map((c, i) => <ClaimItem key={i} claim={c} />)}</ul>
}

/* ── Questions ── */

const AFFECTS: Record<Question['affects'], string> = {
  method: 'Could change the method',
  setup: 'Could change the setup',
  plan: 'Shapes the test plan',
  acceptance: 'Sets acceptance criteria',
}

export function PriorityTag({ p }: { p: Question['priority'] }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[11.5px] font-bold',
      p === 1 ? 'bg-clarifier text-surface' : p === 2 ? 'border border-clarifier/50 text-clarifier' : 'bg-surface-3 text-ink-3',
    )}>
      P{p}
    </span>
  )
}

export const AffectsTag = ({ affects }: { affects: Question['affects'] }) => (
  <span className="text-[12.5px] font-semibold text-ink-3">{AFFECTS[affects] ?? affects}</span>
)

export function Rating({ value }: { value: string }) {
  const n = value === 'high' ? 3 : value === 'average' ? 2 : value === 'low' ? 1 : 0
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="flex gap-0.5">
        {[1, 2, 3].map((i) => <span key={i} className={cn('size-1.5 rounded-full', i <= n ? 'bg-ink' : 'bg-rule-strong')} />)}
      </span>
      {value}
    </span>
  )
}

/* ── Tooltip layer (one fixed element, so popovers never get clipped by scrolling columns) ── */

export function TooltipLayer() {
  const tip = tipStore.use()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null)
    const { width, height } = ref.current.getBoundingClientRect()
    const r = tip.rect
    const below = r.bottom + 8
    const top = below + height > innerHeight - 8 ? Math.max(8, r.top - height - 8) : below
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), innerWidth - width - 8)
    setPos({ top, left })
  }, [tip])

  useEffect(() => {
    if (!tip) return
    // Hide only when the scroll actually moves the anchor (not e.g. the section nav sliding sideways).
    const onScroll = (e: Event) => {
      if (e.target === document || (e.target instanceof Node && e.target.contains(tip.el))) tooltip.hide()
    }
    addEventListener('scroll', onScroll, true)
    addEventListener('resize', tooltip.hide)
    return () => {
      removeEventListener('scroll', onScroll, true)
      removeEventListener('resize', tooltip.hide)
    }
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={ref} role="tooltip"
      className="pointer-events-none fixed z-[70] w-max max-w-[19rem] rounded-lg border border-rule bg-surface p-3 text-sm shadow-[0_12px_32px_-8px_rgb(10_18_36/0.35)]"
      style={pos ?? { top: -9999, left: -9999 }}
    >
      {tip.content}
    </div>,
    document.body,
  )
}
