import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { FIBERS } from '../lib/kb'
import { coverage, fmtRange, fmtWavelength, fmtWavenumber } from '../lib/spectral'
import { cn } from './ui'

// The signature view: recommended method windows against the AFS fiber families (S02 p.6),
// on a log wavelength axis with wavenumbers on top. Echoes the AFS fiber-transmission slide.

export interface SpectralWindow { label: string; nm: [number, number] }

const MIN = 180
const MAX = 26000
const BOTTOM_TICKS: [number, string][] = [[200, '200 nm'], [400, '400'], [700, '700'], [1000, '1 µm'], [2500, '2.5'], [5000, '5'], [10000, '10'], [20000, '20 µm']]
const TOP_TICKS: [number, string][] = [[10000, '10 000'], [4000, '4000'], [2000, '2000'], [1000, '1000'], [500, '500 cm⁻¹']]
const REGIONS: [string, number, number][] = [['UV', MIN, 380], ['Vis', 380, 780], ['NIR', 780, 2500], ['Mid-IR', 2500, MAX]]

// `bar` is a brighter fill for the coverage segment; `color` stays text-safe for the label.
function verdict(share: number) {
  if (share >= 0.98) return { text: 'Covers', color: 'var(--ok)', bar: 'var(--ok)' }
  if (share > 0) return { text: `Partial, ${Math.round(share * 100)}%`, color: 'var(--warn)', bar: 'var(--warn-bar)' }
  return { text: 'No overlap', color: 'var(--bad)', bar: 'var(--bad)' }
}

