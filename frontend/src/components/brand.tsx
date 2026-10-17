import { useId } from 'react'
import { cn } from './ui'

/** The supplied ArtFiberSystems logo; the white wordmark becomes navy in the light theme. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <img src="/brand/afs-logo-dark.png" alt="ArtFiberSystems" className={cn('logo-dark', className)} />
      <img src="/brand/afs-logo-light.png" alt="ArtFiberSystems" className={cn('logo-light', className)} />
    </>
  )
}

const FIBERS = [
  { d: 'M52 100C40 70 44 32 74 8', color: '#22d3ee' },
  { d: 'M52 100C54 72 72 40 104 24', color: '#fb923c' },
  { d: 'M52 100C60 82 82 58 110 48', color: '#f472b6' },
]

/** The AFS prism with its three fibers, drawn as SVG so light can travel up the fibers. */
export function PrismMark({ size = 96, live = false, fibers = true, className }: { size?: number; live?: boolean; fibers?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  const shown = fibers ? FIBERS : []
  return (
    <svg viewBox="0 0 120 150" width={size} height={size * 1.25} className={className} aria-hidden>
      <defs>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <linearGradient id={`${id}-left`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d4dff" />
          <stop offset="1" stopColor="#06208c" />
        </linearGradient>
        <linearGradient id={`${id}-right`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b7bff" />
          <stop offset="1" stopColor="#0a2a9a" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="52" cy="128" r="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#bfe3ff" />
          <stop offset=".35" stopColor="#3b8bff" stopOpacity=".8" />
          <stop offset="1" stopColor="#3b8bff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {shown.map((f) => <path key={`g${f.color}`} d={f.d} stroke={f.color} strokeWidth="7" fill="none" opacity=".45" filter={`url(#${id}-glow)`} />)}
      {shown.map((f) => <path key={f.color} d={f.d} stroke={f.color} strokeWidth="2.2" strokeLinecap="round" fill="none" />)}
      {live && shown.map((f, i) => (
        <path key={`l${f.color}`} d={f.d} stroke="#fff" strokeOpacity=".75" strokeWidth="1.6" strokeLinecap="round" fill="none"
          className="ray-live" style={{ animationDelay: `${i * 0.25}s` }} />
      ))}

      <polygon points="52,100 24,142 52,128" fill={`url(#${id}-left)`} />
      <polygon points="52,100 80,142 52,128" fill={`url(#${id}-right)`} />
      <polygon points="24,142 80,142 52,128" fill="#04166b" />
      <circle cx="52" cy="128" r="16" fill={`url(#${id}-core)`} />
      <path d="M52 128L52 100M52 128L24 142M52 128L80 142" stroke="#8cc4ff" strokeOpacity=".75" strokeWidth=".8" />
      <polygon points="52,100 24,142 80,142" fill="none" stroke="#6aa8ff" strokeOpacity=".6" strokeWidth=".8" />
    </svg>
  )
}
