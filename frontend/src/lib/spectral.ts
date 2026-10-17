// Wavelength helpers for the spectral-fit chart. Everything is in nanometres internally.

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const RANGE = new RegExp(
  `${NUM}\\s*(?:–|—|−|-|to)\\s*${NUM}\\s*(nm|µm|μm|um|microns?|cm(?:-1|⁻¹|−1|\\^-1))`,
  'i',
)

const num = (s: string) => (/^\d{1,3},\d{3}$/.test(s) ? Number(s.replace(',', '')) : Number(s.replace(',', '.')))

/** First "a–b unit" range in a free-text range description, converted to nm. */
export function parseRangeNm(text: string): [number, number] | null {
  const m = RANGE.exec(text)
  if (!m) return null
  let a = num(m[1])
  let b = num(m[2])
  const unit = m[3].toLowerCase()
  if (unit.startsWith('cm')) {
    a = 1e7 / a
    b = 1e7 / b
  } else if (unit !== 'nm') {
    a *= 1000
    b *= 1000
  }
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return lo > 0 && Number.isFinite(hi) && hi > lo ? [lo, hi] : null
}

/** Share of the window (on a log axis) that the fiber transmits: 0..1. */
export function coverage(win: [number, number], fiber: [number, number]) {
  const lo = Math.max(win[0], fiber[0])
  const hi = Math.min(win[1], fiber[1])
  if (hi <= lo) return 0
  return Math.log(hi / lo) / Math.log(win[1] / win[0])
}

export const fmtWavelength = (nm: number) =>
  nm < 1000 ? `${Math.round(nm)} nm` : `${(nm / 1000).toFixed(nm < 10000 ? 2 : 1)} µm`

export const fmtWavenumber = (nm: number) => `${Math.round(1e7 / nm / 10) * 10} cm⁻¹`

export const fmtRange = ([a, b]: [number, number]) =>
  b <= 2500 ? `${Math.round(a)}–${Math.round(b)} nm` : `${+(a / 1000).toFixed(2)}–${+(b / 1000).toFixed(1)} µm`

if (import.meta.env.DEV) {
  const eq = (text: string, want: [number, number] | null) => {
    const got = parseRangeNm(text)?.map(Math.round) ?? null
    console.assert(JSON.stringify(got) === JSON.stringify(want), 'parseRangeNm', text, got)
  }
  eq('780–2500 nm (nominal method range)', [780, 2500])
  eq('4000–400 cm⁻¹ (2.5–25 µm, nominal)', [2500, 25000])
  eq('2.5-25 µm', [2500, 25000])
  eq('25,000 - 400 nm', [400, 25000])
  eq('785 nm excitation', null)
  console.assert(coverage([780, 2500], [350, 2400]) > 0.9 && coverage([2500, 25000], [350, 2400]) === 0, 'coverage')
}

/** The wavelength window stated for a method in the report's spectral ranges (none for combinations). */
export function windowFor(method: string, ranges: { method: string; range_text: string }[]): [number, number] | null {
  const m = method.toLowerCase().trim()
  if (m.includes('+')) return null
  const hit = ranges.find((r) => r.method.toLowerCase().trim() === m)
    ?? ranges.find((r) => { const n = r.method.toLowerCase().trim(); return !n.includes('+') && (n.includes(m) || m.includes(n)) })
  return hit ? parseRangeNm(hit.range_text) : null
}