export function SpectralChart({ windows, caption }: { windows: SpectralWindow[]; caption?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [selected, setSelected] = useState(0)
  const [hoverX, setHoverX] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    setWidth(el.clientWidth)
    // Whole pixels: a fractional SVG width can trigger a needless horizontal scrollbar.
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = Math.max(width, 560)
  const left = 158
  const right = 118
  const x0 = left
  const x1 = W - right
  const x = (nm: number) => x0 + (Math.log(nm / MIN) / Math.log(MAX / MIN)) * (x1 - x0)
  const nmAt = (px: number) => MIN * Math.pow(MAX / MIN, (px - x0) / (x1 - x0))

  const bandY = 20
  const methodsY = 50
  const methodRow = 22
  const fibersY = methodsY + windows.length * methodRow + (windows.length ? 14 : 4)
  const fiberRow = 27
  const axisY = fibersY + FIBERS.length * fiberRow + 6
  const H = axisY + 26
  const sel = selected < windows.length ? selected : 0
  const win = windows[sel]

  const summary = win
    ? `Fiber coverage for ${win.label}, ${fmtRange(win.nm)}: ${FIBERS.map((f) => `${f.name} ${verdict(coverage(win.nm, [f.min_nm, f.max_nm])).text}`).join('; ')}.`
    : `Approximate fiber transmission ranges: ${FIBERS.map((f) => `${f.name} ${fmtRange([f.min_nm, f.max_nm])}`).join('; ')}.`

  return (
    <figure>
      {windows.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Check fiber coverage for">
          <span className="text-[13px] font-semibold text-ink-3">Check fiber coverage for</span>
          {windows.map((w, i) => (
            <button
              key={w.label} type="button" aria-pressed={i === sel} onClick={() => setSelected(i)}
              className={cn('rounded-md border px-2.5 py-1 text-[13px] font-semibold transition-colors', i === sel ? 'border-ink bg-ink text-surface' : 'border-rule-strong text-ink-2 hover:border-ink-3')}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}
      <div ref={wrap} className="overflow-x-auto">
        <svg
          width={W} height={H} role="img" aria-label={summary} className="block select-none"
          onMouseMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left
            setHoverX(px >= x0 && px <= x1 ? px : null)
          }}
          onMouseLeave={() => setHoverX(null)}
        >
          <defs>
            <linearGradient id="visible-band" x1="0" x2="1">
              {['#7a3fd0', '#2f6fe4', '#12a3b8', '#23a55a', '#e3b505', '#f08a24', '#d7263d'].map((c, i) => (
                <stop key={c} offset={i / 6} stopColor={c} />
              ))}
            </linearGradient>
          </defs>

          {/* wavenumber axis */}
          {TOP_TICKS.map(([k, label]) => (
            <text key={k} x={x(1e7 / k)} y={12} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{label}</text>
          ))}

          {/* spectral regions */}
          {REGIONS.map(([name, a, b]) => (
            <g key={name}>
              <rect x={x(a)} y={bandY} width={x(b) - x(a)} height={16} rx={name === 'UV' ? 3 : 0}
                fill={name === 'Vis' ? 'url(#visible-band)' : name === 'NIR' ? 'var(--surface-2)' : 'var(--surface-3)'} />
              <text x={(x(a) + x(b)) / 2} y={bandY + 12} textAnchor="middle" fontSize="11" fontWeight="700"
                fill={name === 'Vis' ? '#fff' : 'var(--ink-2)'}>{name}</text>
            </g>
          ))}

          {/* gridlines */}
          {BOTTOM_TICKS.map(([nm]) => (
            <line key={nm} x1={x(nm)} x2={x(nm)} y1={bandY + 16} y2={axisY} stroke="var(--rule)" strokeDasharray="2 4" />
          ))}

          {/* selected method column */}
          {win && (
            <rect x={x(win.nm[0])} y={methodsY - 6} width={x(win.nm[1]) - x(win.nm[0])} height={axisY - methodsY + 6}
              fill="color-mix(in oklab, var(--focus) 9%, transparent)" stroke="var(--focus)" strokeOpacity={0.5} strokeDasharray="4 3" />
          )}

          {/* method windows */}
          {windows.map((w, i) => {
            const y = methodsY + i * methodRow
            const on = i === sel
            return (
              <g key={w.label} className="cursor-pointer" onClick={() => setSelected(i)}>
                <text x={left - 12} y={y + 11} textAnchor="end" fontSize="12.5" fontWeight="700" fill={on ? 'var(--ink)' : 'var(--ink-3)'}>{w.label}</text>
                <rect x={x(w.nm[0])} y={y + 2} width={Math.max(3, x(w.nm[1]) - x(w.nm[0]))} height={11} rx={5.5}
                  fill={on ? 'var(--focus)' : 'var(--rule-strong)'} />
                <text x={x1 + 12} y={y + 11} fontSize="12" fill="var(--ink-2)">{fmtRange(w.nm)}</text>
              </g>
            )
          })}
          {windows.length > 0 && <line x1={8} x2={W - 8} y1={fibersY - 8} y2={fibersY - 8} stroke="var(--rule)" />}

          {/* fiber families */}
          {FIBERS.map((f, i) => {
            const y = fibersY + i * fiberRow
            const share = win ? coverage(win.nm, [f.min_nm, f.max_nm]) : 0
            const v = verdict(share)
            const lo = win ? Math.max(win.nm[0], f.min_nm) : 0
            const hi = win ? Math.min(win.nm[1], f.max_nm) : 0
            return (
              <g key={f.name}>
                <text x={left - 12} y={y + 12} textAnchor="end" fontSize="12.5" fill="var(--ink-2)">{f.name}</text>
                <rect x={x(f.min_nm)} y={y + 3} width={x(f.max_nm) - x(f.min_nm)} height={12} rx={3} fill="var(--surface-3)" stroke="var(--rule-strong)" />
                {win && hi > lo && <rect x={x(lo)} y={y + 3} width={x(hi) - x(lo)} height={12} rx={3} fill={v.bar} />}
                <text x={x1 + 12} y={y + 12} fontSize="12" fontWeight={win ? 700 : 400} fill={win ? v.color : 'var(--ink-3)'}>
                  {win ? v.text : fmtRange([f.min_nm, f.max_nm])}
                </text>
              </g>
            )
          })}

          {/* wavelength axis */}
          <line x1={x0} x2={x1} y1={axisY} y2={axisY} stroke="var(--rule-strong)" />
          {BOTTOM_TICKS.map(([nm, label]) => (
            <text key={nm} x={x(nm)} y={axisY + 16} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{label}</text>
          ))}

          {/* cursor readout: wavelength and wavenumber */}
          {hoverX != null && (
            <g pointerEvents="none">
              <line x1={hoverX} x2={hoverX} y1={bandY} y2={axisY} stroke="var(--ink)" strokeOpacity={0.55} />
              <rect x={Math.min(Math.max(hoverX - 62, 4), W - 128)} y={0} width={124} height={18} rx={4} fill="var(--ink)" />
              <text x={Math.min(Math.max(hoverX, 66), W - 66)} y={13} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--surface)">
                {fmtWavelength(nmAt(hoverX))}{nmAt(hoverX) > 1000 ? `  ${fmtWavenumber(nmAt(hoverX))}` : ''}
              </text>
            </g>
          )}
        </svg>
      </div>
      {caption && <figcaption className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-ink-3">{caption}</figcaption>}
    </figure>
  )
}
