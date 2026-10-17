import type { Citation, Claim, DecisionStatus, Report } from '../api/types'

export type Kind = Claim['kind']

export const KIND: Record<Kind, { label: string; hint: string }> = {
  fact: { label: 'Fact', hint: 'Stated by the customer' },
  sourced: { label: 'Sourced', hint: 'Backed by a cited AFS source' },
  assumption: { label: 'Assumption', hint: 'Working assumption, not confirmed' },
  inference: { label: 'Inference', hint: 'Reasoning without a direct source' },
}

export const STATUS: Record<DecisionStatus, { label: string; short: string }> = {
  provisional: { label: 'Provisional assessment', short: 'Provisional' },
  insufficient_information: { label: 'Insufficient information', short: 'Insufficient info' },
  outside_supported_scope: { label: 'Outside supported scope', short: 'Outside scope' },
}

const arr = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : [])
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const citeLabel = (c: Citation) =>
  c.label || (c.source === 'TABLE' ? 'S01 Table 1 (p.6)' : c.page != null ? `${c.source} p.${c.page}` : c.source)

// The spec gives TABLE citations page null; the backend sends 6 (Table 1 sits on S01 p.6).
const cites = (v: Citation[] | null | undefined) =>
  arr(v).map((c) => ({ ...c, page: c.source === 'TABLE' ? null : c.page, label: citeLabel(c) }))
const claims = (v: Claim[] | null | undefined) =>
  arr(v).map((c) => ({ ...c, text: str(c.text), kind: c.kind in KIND ? c.kind : 'inference', citations: cites(c.citations) }))

/** Fill every array/string the views rely on, so a partial backend payload never crashes the UI. */
export function normalizeReport(r: Report): Report {
  const req = r.requirements ?? ({} as Report['requirements'])
  const mc = r.measurement_concept ?? ({} as Report['measurement_concept'])
  const fp = r.feasibility_plan ?? ({} as Report['feasibility_plan'])
  const ver = r.verification ?? ({} as Report['verification'])
  return {
    ...r,
    enquiry: str(r.enquiry),
    decision_status: r.decision_status in STATUS ? r.decision_status : 'insufficient_information',
    decision_rationale: str(r.decision_rationale),
    summary: str(r.summary),
    requirements: {
      stated_facts: claims(req.stated_facts),
      key_unknowns: arr(req.key_unknowns),
      client_premises: arr(req.client_premises).map((p) => ({ ...p, citations: cites(p.citations) })),
    },
    clarification_questions: arr(r.clarification_questions),
    assumptions: arr(r.assumptions),
    user_answers: arr(r.user_answers),
    recommendations: arr(r.recommendations).map((m) => ({
      ...m,
      technique: str(m.technique),
      rationale: claims(m.rationale),
      conditions: arr(m.conditions),
      citations: cites(m.citations),
    })),
    measurement_concept: {
      probe_geometry: claims(mc.probe_geometry),
      location: claims(mc.location),
      fiber_link: claims(mc.fiber_link),
    },
    spectral_ranges: arr(r.spectral_ranges).map((s) => ({ ...s, note: str(s.note), citations: cites(s.citations) })),
    risks: claims(r.risks),
    feasibility_plan: {
      objective: str(fp.objective),
      samples: arr(fp.samples),
      reference_measurements: arr(fp.reference_measurements),
      steps: arr(fp.steps).map((s, i) => ({ ...s, order: s.order ?? i + 1, citations: cites(s.citations) })),
      comparison: str(fp.comparison),
      go_no_go: str(fp.go_no_go),
    },
    sources: cites(r.sources),
    verification: { passed: !!ver.passed, revisions: ver.revisions ?? 0, checks: arr(ver.checks) },
    meta: r.meta ?? { model: '', mode: 'batch', generated_at: '', duration_s: 0 },
  }
}

export const allClaims = (r: Report): Claim[] => [
  ...r.requirements.stated_facts,
  ...r.recommendations.flatMap((m) => m.rationale),
  ...r.measurement_concept.probe_geometry,
  ...r.measurement_concept.location,
  ...r.measurement_concept.fiber_link,
  ...r.risks,
]

