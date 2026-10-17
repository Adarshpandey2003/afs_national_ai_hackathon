import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, CircleCheck, ExternalLink, TriangleAlert, X } from 'lucide-react'
import { api } from '../api'
import type { KbPage, SourceId } from '../api/types'
import { useData } from '../lib/data'
import { METHOD_TABLE, pdfUrl, sourceMeta, units } from '../lib/kb'
import { findQuote } from '../lib/report'
import { closeSource, drawerStore } from '../lib/ui-state'
import { EvidenceTag, Rating, cn } from './ui'

const PAGED = new Set<SourceId>(['S01', 'S02', 'S03', 'S04', 'S05'])
const cache = new Map<string, KbPage>()

/** S01 Table 1 as transcribed by the organizers (AFS_method_comparison_table.xlsx). */
export function MethodTable({ highlight }: { highlight?: string }) {
  let last = ''
  return (
    <div className="overflow-x-auto rounded-lg border border-rule">
      <table className="w-full min-w-[46rem] text-left text-[13px]">
        <thead className="bg-surface-2 text-[13px] text-ink-3">
          <tr>
            {['Method', 'Technique', 'Phenomenon', 'Sample type', 'Optical path', 'Sensitivity', 'Selectivity', 'Cost'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METHOD_TABLE.map((r, i) => {
            const first = r.method !== last
            last = r.method
            const hit = highlight && r.measurement_technique === highlight
            return (
              <tr key={i} className={cn(first && i > 0 && 'border-t border-rule', hit && 'bg-sourced-bg')}>
                <th scope="row" className="px-3 py-1.5 font-bold text-ink">{first ? r.method : ''}</th>
                <td className="px-3 py-1.5">{r.measurement_technique.replace('*', '')}</td>
                <td className="px-3 py-1.5 text-ink-2">{r.physical_phenomenon}</td>
                <td className="px-3 py-1.5 text-ink-2">{r.sample_type}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{units(r.optical_path_or_depth)}</td>
                <td className="px-3 py-1.5"><Rating value={r.sensitivity} /></td>
                <td className="px-3 py-1.5"><Rating value={r.selectivity} /></td>
                <td className="px-3 py-1.5"><Rating value={r.cost} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  const at = quote ? findQuote(text, quote) : null
  if (!at) return <>{text}</>
  return (
    <>
      {text.slice(0, at[0])}
      <mark className="rounded-sm bg-sourced-bg px-0.5 text-ink ring-1 ring-sourced/40">{text.slice(at[0], at[1])}</mark>
      {text.slice(at[1])}
    </>
  )
}

export function SourceDrawer() {
  const target = drawerStore.use()
  const { sources } = useData()
  const [page, setPage] = useState<number | null>(null)
  const [load, setLoad] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; data?: KbPage; error?: string }>({ status: 'idle' })
  const closeBtn = useRef<HTMLButtonElement>(null)

  // Reset the page during render when a new citation opens, so we never fetch the previous page.
  const [shown, setShown] = useState(target)
  if (target !== shown) {
    setShown(target)
    setPage(target && PAGED.has(target.source) ? target.page ?? 1 : null)
  }

  // Modal behaviour: background inert, focus moves in and back, Esc closes.
  useEffect(() => {
    if (!target) return
    const previous = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    if (root) root.inert = true
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSource()
    addEventListener('keydown', onKey)
    return () => {
      if (root) root.inert = false
      removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [target])

  useEffect(() => {
    if (!target || page == null) return
    const key = `${target.source}:${page}`
    const hit = cache.get(key)
    if (hit) return setLoad({ status: 'ok', data: hit })
    let cancelled = false
    setLoad({ status: 'loading' })
    api.page(target.source, page).then(
      (data) => {
        cache.set(key, data)
        if (!cancelled) setLoad({ status: 'ok', data })
      },
      (e: Error) => !cancelled && setLoad({ status: 'error', error: e.message }),
    )
    return () => { cancelled = true }
  }, [target, page])

  if (!target) return null
  const meta = sourceMeta(target.source === 'TABLE' ? 'S01' : target.source)
  const info = sources.find((s) => s.source_id === target.source)
  const total = info?.pages || meta?.pages || 0
  const level = target.source === 'EXT' ? 'external' : info?.evidence_level ?? sourceMeta(target.source)?.evidence_level
  const onCitedPage = page != null && page === target.page
  const text = load.data?.text ?? ''
  const found = onCitedPage && target.quote && load.status === 'ok' ? !!findQuote(text, target.quote) : null
  const pdf = pdfUrl(target.source === 'TABLE' ? 'S01' : target.source, target.source === 'TABLE' ? 6 : page)
  const title = target.source === 'TABLE' ? 'S01 Table 1: methods and measurement techniques'
    : load.data?.title && page ? load.data.title : info?.title ?? meta?.title ?? target.label ?? target.source

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgb(10_18_36/0.38)]" onClick={closeSource} aria-hidden />
      <aside
        role="dialog" aria-modal="true" aria-labelledby="drawer-title"
        className={cn('absolute right-0 top-0 flex h-full w-full flex-col border-l border-rule bg-surface shadow-2xl', target.source === 'TABLE' ? 'max-w-[56rem]' : 'max-w-[40rem]')}
      >
        <header className="flex items-start gap-4 border-b border-rule px-6 py-5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink-3">
              {target.source === 'TABLE' ? 'S01, page 6' : page ? `${target.source}, page ${page}${total ? ` of ${total}` : ''}` : target.source}
            </p>
            <h2 id="drawer-title" className="display mt-1 text-[1.3rem] leading-snug">{title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {level && <EvidenceTag level={level} />}
              {page != null && <span className="text-[13px] text-ink-3">{info?.title ?? meta?.title}</span>}
            </div>
          </div>
          <button ref={closeBtn} type="button" onClick={closeSource} className="btn btn-quiet -mr-2" aria-label="Close source">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {target.quote && (onCitedPage || page == null) && (
            <section className="mb-5 rounded-lg border border-rule bg-surface-2 p-4">
              <p className="subhead mb-1.5">Passage cited by the assistant</p>
              <blockquote className="text-[15px] italic leading-relaxed">“{target.quote}”</blockquote>
              {found === true && <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-ok"><CircleCheck size={15} /> Found on this page, highlighted below</p>}
              {found === false && <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-warn"><TriangleAlert size={15} /> Not found word for word on this page. Check the claim against the page.</p>}
            </section>
          )}

          {target.source === 'TABLE' && (
            <>
              <p className="mb-4 max-w-[60ch] text-ink-2">Qualitative ratings from the source document, not measured values or an AFS product specification.</p>
              <MethodTable />
            </>
          )}

          {target.source === 'EXT' && target.url && (
            <a className="btn btn-secondary" href={target.url} target="_blank" rel="noopener noreferrer">
              Open the external source <ExternalLink size={15} />
            </a>
          )}

          {page == null && target.source !== 'TABLE' && target.source !== 'EXT' && (
            <div className="space-y-3 text-ink-2">
              <p>{info?.description ?? meta?.description}</p>
              {meta?.url && <a className="btn btn-secondary" href={meta.url} target="_blank" rel="noopener noreferrer">Open {meta.url.replace(/^https?:\/\//, '')} <ExternalLink size={15} /></a>}
            </div>
          )}

          {page != null && load.status === 'loading' && (
            <div className="space-y-3" aria-busy="true" aria-label="Loading page text">
              {[92, 100, 84, 96, 70].map((w, i) => <div key={i} className="skeleton h-4" style={{ width: `${w}%` }} />)}
            </div>
          )}
          {page != null && load.status === 'error' && (
            <p className="rounded-lg border border-bad/40 bg-bad-bg p-4 text-bad">Couldn't load this page: {load.error}</p>
          )}
          {page != null && load.status === 'ok' && (
            <>
              {text.trim().length < 160 && target.source === 'S02' && (
                <p className="mb-4 rounded-lg bg-surface-2 p-3 text-[14px] text-ink-2">
                  The AFS slides are mostly images, so the extracted text is thin.{pdf ? ' Open the original slide to see the figure.' : ''}
                </p>
              )}
              <div className="max-w-[65ch] whitespace-pre-wrap text-[15px] leading-[1.7] text-ink">
                <Highlighted text={text} quote={onCitedPage ? target.quote : undefined} />
              </div>
            </>
          )}
        </div>

        {(page != null || pdf) && (
          <footer className="flex items-center gap-2 border-t border-rule px-4 py-3">
            {page != null && (
              <>
                <button type="button" className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                  <ChevronLeft size={18} />
                </button>
                <span className="text-[13px] tabular-nums text-ink-3">Page {page}{total ? ` of ${total}` : ''}</span>
                <button type="button" className="btn btn-quiet" disabled={!!total && page >= total} onClick={() => setPage(page + 1)} aria-label="Next page">
                  <ChevronRight size={18} />
                </button>
                {target.page != null && page !== target.page && (
                  <button type="button" className="btn btn-quiet text-[13px]" onClick={() => setPage(target.page)}>Back to cited page</button>
                )}
              </>
            )}
            {pdf && (
              <a className="btn btn-secondary ml-auto text-[13px]" href={pdf} target="_blank" rel="noopener noreferrer">
                Original PDF page <ExternalLink size={14} />
              </a>
            )}
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  )
}
