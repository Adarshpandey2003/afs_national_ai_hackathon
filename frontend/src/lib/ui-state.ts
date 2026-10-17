import type { ReactNode } from 'react'
import type { SourceId } from '../api/types'
import { createStore } from './store'

export interface Tip { el: Element; rect: DOMRect; content: ReactNode }
export const tipStore = createStore<Tip | null>(null)
export const tooltip = {
  show: (el: Element, content: ReactNode) => tipStore.set({ el, rect: el.getBoundingClientRect(), content }),
  hide: () => tipStore.set(null),
}

export interface DrawerTarget { source: SourceId; page: number | null; quote?: string; label?: string; url?: string }
export const drawerStore = createStore<DrawerTarget | null>(null)
export function openSource(t: DrawerTarget) {
  tooltip.hide()
  drawerStore.set(t)
}
export const closeSource = () => drawerStore.set(null)

/** What the reader points at, so the agent log and the answer light up each other's part: "cite:S02:6" or "agent:writer". */
export const traceStore = createStore<string | null>(null)
export const citeKey = (c: { source: string; page: number | null }) => `cite:${c.source}:${c.page ?? 'table'}`

/** Text to place in the chat composer on arrival (e.g. "Run this enquiry live" from a report). */
export const draftStore = createStore<{ text: string; caseId?: string } | null>(null)
