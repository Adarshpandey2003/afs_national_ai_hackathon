import { MethodTable } from '../components/source-drawer'
import { SpectralChart } from '../components/spectral-chart'
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import type { EvidenceLevel } from '../api/types'
import { CitationChip, EvidenceTag } from '../components/ui'
import { useData } from '../lib/data'
import kb from '../lib/kb-data.json'
import { FIBER_NOTE } from '../lib/kb'
import { openSource } from '../lib/ui-state'

const NOMINAL = Object.entries(kb.method_ranges).map(([name, r]) => ({ label: name === 'MIR' ? 'Mid-IR' : name, nm: [r.min_nm, r.max_nm] as [number, number] }))

export function SourcesPage() {
  const { sources } = useData()
  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-5xl px-5 pb-16 pt-6 lg:px-8">
      <h1 className="display text-[clamp(1.7rem,3vw,2.3rem)] leading-tight">Knowledge base</h1>
      <p className="mt-3 max-w-[62ch] text-[16.5px] leading-relaxed text-ink-2">
        The AFS materials behind every recommendation. Open a source to read its pages as the assistant sees them.
      </p>

      <div className="mt-8 overflow-x-auto rounded-xl border border-rule bg-surface">
        <table className="w-full min-w-[44rem] text-left">
          <thead className="bg-surface-2 text-[12.5px] text-ink-3">
            <tr>
              {['ID', 'Source', 'Evidence level', 'Pages'].map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-bold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source_id} className="border-t border-rule align-top">
                <td className="display px-4 py-3.5 text-[1.02rem]">{s.source_id === 'TABLE' ? 'Table' : s.source_id}</td>
                <td className="px-4 py-3.5">
                  <button
                    type="button" className="text-left font-semibold leading-snug underline-offset-2 hover:underline" aria-haspopup="dialog"
                    onClick={() => openSource({ source: s.source_id, page: s.pages > 0 ? 1 : null })}
                  >
                    {s.title}
                  </button>
                  <p className="mt-1 max-w-[70ch] text-[13.5px] leading-snug text-ink-3">{s.description}</p>
                </td>
                <td className="px-4 py-3.5"><EvidenceTag level={s.evidence_level} /></td>
                <td className="px-4 py-3.5 tabular-nums text-ink-2">{s.pages || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddDocument />

      <section aria-labelledby="fibers-h" className="mt-14">
        <h2 id="fibers-h" className="display text-[1.3rem]">Fiber transmission ranges</h2>
        <p className="mt-1 max-w-[65ch] text-[14.5px] text-ink-3">
          The fiber decides which wavelengths reach the probe. Pick a nominal method range to see which fiber families can carry it.
        </p>
        <div className="mt-5 rounded-xl border border-rule bg-surface p-5">
          <SpectralChart
            windows={NOMINAL}
            caption={<>{FIBER_NOTE} <CitationChip c={{ source: 'S02', page: 6, label: 'S02 p.6' }} /> Nominal ranges: NIR <CitationChip c={{ source: 'S01', page: 10, label: 'S01 p.10' }} />, mid-IR <CitationChip c={{ source: 'S01', page: 9, label: 'S01 p.9' }} />.</>}
          />
        </div>
      </section>

      <section aria-labelledby="methods-h" className="mt-14">
        <h2 id="methods-h" className="display text-[1.3rem]">Methods and measurement techniques</h2>
        <p className="mt-1 max-w-[65ch] text-[14.5px] text-ink-3">
          S01 Table 1, as transcribed by the organizers. The ratings are the source document’s qualitative judgements, not measured values.
        </p>
        <div className="mt-5 bg-surface"><MethodTable /></div>
      </section>
    </div>
    </div>
  )
}

const LEVELS: EvidenceLevel[] = ['expert_notes', 'vendor_overview', 'vendor_slides', 'research_lab_note', 'research_in_vitro_poc', 'business_context']

/** Adds a PDF, TXT or MD file to the knowledge base (POST /kb/documents). The next assessment can cite it. */
function AddDocument() {
  const { reloadSources } = useData()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setBusy(true)
    setMsg(null)
    try {
      const s = await api.addDocument(new FormData(form))
      setMsg({ ok: true, text: `Added ${s.source_id} (${s.pages} page${s.pages === 1 ? '' : 's'}): ${s.title}` })
      form.reset()
      reloadSources()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-lg border border-rule bg-surface px-3 py-2 text-[14.5px]'
  return (
    <section aria-labelledby="add-h" className="mt-10 rounded-xl border border-rule bg-surface p-5">
      <h2 id="add-h" className="display text-[1.3rem]">Add a document</h2>
      <p className="mt-1 max-w-[65ch] text-[14.5px] text-ink-3">
        New application notes, papers or AFS project experience (PDF, TXT or MD). It is searchable and citable by the next assessment.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-[13px] font-semibold text-ink-2">Title
          <input name="title" required minLength={3} className={field} placeholder="e.g. AFS notes: beer fermentation trials" />
        </label>
        <label className="text-[13px] font-semibold text-ink-2">Evidence level
          <select name="evidence_level" className={field} defaultValue="expert_notes">
            {LEVELS.map((l) => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="text-[13px] font-semibold text-ink-2 sm:col-span-2">Scope note (optional)
          <input name="scope_note" className={field} placeholder="What this source can and cannot support" />
        </label>
        <label className="text-[13px] font-semibold text-ink-2">File
          <input name="file" type="file" required accept=".pdf,.txt,.md" className={field} />
        </label>
        <label className="text-[13px] font-semibold text-ink-2">Image transcription (PDF)
          <select name="ocr" className={field} defaultValue="none">
            <option value="none">none (text PDF)</option>
            <option value="figures">figures</option>
            <option value="slides">every page (slides / scans)</option>
          </select>
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-[14px] font-bold text-surface disabled:opacity-50">
            {busy ? 'Adding…' : 'Add to knowledge base'}
          </button>
          {msg && <p role="status" className={msg.ok ? 'text-[14px] text-ok' : 'text-[14px] text-warn'}>{msg.text}</p>}
        </div>
      </form>
    </section>
  )
}