export function countKinds(r: Report) {
  const n: Record<Kind, number> = { fact: 0, sourced: 0, assumption: r.assumptions.length, inference: 0 }
  for (const c of allClaims(r)) n[c.kind]++
  return n
}

const key = (c: Citation) => `${c.source}|${c.page ?? ''}|${c.url ?? ''}`

/** Every citation in the report, de-duplicated, with the sections that use it. */
export function citationIndex(r: Report) {
  const map = new Map<string, { cite: Citation; where: Set<string> }>()
  const add = (where: string, list: Citation[]) => {
    for (const c of list) {
      const k = key(c)
      const hit = map.get(k)
      if (hit) {
        hit.where.add(where)
        if (!hit.cite.quote && c.quote) hit.cite = c
      } else map.set(k, { cite: c, where: new Set(where ? [where] : []) })
    }
  }
  r.requirements.client_premises.forEach((p) => add('Premise check', p.citations))
  r.requirements.stated_facts.forEach((c) => add('Requirements', c.citations))
  r.recommendations.forEach((m) => {
    add('Methods', m.citations)
    m.rationale.forEach((c) => add('Methods', c.citations))
  })
  Object.values(r.measurement_concept).forEach((list) => list.forEach((c) => add('Concept', c.citations)))
  r.spectral_ranges.forEach((s) => add('Spectral range', s.citations))
  r.risks.forEach((c) => add('Risks', c.citations))
  r.feasibility_plan.steps.forEach((s) => add('Plan', s.citations))
  add('', r.sources)
  return [...map.values()]
}

/** Inline references like "[S01 p.14–15]", "[S01 Table 1 (p.6)]", or several in one: "[S01 p.14, S04 p.1, 3]". */
const INLINE = /\[(?:S0[1-6]|REF)\b[^\]]*\]/g
export function splitInlineCitations(text: string): (string | Citation)[] {
  const out: (string | Citation)[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    out.push(text.slice(last, m.index))
    let source = ''
    for (const part of m[0].slice(1, -1).split(',').map((p) => p.trim())) {
      const own = /^(S0[1-6]|REF)\b/.exec(part)?.[1]
      source = own ?? source // a bare "p.14" or "3" belongs to the source before it
      const page = /(?:^|p\.\s*)(\d+)/.exec(part)
      out.push(source === 'S01' && /table\s*1\b/i.test(part)
        ? { source: 'TABLE', page: null, label: 'S01 Table 1 (p.6)' }
        : { source: source as Citation['source'], page: page ? Number(page[1]) : null, label: own ? part : /^\d/.test(part) ? `${source} p.${part}` : `${source} ${part}` })
    }
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return out.filter((p) => p !== '')
}

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[–—-]/g, '[–—-]').replace(/['’‘]/g, "['’‘]")

/** Locate a quoted passage in page text, tolerating whitespace, case and dash differences. */
export function findQuote(text: string, quote: string): [number, number] | null {
  const words = quote.trim().replace(/^["“]|["”]$/g, '').split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const m = new RegExp(words.map(esc).join('\\s+'), 'i').exec(text)
  return m ? [m.index, m.index + m[0].length] : null
}

if (import.meta.env.DEV) {
  console.assert(findQuote('NIR spectra (780–2500 nm) contain', 'spectra (780-2500 nm)') !== null, 'findQuote')
  const parts = splitInlineCitations('Supported [S01 p.14–15] and [S01 Table 1 (p.6)].')
  console.assert(parts.length === 5 && (parts[1] as Citation).page === 14 && (parts[3] as Citation).source === 'TABLE', 'inline citations')
  const many = splitInlineCitations('[S01 Table 1 (p.6), S02 p.8, p.14] [S04 p.1, 3] [S01 p.16, Table 1 (p.6)]').filter((p) => typeof p !== 'string') as Citation[]
  console.assert(many.map((c) => `${c.source}${c.page ?? ''}`).join() === 'TABLE,S028,S0214,S041,S043,S0116,TABLE', 'several citations in one bracket')
}
