import {
  EVENT_TYPES,
  type Answer, type AssessmentSnapshot, type Case, type Health, type KbPage, type Mode,
  type OutputSummary, type Report, type RunEvent, type RunStatus, type SourceId, type SourceInfo,
} from './types'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Called with the number of consecutive connection failures (0 = connected) and whether the browser gave up. */
export type StreamTrouble = (failures: number, closed: boolean) => void

export interface Api {
  health(): Promise<Health>
  cases(): Promise<Case[]>
  startAssessment(body: { enquiry: string; mode: Mode; case_id?: string }): Promise<{ thread_id: string; status: RunStatus }>
  answer(threadId: string, body: { answers: Answer[]; proceed_with_assumptions: boolean }): Promise<{ thread_id: string; status: RunStatus }>
  snapshot(threadId: string): Promise<AssessmentSnapshot>
  subscribe(threadId: string, onEvent: (e: RunEvent) => void, onTrouble: StreamTrouble): () => void
  reportMarkdown(threadId: string): Promise<string>
  sources(): Promise<SourceInfo[]>
  page(sourceId: SourceId, page: number): Promise<KbPage>
  outputs(): Promise<OutputSummary[]>
  output(caseId: string): Promise<Report>
  addDocument(form: FormData): Promise<SourceInfo>
}

export function realApi(base: string): Api {
  async function request<T>(path: string, init?: RequestInit, as: 'json' | 'text' = 'json'): Promise<T> {
    let res: Response
    try {
      res = await fetch(base + path, {
        ...init,
        headers: { Accept: as === 'json' ? 'application/json' : 'text/markdown', ...(typeof init?.body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
      })
    } catch {
      throw new ApiError(0, 'network', 'Cannot reach the backend. It may still be waking up, or the URL or CORS settings are wrong.')
    }
    if (!res.ok) {
      let code = `http_${res.status}`
      let message = res.statusText || 'Request failed'
      try {
        const body = await res.json()
        if (body?.error) {
          code = body.error.code ?? code
          message = body.error.message ?? message
        } else if (body?.detail) message = typeof body.detail === 'string' ? body.detail : 'The request was not valid.'
      } catch { /* non-JSON error body */ }
      throw new ApiError(res.status, code, message)
    }
    return (as === 'json' ? res.json() : res.text()) as Promise<T>
  }
  const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
  const id = encodeURIComponent

  return {
    health: () => request('/health'),
    cases: () => request('/cases'),
    startAssessment: (body) => request('/assessments', post(body)),
    answer: (t, body) => request(`/assessments/${id(t)}/answers`, post(body)),
    snapshot: (t) => request(`/assessments/${id(t)}`),
    reportMarkdown: (t) => request(`/assessments/${id(t)}/report.md`, undefined, 'text'),
    sources: () => request('/kb/sources'),
    page: (s, p) => request(`/kb/${id(s)}/pages/${p}`),
    outputs: () => request('/outputs'),
    addDocument: (form) => request('/kb/documents', { method: 'POST', body: form }),
    output: (c) => request(`/outputs/${id(c)}`),

    subscribe(threadId, onEvent, onTrouble) {
      const es = new EventSource(`${base}/assessments/${id(threadId)}/events`)
      const seen = new Set<string>()
      let failures = 0
      const deliver = (type: RunEvent['type'], ev: MessageEvent) => {
        if (ev.lastEventId) {
          if (seen.has(ev.lastEventId)) return // replayed after a reconnect
          seen.add(ev.lastEventId)
        }
        try {
          onEvent({ type, data: JSON.parse(ev.data) } as RunEvent)
        } catch { /* ignore a malformed frame rather than kill the stream */ }
      }
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (ev) => {
          // The server's `event: error` and the browser's connection error share one event name.
          if (ev instanceof MessageEvent && typeof ev.data === 'string') return deliver(type, ev)
          if (type !== 'error') return
          failures++
          onTrouble(failures, es.readyState === EventSource.CLOSED)
        })
      }
      es.onopen = () => {
        failures = 0
        onTrouble(0, false)
      }
      return () => es.close()
    },
  }
}
