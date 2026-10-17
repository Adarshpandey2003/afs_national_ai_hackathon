import type { ReactNode } from 'react'
import {
  Cable, ChevronDown, CircleCheck, CircleQuestionMark, CircleX, Factory, Lock, Microscope, Scale, ScanSearch, TriangleAlert, type LucideIcon,
} from 'lucide-react'
import type { Claim, DecisionStatus, MethodRecommendation, Premise, Question, Report } from '../api/types'
import { useData } from '../lib/data'
import { SOURCES, TABLE_CITATION, sourceMeta, tableRow, units, type MethodRow } from '../lib/kb'
import { KIND, STATUS, citationIndex, type Kind } from '../lib/report'
import { parseRangeNm } from '../lib/spectral'
import { SpectralChart } from './spectral-chart'
import { AffectsTag, CitationChip, Citations, ClaimList, Empty, EvidenceTag, PriorityTag, Rating, RichText, cn } from './ui'

/* ── Verdict ── */

const LADDER: DecisionStatus[] = ['outside_supported_scope', 'insufficient_information', 'provisional']

/** How far an assessment can go. The last step needs the experiment, so the assistant never reaches it. */
export function Ladder({ status }: { status: DecisionStatus }) {
  const at = LADDER.indexOf(status)
  return (
    <ol className="ladder mt-3 max-w-[40rem]" aria-label="Decision scale">
      {LADDER.map((s, i) => (
        <li key={s} data-state={i < at ? 'past' : i === at ? 'current' : 'future'} aria-current={i === at ? 'step' : undefined}>
          {STATUS[s].label}
        </li>
      ))}
      <li data-state="locked" title="Only the feasibility experiment can validate a method. The assistant never claims this.">
        <span className="inline-flex items-center gap-1"><Lock size={11} aria-hidden /> Validated by experiment</span>
      </li>
    </ol>
  )
}

export function saveText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function KindLegend({ counts, focus, setFocus }: { counts: Record<Kind, number>; focus: Kind | null; setFocus(k: Kind | null): void }) {
  return (
    <div className="no-print mt-5 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[13px] font-semibold text-ink-3">Highlight</span>
      {(Object.keys(KIND) as Kind[]).map((k) => (
        <button
          key={k} type="button" className="kind-chip !mr-0 cursor-pointer" data-kind={k} aria-pressed={focus === k}
          title={`${KIND[k].hint}. Select to highlight.`} onClick={() => setFocus(focus === k ? null : k)}
        >
          {KIND[k].label} <span className="font-semibold opacity-75">{counts[k]}</span>
        </button>
      ))}
      {focus && <button type="button" className="ml-1 text-[13px] font-semibold text-ink-2 underline underline-offset-2" onClick={() => setFocus(null)}>Show all</button>}
    </div>
  )
}

/* ── Sections ── */

export const VERDICT: Record<Premise['verdict'], { label: string; Icon: LucideIcon; color: string; box: string; rank: number }> = {
  refuted: { label: 'Refuted by the sources', Icon: CircleX, color: 'var(--bad)', box: 'border-bad/40 bg-bad-bg', rank: 0 },
  unverified: { label: 'Unverified', Icon: CircleQuestionMark, color: 'var(--warn)', box: 'border-rule bg-surface', rank: 1 },
  supported: { label: 'Supported', Icon: CircleCheck, color: 'var(--ok)', box: 'border-rule bg-surface', rank: 2 },
}

export function Premises({ list }: { list: Premise[] }) {
  const sorted = [...list].sort((a, b) => (VERDICT[a.verdict]?.rank ?? 1) - (VERDICT[b.verdict]?.rank ?? 1))
  return (
    <ul className="grid gap-3">
      {sorted.map((p, i) => {
        const v = VERDICT[p.verdict] ?? VERDICT.unverified
        return (
          <li key={i} className={cn('relative overflow-hidden rounded-xl border py-4 pl-6 pr-5', v.box)}>
            <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: v.color }} />
            <p className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: v.color }}>
              <v.Icon size={16} aria-hidden /> {v.label}
            </p>
            <p className="mt-2 text-[16px] font-semibold leading-snug">“{p.statement}”</p>
            <p className="prose-measure mt-2 leading-relaxed text-ink-2">
              <RichText text={p.explanation} /> <Citations list={p.citations} />
            </p>
          </li>
        )
      })}
    </ul>
  )
}

