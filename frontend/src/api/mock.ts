import { ApiError, type Api } from './client'
import type { Answer, AssessmentSnapshot, Citation, KbPage, Mode, Report, RunEvent, RunStatus, SourceId } from './types'
import { currentToken } from '../lib/auth'
import { SOURCES, pageTopic } from '../lib/kb'
import cases from '../mock/cases.json'
import users from '../mock/users.json'
import { D01, D02, SOIL } from '../mock/reports'

// In-browser stand-in for the backend (frontend.md §1–§2), used when VITE_API_BASE_URL is empty or "mock".
// It replays a scripted run for the brief's soil example, whatever enquiry is typed.

type Emit = RunEvent extends infer E ? E extends { type: infer T; data: infer D } ? [T, D] : never : never
interface Thread {
  id: string
  enquiry: string
  mode: Mode
  status: RunStatus
  events: (RunEvent & { id: string })[]
  listeners: Set<(e: RunEvent) => void>
  answers: Answer[]
  report?: Report
  resume?: () => void
}

const threads = new Map<string, Thread>()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const cite = (source: SourceId, page: number | null, label?: string): Citation =>
  ({ source, page, label: label ?? (page == null ? 'S01 Table 1 (p.6)' : `${source} p.${page}`) })

function emit(t: Thread, ...[type, data]: Emit) {
  const ev = { type, data, id: String(t.events.length + 1) } as RunEvent & { id: string }
  t.events.push(ev)
  if (type === 'status') t.status = (data as { status: RunStatus }).status
  t.listeners.forEach((f) => f(ev))
}

async function play(t: Thread, script: [number, ...Emit][]) {
  for (const [delay, type, data] of script) {
    await wait(delay)
    emit(t, ...([type, data] as Emit))
  }
}

const clarify = (t: Thread) =>
  play(t, [
    [500, 'status', { status: 'running', agent: 'clarifier' }],
    [300, 'agent_start', { agent: 'clarifier', round: 1 }],
    [900, 'agent_step', { agent: 'clarifier', step_type: 'thought', summary: 'Separating what the customer stated from what is still unknown.' }],
    [1200, 'agent_step', { agent: 'clarifier', step_type: 'note', summary: '3 stated facts and 6 key unknowns. "Remote" is not defined and changes the probe concept.' }],
  ])

const research = (t: Thread) =>
  play(t, [
    [600, 'status', { status: 'running', agent: 'researcher' }],
    [300, 'agent_start', { agent: 'researcher' }],
    [700, 'agent_step', { agent: 'researcher', step_type: 'tool_call', tool: 'search_kb', args: { query: 'fiber sensor moisture bulk material' }, summary: 'Looking for AFS moisture applications' }],
    [1100, 'agent_step', { agent: 'researcher', step_type: 'tool_result', summary: '2 passages', result_preview: 'S02 p.12 — IoT concept of an NIR-LED fiber sensor to control moisture level, shown on starch, flour, sugar and wood.\nS01 p.9 — LED probe moisture analyzer for bulk materials.', citations: [cite('S02', 12), cite('S01', 9)] }],
    [700, 'agent_step', { agent: 'researcher', step_type: 'tool_call', tool: 'search_kb', args: { query: 'silica fiber transmission range mid-IR' }, summary: 'Checking which fibers carry which wavelengths' }],
    [1000, 'agent_step', { agent: 'researcher', step_type: 'tool_result', summary: '1 figure', result_preview: 'S02 p.6 — Transmission for different fibers in 0.2–18 µm: Vis-NIR silica 350–2400 nm, chalcogenide 1.1–6.5 µm, PIR 3–17 µm, hollow waveguides 2–18 µm.', citations: [cite('S02', 6)] }],
    [600, 'agent_step', { agent: 'researcher', step_type: 'tool_call', tool: 'lookup_method_table', args: { method: 'NIR', technique: 'diffuse reflection probe' }, summary: '' }],
    [800, 'agent_step', { agent: 'researcher', step_type: 'tool_result', summary: '1 row', result_preview: 'NIR · diffuse reflection probe · scattering media, powder · 0.5–1 mm · sensitivity average · selectivity average · cost average', citations: [cite('TABLE', null)] }],
    [600, 'agent_step', { agent: 'researcher', step_type: 'tool_call', tool: 'search_kb', args: { query: 'hydrocarbon bands mid-infrared' }, summary: '' }],
    [900, 'agent_step', { agent: 'researcher', step_type: 'tool_result', summary: '1 passage', result_preview: 'S02 p.18 — Spectral bands for IoT sensors: moisture at 1.3–2.2 µm, hydrocarbons and CO2 at 3.0–4.5 µm.', citations: [cite('S02', 18)] }],
    [800, 'agent_step', { agent: 'researcher', step_type: 'thought', summary: 'Mid-IR needs IR fibers; silica cannot carry it. NIR is the safer first test for moisture.' }],
  ])

