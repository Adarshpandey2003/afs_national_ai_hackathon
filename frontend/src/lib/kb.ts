import data from './kb-data.json'
import type { Citation, EvidenceLevel, SourceInfo } from '../api/types'

// Static reference data transcribed from the supplied AFS materials (see kb-data.json).
export interface SourceMeta extends SourceInfo {
  short: string
  url: string
  page_topics: Record<string, string>
}

export const SOURCES = data.sources as SourceMeta[]
export const sourceMeta = (id: string) => SOURCES.find((s) => s.source_id === id)
export const pageTopic = (id: string, page: number | null) =>
  page == null ? undefined : sourceMeta(id)?.page_topics[String(page)]

export const EVIDENCE: Record<EvidenceLevel, { label: string; tone: 'info' | 'warn' | 'muted' | 'neutral' | 'ext' }> = {
  vendor_overview: { label: 'Vendor overview', tone: 'info' },
  vendor_slides: { label: 'Vendor slides', tone: 'info' },
  research_in_vitro_poc: { label: 'In vitro proof of concept', tone: 'warn' },
  research_lab_note: { label: 'Lab research note', tone: 'neutral' },
  business_context: { label: 'Business context', tone: 'muted' },
  expert_notes: { label: 'AFS expert notes', tone: 'neutral' },
  reference_doc: { label: 'Reference document', tone: 'neutral' },
  external: { label: 'External source', tone: 'ext' },
}

export interface MethodRow {
  method: string
  measurement_technique: string
  physical_phenomenon: string
  sample_type: string
  optical_path_or_depth: string
  sensitivity: string
  selectivity: string
  cost: string
}
export const METHOD_TABLE = data.method_table as MethodRow[]
export const TABLE_CITATION: Citation = { source: 'TABLE', page: null, label: 'S01 Table 1 (p.6)' }

export interface FiberFamily { name: string; detail: string; min_nm: number; max_nm: number }
export const FIBERS = data.fiber_families as FiberFamily[]
export const FIBER_NOTE = data.fiber_families_note

// The table writes micrometres as "um"; show the proper symbol.
export const units = (s: string) => s.replace(/(\d)\s*-\s*(\d)/g, '$1–$2').replace(/\bum\b/g, 'µm')

const TECHNIQUE_KEYS: [RegExp, RegExp][] = [
  [/atr/, /atr probe/i],
  [/sphere/, /integrating sphere/i],
  [/distance|stand-?off|non-?contact/, /surface at a distance/i],
  [/diffuse|reflect/, /diffuse reflection|sample surface/i],
  [/trans(mission|flection|flexion)/, /transmission or transflection/i],
  [/cuvette/, /cuvette/i],
  [/lens|emission/, /probe, lens/i],
  [/probe/, /probe/i],
]

// shortcut: keyword match of a recommendation onto the 19 rows of S01 Table 1; switch to a row id if the backend ever sends one.
export function tableRow(method: string, technique: string): MethodRow | undefined {
  const m = method.toLowerCase()
  if (m.includes('+')) return undefined
  const family = m.includes('raman') ? 'Raman'
    : m.includes('fluor') ? 'Fluorimetry'
    : /\bnir\b|near/.test(m) ? 'NIR'
    : /uv|vis/.test(m) ? 'UV/Visible'
    : /mir|mid|ftir|atr|\bir\b/.test(m) ? 'IR'
    : ''
  if (!family) return undefined
  const rows = METHOD_TABLE.filter((r) => r.method.startsWith(family))
  const t = technique.toLowerCase()
  for (const [want, row] of TECHNIQUE_KEYS) {
    if (!want.test(t)) continue
    const hit = rows.find((r) => row.test(r.measurement_technique))
    if (hit) return hit
  }
  return rows.find((r) => /probe/i.test(r.measurement_technique))
}

const MATERIALS = (import.meta.env.VITE_MATERIALS_URL ?? '').trim()

// Link to the original PDF page, only when a private materials location is configured.
export function pdfUrl(sourceId: string, page: number | null) {
  const meta = sourceMeta(sourceId)
  if (!MATERIALS || !meta?.file.endsWith('.pdf')) return null
  return `${MATERIALS.replace(/\/?$/, '/')}${meta.file}${page ? `#page=${page}` : ''}`
}
