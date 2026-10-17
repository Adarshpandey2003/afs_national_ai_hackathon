import { createStore } from './store'

// Sign-in with a JWT from the backend (AUTH.md). The token stays in this browser until it expires or the user signs out;
// the backend is what actually refuses requests without one.

export interface Session { token: string; user: string; id: string; exp: number }

// Kept per backend URL, so a mock session never meets the real backend.
const scope = (import.meta.env.VITE_API_BASE_URL ?? '').trim() || 'mock'
const KEY = `afs-session:${scope}`
const REQUIRED_KEY = `afs-auth-required:${scope}`

/** The claims of a JWT, or {} for anything else. Not verified here: only the backend can do that. */
function claims(token: string): { exp?: number; sub?: string; name?: string } {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return {}
  }
}

function read(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null
    return s && s.exp > Date.now() ? s : null
  } catch {
    return null
  }
}

const remember = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* storage unavailable: lasts for this page only */ }
}

export const session = createStore<Session | null>(read())

/** Whether the backend asks for sign-in (from /health or a 401). Remembered, so the sign-in screen shows without a flash next time. */
export const authRequired = createStore<boolean>((() => {
  try {
    return localStorage.getItem(REQUIRED_KEY) === '1'
  } catch {
    return false
  }
})())
export function setAuthRequired(required: boolean) {
  authRequired.set(required)
  remember(REQUIRED_KEY, required ? '1' : null)
}

/** Why the user is back on the sign-in screen, e.g. an expired session. */
export const authNotice = createStore<string | null>(null)

export function signIn(token: string, user: string, expiresIn?: number) {
  const c = claims(token)
  const s: Session = { token, user: c.name ?? user, id: c.sub ?? user, exp: c.exp ? c.exp * 1000 : Date.now() + (expiresIn ?? 8 * 3600) * 1000 }
  authNotice.set(null)
  session.set(s)
  remember(KEY, JSON.stringify(s))
}

export function signOut(notice: string | null = null) {
  authNotice.set(notice)
  session.set(null)
  remember(KEY, null)
}

/** The token to send, or null once it has expired. */
export function currentToken() {
  const s = session.get()
  if (s && s.exp <= Date.now()) {
    signOut('Your session expired. Sign in again.')
    return null
  }
  return s?.token ?? null
}

/** The backend refused a request: back to the sign-in screen. */
export function onUnauthorized() {
  setAuthRequired(true)
  if (session.get()) signOut('Your session expired. Sign in again.')
}

if (import.meta.env.DEV) {
  const c = claims(`x.${btoa(JSON.stringify({ exp: 2000000000, sub: 'jury' }))}.y`)
  console.assert(c.exp === 2000000000 && c.sub === 'jury', 'jwt claims')
  console.assert(Object.keys(claims('not a token')).length === 0, 'non-jwt token')
}