const write = (t: Thread) =>
  play(t, [
    [500, 'status', { status: 'running', agent: 'writer' }],
    [300, 'agent_start', { agent: 'writer', revision: 1 }],
    [1100, 'agent_step', { agent: 'writer', step_type: 'note', summary: 'Drafting the assessment from 9 retrieved passages.' }],
    [1300, 'draft_ready', { revision: 1 }],
    [400, 'status', { status: 'running', agent: 'critic' }],
    [300, 'agent_start', { agent: 'critic', revision: 1 }],
    [800, 'agent_step', { agent: 'critic', step_type: 'tool_call', tool: 'check_citations', args: { revision: 1 }, summary: '' }],
    [1200, 'critic_result', { revision: 1, passed: false, issues: [
      { check: 'unsupported_figure', severity: 'error', message: 'The draft gives a 0.1 % hydrocarbon detection limit that no source supports.' },
      { check: 'citation_scope', severity: 'warning', message: 'S03 is an in vitro kidney study and cannot support a soil claim.' },
    ] }],
    [500, 'status', { status: 'running', agent: 'writer' }],
    [300, 'agent_start', { agent: 'writer', revision: 2 }],
    [1000, 'agent_step', { agent: 'writer', step_type: 'note', summary: 'Removed the detection limit and the S03 citation.' }],
    [900, 'draft_ready', { revision: 2 }],
    [400, 'status', { status: 'running', agent: 'critic' }],
    [300, 'agent_start', { agent: 'critic', revision: 2 }],
    [700, 'agent_step', { agent: 'critic', step_type: 'tool_call', tool: 'check_citations', args: { revision: 2 }, summary: '' }],
    [900, 'critic_result', { revision: 2, passed: true, issues: [] }],
  ])

async function finish(t: Thread, started: number) {
  await research(t)
  await write(t)
  t.report = {
    ...SOIL,
    user_answers: t.answers,
    meta: { ...SOIL.meta, mode: t.mode, generated_at: new Date().toISOString(), duration_s: Math.round((Date.now() - started) / 1000) },
  }
  await play(t, [
    [400, 'report', { report: t.report }],
    [200, 'status', { status: 'completed' }],
    [100, 'done', { status: 'completed' }],
  ])
}

function get(id: string) {
  const t = threads.get(id)
  if (!t) throw new ApiError(404, 'not_found', 'This run is not available. Mock runs live only in this browser tab.')
  return t
}

const outputs: Record<string, Report> = { D01, D02 }

// Sign-in as the backend does it (AUTH.md), with the demo accounts in mock/users.json. The token is an unsigned stand-in.
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const TTL_S = 8 * 3600
const guard = () => {
  if (!currentToken()) throw new ApiError(401, 'unauthorized', 'Sign in to continue.')
}

