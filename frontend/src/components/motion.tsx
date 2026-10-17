import { useEffect, useState, type MouseEvent } from 'react'
import { clock } from '../lib/data'

// Small motion pieces in the spirit of Magic UI, SmoothUI and Unlumen UI, built on CSS so no animation library is needed.

const DIGITS = [...'0123456789'].map((d) => <span key={d}>{d}</span>)

/** m:ss with each digit rolling into place (after SmoothUI Digit Roll and Unlumen Animate Digits). */
export function RollingClock({ ms }: { ms: number }) {
  const text = clock(ms)
  return (
    <span className="tabular-nums" role="timer" aria-label={text}>
      {[...text].map((ch, i) => {
        // Keyed from the right, so the seconds keep their place when the minutes gain a digit.
        const key = text.length - i
        return /\d/.test(ch)
          ? <span key={key} className="digit" aria-hidden><span style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>{DIGITS}</span></span>
          : <span key={key} aria-hidden>{ch}</span>
      })}
    </span>
  )
}

/** Lets a `.spotlight` element light up under the pointer (after Magic UI Magic Card). */
export function spot(e: MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`)
}

/** One item of a list at a time, changing every few seconds (after Magic UI Word Rotate). Holds still for reduced motion. */
export function useRotate<T>(items: T[], every = 3200) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (items.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setI((n) => (n + 1) % items.length), every)
    return () => clearInterval(t)
  }, [items.length, every])
  return { item: items[i], i }
}

/** Light rays falling behind the landing prism (after Magic UI Light Rays and Unlumen Aurora Bars). */
export function LightRays() {
  const rays = [
    { a: '-30deg', ray: 'var(--cyan)', d: '0s' },
    { a: '-15deg', ray: 'var(--prism)', d: '-3s' },
    { a: '0deg', ray: 'var(--ink)', d: '-6s' },
    { a: '15deg', ray: 'var(--orange)', d: '-2s' },
    { a: '30deg', ray: 'var(--magenta)', d: '-5s' },
  ]
  return (
    <div className="light-rays" aria-hidden>
      {rays.map((r) => (
        <span key={r.a} style={{ ['--a' as string]: r.a, ['--ray' as string]: `color-mix(in oklab, ${r.ray} 45%, transparent)`, animationDelay: r.d }} />
      ))}
    </div>
  )
}