export function Requirements({ r }: { r: Report }) {
  const assumptions: Claim[] = r.assumptions.map((text) => ({ text, kind: 'assumption', citations: [] }))
  return (
    <div className="grid gap-x-8 gap-y-7 @2xl:grid-cols-3">
      <div>
        <p className="subhead">Stated by the customer</p>
        <ClaimList claims={r.requirements.stated_facts} />
      </div>
      <div>
        <p className="subhead">Key unknowns</p>
        {r.requirements.key_unknowns.length ? (
          <ul className="space-y-2.5 leading-relaxed">
            {r.requirements.key_unknowns.map((u, i) => (
              <li key={i} className="flex gap-2.5">
                <span aria-hidden className="mt-1 grid size-4 shrink-0 place-items-center rounded border border-dashed border-ink-3 text-[10px] font-bold text-ink-3">?</span>
                <RichText text={u} />
              </li>
            ))}
          </ul>
        ) : <Empty />}
      </div>
      <div>
        <p className="subhead">Assumptions</p>
        <ClaimList claims={assumptions} />
      </div>
    </div>
  )
}

export function QuestionList({ qs, answers }: { qs: Question[]; answers: Report['user_answers'] }) {
  // Questions the customer already answered during clarification (they are no longer among the open questions).
  const open = new Set(qs.map((q) => q.question_id))
  const answered = answers.filter((a) => a.question && !open.has(a.question_id))
  if (!qs.length && !answered.length) return <Empty>No open questions</Empty>
  const byId = new Map(answers.map((a) => [a.question_id, a.answer]))
  return (
    <>
    {answered.length > 0 && (
      <div className="mb-4 rounded-xl border border-fact/30 p-4">
        <p className="text-[13px] font-semibold text-fact">Answered by the customer</p>
        <ul className="mt-2 space-y-3">
          {answered.map((a) => (
            <li key={a.question_id} className="text-[15px]">
              <p className="font-semibold leading-snug">{a.question}</p>
              <p className="mt-1 border-l-2 border-fact pl-3">{a.answer}</p>
            </li>
          ))}
        </ul>
      </div>
    )}
    {qs.length === 0 ? <Empty>No open questions</Empty> : (
    <ol className="space-y-3">
      {[...qs].sort((a, b) => a.priority - b.priority).map((q) => {
        const answer = byId.get(q.question_id)
        return (
          <li key={q.question_id} className={cn('rounded-xl border p-4', q.priority === 1 ? 'border-clarifier/35 bg-clarifier/5' : 'border-rule')}>
            <div className="flex flex-wrap items-center gap-2.5">
              <PriorityTag p={q.priority} />
              <AffectsTag affects={q.affects} />
            </div>
            <p className="mt-2 text-[16px] font-semibold leading-snug">{q.text}</p>
            {answer && (
              <p className="mt-2.5 border-l-2 border-fact pl-3 text-[15px]">
                <span className="font-semibold text-fact">Customer’s answer: </span>{answer}
              </p>
            )}
            {q.why_it_matters && (
              <details className="group mt-2">
                <summary className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-3 hover:text-ink">
                  <ChevronDown size={14} aria-hidden className="transition-transform group-open:rotate-180" /> Why it matters
                </summary>
                <p className="prose-measure mt-1.5 text-[14px] text-ink-2"><RichText text={q.why_it_matters} /></p>
              </details>
            )}
          </li>
        )
      })}
    </ol>
    )}
    </>
  )
}

