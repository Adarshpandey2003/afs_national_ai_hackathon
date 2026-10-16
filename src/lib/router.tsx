import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react'

// Four routes don't need a router dependency: pathname + history API.
const subscribe = (cb: () => void) => {
  addEventListener('popstate', cb)
  return () => removeEventListener('popstate', cb)
}

export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname)

export function navigate(to: string) {
  history.pushState(null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
  scrollTo(0, 0)
}

export function setQueryParam(key: string, value: string | null) {
  const url = new URL(location.href)
  if (value === null) url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  history.replaceState(null, '', url)
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(to)
      }}
      {...rest}
    />
  )
}
