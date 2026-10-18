import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react'
import { ApiError, MOCK, api } from '../api'
import { authNotice, signIn } from '../lib/auth'
import { useData } from '../lib/data'
import users from '../mock/users.json'
import { BrandLogo, PrismMark } from './brand'
import { LightRays } from './motion'

/** The sign-in screen shown while the backend asks for a token and there is none (AUTH.md). */
export function SignIn() {
  const notice = authNotice.use()
  const { health } = useData()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const waking = health.state === 'checking' || health.state === 'waking'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return setError('Enter your username and password.')
    setBusy(true)
    setError('')
    try {
      const r = await api.login({ username: username.trim(), password })
      signIn(r.access_token, r.user?.name ?? username.trim(), r.expires_in)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Wrong username or password.' : err instanceof Error ? err.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  return (
    <main className="atmosphere relative isolate flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <LightRays />
      <div className="w-full max-w-[25rem]">
        <div className="flex flex-col items-center text-center">
          <PrismMark size={64} live className="pulse-glow" />
          <BrandLogo className="mt-4 h-9 w-auto" />
          <h1 className="display mt-6 text-[1.9rem] leading-tight">Sign in</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">The Spectroscopy Assistant is open to the AFS team and invited reviewers.</p>
        </div>

        <form onSubmit={submit} noValidate className="glass glow-card mt-7 space-y-4 p-6">
          {notice && <p role="status" className="rounded-lg bg-warn-bg px-3 py-2 text-[14px] font-semibold text-warn">{notice}</p>}
          <div>
            <label htmlFor="sign-in-user" className="text-[14px] font-semibold">Username</label>
            <input
              id="sign-in-user" className="field mt-1.5" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
              value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="sign-in-pass" className="text-[14px] font-semibold">Password</label>
            <div className="relative mt-1.5">
              <input
                id="sign-in-pass" type={show ? 'text' : 'password'} className="field pr-11" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
              />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide the password' : 'Show the password'} aria-pressed={show}
                className="btn btn-quiet absolute right-1 top-1/2 -translate-y-1/2 p-1.5">
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          {error && <p role="alert" className="text-[14px] font-semibold text-bad">{error}</p>}
          <button type="submit" disabled={busy}
            className="btn w-full rounded-full bg-prism py-2.5 text-[15px] text-white shadow-[0_0_24px_-4px_var(--prism)] transition-transform hover:scale-[1.01]">
            {busy ? <LoaderCircle size={17} className="animate-spin" aria-hidden /> : <LockKeyhole size={16} aria-hidden />} Sign in
          </button>
          {waking && <p className="text-center text-[13px] text-ink-3">The server is waking up. The first sign-in can take up to a minute.</p>}
        </form>

        {!MOCK && (
          <p className="mt-4 text-center text-[13px] leading-relaxed text-ink-3">
            Jury and reviewers: the username and password are in the{' '}
            <a href="https://github.com/Adarshpandey2003/afs_national_ai_hackathon#for-the-jury" target="_blank" rel="noreferrer"
              className="font-semibold text-ink-2 underline underline-offset-2">GitHub README</a>.
          </p>
        )}

        {MOCK && (
          <p className="mt-4 text-center text-[13px] leading-relaxed text-ink-3">
            Mock mode: sign in with a demo account from <code className="font-mono">src/mock/users.json</code>, for example{' '}
            <span className="font-semibold text-ink-2">{users[0].username}</span> / <span className="font-semibold text-ink-2">{users[0].password}</span>.
          </p>
        )}
      </div>
    </main>
  )
}