export const ROLE: Record<MethodRecommendation['role'], { label: string; cls: string; rank: number }> = {
  primary: { label: 'Primary candidate', cls: 'bg-ink text-surface', rank: 0 },
  comparison: { label: 'Comparison candidate', cls: 'border border-ink text-ink', rank: 1 },
  combination: { label: 'Combination', cls: 'border border-dashed border-ink-3 text-ink-2', rank: 2 },
  not_recommended: { label: 'Not recommended', cls: 'bg-bad-bg text-bad', rank: 3 },
}

export function TableFacts({ row }: { row: MethodRow }) {
  const cell = (k: string, v: ReactNode) => (
    <div>
      <dt className="text-[13px] text-ink-3">{k}</dt>
      <dd className="mt-0.5">{v}</dd>
    </div>
  )
  return (
    <div className="mt-4 rounded-lg bg-surface-2 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-[14px] @xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        {cell('Sample type', row.sample_type)}
        {cell('Optical path', units(row.optical_path_or_depth))}
        {cell('Sensitivity', <Rating value={row.sensitivity} />)}
        {cell('Selectivity', <Rating value={row.selectivity} />)}
        {cell('Cost', <Rating value={row.cost} />)}
      </dl>
      <p className="mt-2 text-[13px] text-ink-3">
        Qualitative ratings for {row.method}, {row.measurement_technique.replace('*', '')} <CitationChip c={TABLE_CITATION} />
      </p>
    </div>
  )
}

export function MethodCard({ m }: { m: MethodRecommendation }) {
  const role = ROLE[m.role] ?? ROLE.comparison
  const out = m.role === 'not_recommended'
  const row = out ? undefined : tableRow(m.method, m.technique)
  return (
    <article className={cn(
      'rounded-xl border p-5',
      out ? 'border-bad/25 bg-bad-bg/50'
        : m.role === 'primary' ? 'border-ink/60'
        : m.role === 'combination' ? 'border-dashed border-rule-strong'
        : 'border-rule',
    )}>
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className={cn('display text-[1.3rem] leading-tight', out && 'text-ink-2')}>{m.method}</h3>
          {m.technique && <p className="mt-0.5 text-ink-2"><RichText text={m.technique} /></p>}
        </div>
        <span className={cn('rounded-md px-2 py-1 text-[13px] font-bold', role.cls)}>{role.label}</span>
      </header>
      {row && <TableFacts row={row} />}
      <div className="mt-4"><ClaimList claims={m.rationale} empty="No rationale given" /></div>
      {m.conditions.length > 0 && (
        <div className="mt-4">
          <p className="subhead">Applies when</p>
          <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-2 marker:text-ink-3">
            {m.conditions.map((c, i) => <li key={i}><RichText text={c} /></li>)}
          </ul>
        </div>
      )}
      {m.citations.length > 0 && <p className="mt-3"><Citations list={m.citations} /></p>}
    </article>
  )
}

