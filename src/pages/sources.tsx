import { MethodTable } from '../components/source-drawer'
import { SpectralChart } from '../components/spectral-chart'
import { CitationChip, EvidenceTag } from '../components/ui'
import { useData } from '../lib/data'
import kb from '../lib/kb-data.json'
import { FIBER_NOTE } from '../lib/kb'
import { openSource } from '../lib/ui-state'

const PAGED = ['S01', 'S02', 'S03', 'S04', 'S05']
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
                    onClick={() => openSource({ source: s.source_id, page: PAGED.includes(s.source_id) ? 1 : null })}
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
