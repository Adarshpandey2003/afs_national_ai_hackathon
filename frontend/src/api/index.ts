import { realApi, type Api } from './client'

const base = (import.meta.env.VITE_API_BASE_URL ?? '').trim() || 'http://localhost:8000'

export const API_BASE = base.replace(/\/+$/, '')
export const api: Api = realApi(API_BASE)
export { ApiError } from './client'
