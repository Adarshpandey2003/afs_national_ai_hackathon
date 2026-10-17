import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { Case, Health, OutputSummary, SourceInfo } from '../api/types'
import bundledCases from '../mock/cases.json'
import { session, setAuthRequired } from './auth'
import { SOURCES } from './kb'

export type HealthState =
  | { state: 'checking' | 'waking' | 'down'; since: number; error?: string }
  | { state: 'ok'; since: number; health: Health }

interface Data {
  health: HealthState
  retryHealth(): void
  /** Re-read the source list, e.g. after a document was added. */
  reloadSources(): void
  cases: Case[]
  sources: SourceInfo[]
  outputs: OutputSummary[]
  outputsLoaded: boolean
}

const Ctx = createContext<Data | null>(null)
const WAKE_LIMIT_MS = 90_000

export function DataProvider({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [health, setHealth] = useState<HealthState>({ state: 'checking', since: Date.now() })
  // Bundled copies keep presets and source names usable while a free-tier backend wakes up.
  const [cases, setCases] = useState<Case[]>(bundledCases as Case[])
  const [sources, setSources] = useState<SourceInfo[]>(SOURCES)
  const [outputs, setOutputs] = useState<OutputSummary[]>([])
  const [outputsLoaded, setOutputsLoaded] = useState(false)

  // frontend.md §4: retry /health every 5 s for up to 90 s, so a cold start reads as "waking up", not "broken".
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const since = Date.now()
    setHealth({ state: 'checking', since })
    const check = async () => {
      try {
        const h = await api.health()
        if (cancelled) return
        setAuthRequired(!!h.auth_required)
        setHealth({ state: 'ok', since, health: h })
      } catch (e) {
        if (cancelled) return
        const error = e instanceof Error ? e.message : String(e)
        if (Date.now() - since < WAKE_LIMIT_MS) {
          setHealth({ state: 'waking', since, error })
          timer = window.setTimeout(check, 5000)
        } else setHealth({ state: 'down', since, error })
      }
    }
    void check()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [attempt])

  const ready = health.state === 'ok'
  // Signing in (again) loads what a protected backend refused before.
  const signedIn = session.use() !== null
  useEffect(() => {
    if (!ready) return
    api.cases().then((c) => c.length && setCases(c), () => {})
    api.sources().then((s) => s.length && setSources(s), () => {})
    api.outputs().then(setOutputs, () => {}).finally(() => setOutputsLoaded(true))
  }, [ready, signedIn])

  const value = useMemo<Data>(
    () => ({
      health, retryHealth: () => setAttempt((a) => a + 1), cases, sources, outputs, outputsLoaded,
      reloadSources: () => { api.sources().then((s) => s.length && setSources(s), () => {}) },
    }),
    [health, cases, sources, outputs, outputsLoaded],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData() {
  const d = useContext(Ctx)
  if (!d) throw new Error('useData needs <DataProvider>')
  return d
}

export function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [active, every])
  return now
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