export function Concept({ mc }: { mc: Report['measurement_concept'] }) {
  const blocks: [string, LucideIcon, Claim[]][] = [
    ['Fiber link', Cable, mc.fiber_link],
    ['Probe geometry', ScanSearch, mc.probe_geometry],
    ['Location', Factory, mc.location],
  ]
  const node = (Icon: LucideIcon, open = false) => (
    <span className={cn('relative z-10 grid size-10 shrink-0 place-items-center rounded-full border-2 bg-surface', open ? 'border-dashed border-rule-strong text-ink-3' : 'border-ink text-ink')}>
      <Icon size={18} aria-hidden />
    </span>
  )
  const link = '@3xl:after:absolute @3xl:after:left-5 @3xl:after:top-[19px] @3xl:after:h-0.5 @3xl:after:w-[calc(100%+2rem)] @3xl:after:bg-(image:--spectrum) @3xl:after:opacity-60 @3xl:after:content-[""] relative before:absolute before:bottom-[-1.75rem] before:left-[19px] before:top-11 before:w-0.5 before:bg-(image:--spectrum-v) before:opacity-50 before:content-[""] @3xl:before:hidden'
  return (
    <ol className="grid gap-7 @3xl:grid-cols-[7.5rem_repeat(3,minmax(0,1fr))] @3xl:gap-8">
      <li className={cn('flex items-center gap-3 @3xl:flex-col @3xl:items-start', link)}>
        {node(Microscope)}
        <span className="text-[14px] font-bold">Spectrometer</span>
      </li>
      {blocks.map(([title, Icon, claims], i) => (
        <li key={title} className={cn(i < blocks.length - 1 && link)}>
          <div className="flex items-center gap-3 @3xl:block">
            {node(Icon, !claims.length)}
            <h3 className="font-bold @3xl:mt-3">{title}</h3>
          </div>
          <div className="mt-2.5 pl-[3.25rem] text-[15px] @3xl:pl-0">
            {claims.length ? <ClaimList claims={claims} /> : (
              <p className="rounded-lg border border-dashed border-rule-strong px-3 py-2.5 text-[14px] italic text-ink-3">Not specified yet</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Spectrum({ ranges }: { ranges: Report['spectral_ranges'] }) {
  if (!ranges.length) return <Empty>No spectral range given</Empty>
  const windows = ranges.flatMap((s) => {
    const nm = parseRangeNm(s.range_text)
    return nm ? [{ label: s.method, nm }] : []
  })
  return (
    <>
      {windows.length > 0 && (
        <SpectralChart
          windows={windows}
          caption={<>
            Fiber ranges are approximate, read from the AFS fiber transmission figure <CitationChip c={{ source: 'S02', page: 6, label: 'S02 p.6' }} />.
            A nominal method range is not the range of a specific instrument, fiber or probe. Hover the chart to read wavelength and wavenumber.
          </>}
        />
      )}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-[14px]">
          <thead>
            <tr className="border-b border-rule text-[13px] text-ink-3">
              {['Method', 'Range', 'Note', 'Sources'].map((h) => <th key={h} scope="col" className="pb-2 pr-4 font-bold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {ranges.map((s, i) => (
              <tr key={i} className="border-b border-rule align-top">
                <th scope="row" className="py-3 pr-4 font-bold">{s.method}</th>
                <td className="py-3 pr-4"><RichText text={s.range_text} /></td>
                <td className="py-3 pr-4 text-ink-2"><RichText text={s.note} /></td>
                <td className="py-3"><Citations list={s.citations} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Plan({ fp }: { fp: Report['feasibility_plan'] }) {
  const list = (title: string, items: string[]) => (
    <div>
      <p className="subhead">{title}</p>
      {items.length ? (
        <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-3">{items.map((t, i) => <li key={i}><RichText text={t} /></li>)}</ul>
      ) : <Empty />}
    </div>
  )
  const steps = [...fp.steps].sort((a, b) => a.order - b.order)
  return (
    <div className="space-y-8">
      {fp.objective && <p className="prose-measure text-[17px] leading-relaxed"><RichText text={fp.objective} /></p>}
      <div className="grid gap-6 @xl:grid-cols-2">
        {list('Samples', fp.samples)}
        {list('Reference measurements', fp.reference_measurements)}
      </div>
      <div>
        <p className="subhead">Steps</p>
        {steps.length ? (
          <ol className="space-y-5">
            {steps.map((s, i) => (
              <li key={s.order} className={cn('relative grid grid-cols-[2.25rem_1fr] gap-4', i < steps.length - 1 && 'before:absolute before:bottom-[-1.25rem] before:left-[1.07rem] before:top-10 before:w-0.5 before:bg-rule-strong')}>
                <span className="display grid size-9 place-items-center rounded-full border-2 border-ink text-[15px]">{s.order}</span>
                <div className="pt-1">
                  <h3 className="font-bold leading-snug">{s.title}</h3>
                  <p className="prose-measure mt-1 text-ink-2"><RichText text={s.description} /> <Citations list={s.citations} /></p>
                </div>
              </li>
            ))}
          </ol>
        ) : <Empty />}
      </div>
      {fp.comparison && (
        <div>
          <p className="subhead">What is compared</p>
          <p className="prose-measure"><RichText text={fp.comparison} /></p>
        </div>
      )}
      {fp.go_no_go && (
        <div className="rounded-xl border-2 border-ink p-5">
          <p className="display flex items-center gap-2 text-[1.1rem]"><Scale size={19} aria-hidden /> Go / no-go decision</p>
          <p className="prose-measure mt-2 leading-relaxed"><RichText text={fp.go_no_go} /></p>
          <p className="mt-3 text-[13px] text-ink-3">Acceptance targets come from the customer. The assistant does not invent numbers.</p>
        </div>
      )}
    </div>
  )
}

const SOURCE_ORDER = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'TABLE', 'REF', 'EXT']

export function SourcesList({ r }: { r: Report }) {
  const { sources } = useData()
  const index = citationIndex(r)
  const rank = (id: string) => (SOURCE_ORDER.includes(id) ? SOURCE_ORDER.indexOf(id) : SOURCE_ORDER.indexOf('TABLE') - 0.5) // added sources (S07+) after S06
  const ids = [...new Set(index.map((x) => x.cite.source))].sort((a, b) => rank(a) - rank(b))
  const problems = index.flatMap(({ cite }) => {
    if (cite.source === 'EXT') return cite.quote && cite.url ? [] : [`${cite.label}: external citations need a URL and a quoted passage.`]
    const live = sources.find((s) => s.source_id === cite.source)
    const meta = sourceMeta(cite.source)
    if (!live && !meta) return [`${cite.label}: unknown source.`]
    const pages = live?.pages || meta?.pages
    return cite.page != null && pages && cite.page > pages ? [`${cite.label}: ${cite.source} has only ${pages} pages.`] : []
  })
  if (!index.length) return <Empty>No sources cited</Empty>
  return (
    <>
      {problems.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn-bg p-4 text-[14px]">
          <p className="flex items-center gap-1.5 font-bold text-warn"><TriangleAlert size={16} aria-hidden /> Citation check</p>
          <ul className="mt-1.5 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <ul className="divide-y divide-rule border-y border-rule">
        {ids.map((id) => {
          const meta = SOURCES.find((s) => s.source_id === id)
          const info = sources.find((s) => s.source_id === id)
          const level = id === 'EXT' ? 'external' : info?.evidence_level ?? meta?.evidence_level
          const items = index.filter((x) => x.cite.source === id).sort((a, b) => (a.cite.page ?? 0) - (b.cite.page ?? 0))
          return (
            <li key={id} className="grid gap-x-5 gap-y-2 py-4 @md:grid-cols-[4.5rem_1fr]">
              <span className="display text-[1.05rem]">{id === 'TABLE' ? 'Table' : id}</span>
              <div className="min-w-0">
                <p className="font-semibold leading-snug">
                  {id === 'EXT' ? 'External sources' : info?.title ?? meta?.title ?? id} {level && <EvidenceTag level={level} />}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-1 gap-y-2">
                  {items.map(({ cite, where }) => (
                    <span key={`${cite.label}${cite.url ?? ''}`} className="mr-3 inline-flex items-center">
                      <CitationChip c={cite} />
                      {where.size > 0 && <span className="ml-1 text-[13px] text-ink-3">{[...where].join(', ')}</span>}
                    </span>
                  ))}
                </div>
                {id === 'EXT' && items.map(({ cite }) => cite.quote && (
                  <blockquote key={cite.url} className="mt-2 border-l-2 border-clarifier pl-3 text-[14px] italic text-ink-2">“{cite.quote}”</blockquote>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function Verification({ v }: { v: Report['verification'] }) {
  if (!v.checks.length) return <Empty>No critic checks recorded</Empty>
  return (
    <ul className="divide-y divide-rule rounded-xl border border-rule">
      {v.checks.map((c, i) => (
        <li key={i} className="flex gap-3 px-4 py-3">
          {c.passed ? <CircleCheck size={17} className="mt-0.5 shrink-0 text-ok" aria-label="Passed" /> : <CircleX size={17} className="mt-0.5 shrink-0 text-bad" aria-label="Failed" />}
          <div>
            <p className="font-semibold">{c.name}</p>
            {c.details && <p className="text-[14px] text-ink-2">{c.details}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}
