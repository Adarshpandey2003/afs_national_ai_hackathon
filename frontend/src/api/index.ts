import { realApi, type Api } from './client'
import { mockApi } from './mock'

const base = (import.meta.env.VITE_API_BASE_URL ?? '').trim()

/** No backend configured: run against the in-browser mock. */
export const MOCK = base === '' || base === 'mock'
export const API_BASE = MOCK ? 'mock' : base.replace(/\/+$/, '')
export const api: Api = MOCK ? mockApi : realApi(API_BASE)
export { ApiError } from './client'
