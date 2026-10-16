import { useSyncExternalStore } from 'react'

// Minimal external store for UI singletons (drawer, tooltip, theme) so they don't re-render the app tree.
export function createStore<T>(initial: T) {
  let value = initial
  const subs = new Set<() => void>()
  const subscribe = (cb: () => void) => {
    subs.add(cb)
    return () => { subs.delete(cb) }
  }
  return {
    get: () => value,
    set(next: T) {
      value = next
      subs.forEach((f) => f())
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}