export const mockApi: Api = {
  async health() {
    await wait(250)
    return { status: 'ok', version: 'mock', llm_ready: false, mock_mode: true, auth_required: true }
  },
  async login({ username, password }) {
    await wait(400)
    const u = users.find((x) => x.username === username.trim().toLowerCase() && x.password === password)
    if (!u) throw new ApiError(401, 'invalid_credentials', 'Wrong username or password.')
    const exp = Math.floor(Date.now() / 1000) + TTL_S
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: u.username, name: u.name, exp })}.mock`
    return { access_token: token, token_type: 'bearer', expires_in: TTL_S, user: { name: u.name } }
  },
  async cases() {
    guard()
    return cases as Awaited<ReturnType<Api['cases']>>
  },
  async startAssessment({ enquiry, mode }) {
    guard()
    await wait(400)
    if (enquiry.trim().length < 20 || enquiry.length > 4000)
      throw new ApiError(422, 'validation_error', 'The enquiry must be 20–4000 characters.')
    const t: Thread = { id: `mock-${Date.now().toString(36)}`, enquiry, mode, status: 'running', events: [], listeners: new Set(), answers: [] }
    threads.set(t.id, t)
    const started = Date.now()
    void clarify(t).then(() => {
      if (mode === 'batch') {
        emit(t, 'agent_step', { agent: 'clarifier', step_type: 'note', summary: 'Batch mode: unknowns are recorded as assumptions instead of asked.' })
        return finish(t, started)
      }
      emit(t, 'clarification_needed', {
        round: 1, max_rounds: 2, questions: SOIL.clarification_questions,
        stated_facts: SOIL.requirements.stated_facts, key_unknowns: SOIL.requirements.key_unknowns, assumptions: SOIL.assumptions,
      })
      emit(t, 'status', { status: 'awaiting_clarification', agent: 'clarifier' })
      t.resume = () => void finish(t, started)
    })
    return { thread_id: t.id, status: 'running' }
  },
  async answer(id, { answers }) {
    guard()
    await wait(300)
    const t = get(id)
    if (t.status !== 'awaiting_clarification')
      throw new ApiError(409, 'invalid_state', 'The run is not waiting for answers.')
    t.answers = answers
    emit(t, 'agent_step', { agent: 'clarifier', step_type: 'note', summary: answers.length ? `Received ${answers.length} answer${answers.length > 1 ? 's' : ''}.` : 'Proceeding with the listed assumptions.' })
    emit(t, 'status', { status: 'running', agent: 'clarifier' })
    t.resume?.()
    return { thread_id: id, status: 'running' }
  },
  async snapshot(id): Promise<AssessmentSnapshot> {
    guard()
    await wait(200)
    const t = get(id)
    const ask = [...t.events].reverse().find((e) => e.type === 'clarification_needed')
    return {
      thread_id: t.id, status: t.status, enquiry: t.enquiry, mode: t.mode, report: t.report,
      ...(t.status === 'awaiting_clarification' && ask?.type === 'clarification_needed'
        ? { clarification: { round: ask.data.round, max_rounds: ask.data.max_rounds, questions: ask.data.questions } }
        : {}),
    }
  },
  subscribe(id, onEvent, onTrouble) {
    const t = threads.get(id)
    if (!t) {
      setTimeout(() => onTrouble(3, true))
      return () => {}
    }
    setTimeout(() => {
      onTrouble(0, false)
      t.events.forEach(onEvent) // replay, like the server does for a new connection
      t.listeners.add(onEvent)
    })
    return () => { t.listeners.delete(onEvent) }
  },
  async reportMarkdown(id) {
    guard()
    const r = get(id).report
    if (!r) throw new ApiError(409, 'invalid_state', 'The report is not ready yet.')
    return `# Assessment (mock)\n\nStatus: ${r.decision_status}\n\n${r.summary}\n\nThe real backend serves the full Markdown export.\n`
  },
  async sources() {
    guard()
    return SOURCES.map(({ source_id, title, file, pages, evidence_level, description }) => ({ source_id, title, file, pages, evidence_level, description }))
  },
  async page(source, page): Promise<KbPage> {
    guard()
    await wait(250)
    const meta = SOURCES.find((s) => s.source_id === source)
    if (!meta || page < 1 || (meta.pages && page > meta.pages)) throw new ApiError(404, 'not_found', `${source} has no page ${page}.`)
    const topic = pageTopic(source, page) ?? meta.title
    const quote = QUOTES[`${source}:${page}`]
    return {
      source_id: source, page, title: topic, evidence_level: meta.evidence_level,
      text: `${quote ? `${quote} …\n\n` : ''}Mock page text for ${source} p.${page} (${topic}). The backend serves the extracted text of each page.`,
    }
  },
  async outputs() {
    guard()
    await wait(200)
    return Object.values(outputs).map((r) => ({ case_id: r.case_id!, generated_at: r.meta.generated_at, decision_status: r.decision_status }))
  },
  async output(caseId) {
    guard()
    await wait(250)
    const r = outputs[caseId]
    if (!r) throw new ApiError(404, 'not_found', `No precomputed report for ${caseId}.`)
    return r
  },
}

// Short excerpts so the mock drawer can show quote highlighting.
const QUOTES: Record<string, string> = {
  'S01:10': 'NIR spectra (780–2500 nm) contain predominantly overtones',
  'S02:7': 'Robust 100-300m cables made with Silica fibers of low OH-content',
}
