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

/** Text to place in the chat composer on arrival (e.g. "Run this enquiry live" from a report). */
export const draftStore = createStore<{ text: string; caseId?: string } | null>(null)
