import { onUnauthorized } from '../lib/auth'
import { ApiError, realApi, type Api } from './client'
import { mockApi } from './mock'

const base = (import.meta.env.VITE_API_BASE_URL ?? '').trim()

/** No backend configured: run against the in-browser mock. */
export const MOCK = base === '' || base === 'mock'
export const API_BASE = MOCK ? 'mock' : base.replace(/\/+$/, '')
const raw: Api = MOCK ? mockApi : realApi(API_BASE)

/** A 401 from any call except sign-in itself sends the user back to the sign-in screen. */
export const api = Object.fromEntries(
  Object.entries(raw).map(([name, fn]: [string, (...a: unknown[]) => unknown]) => [
    name,
    name === 'login' || name === 'subscribe' ? fn : (...a: unknown[]) => (fn(...a) as Promise<unknown>).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) onUnauthorized()
      throw e
    }),
  ]),
) as unknown as Api
export { ApiError }
