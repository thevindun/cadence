import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Logo } from './Logo.jsx'
import { login, register } from '../core/auth.js'

export default function Login({ needsSetup, demo, onAuthed }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // On a demo deployment anyone can sign up, so let them pick. First run is
  // always registration — there's no account to sign into yet.
  const [mode, setMode] = useState(needsSetup ? 'register' : 'login')

  const isRegister = needsSetup || mode === 'register'

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const user = isRegister
        ? await register(email.trim(), password)
        : await login(email.trim(), password)
      onAuthed(user)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const heading = needsSetup ? 'Create your admin account'
    : isRegister ? 'Create a demo account' : 'Sign in'

  const blurb = needsSetup ? 'First run — set up the owner account for this Cadence.'
    : isRegister ? 'Explore every feature. Posts publish to a mock provider, never to real platforms.'
      : 'Welcome back.'

  return (
    <div className="grid min-h-screen place-items-center bg-ink font-display text-fg">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 flex justify-center"><Logo /></div>

        {demo && (
          <div className="mb-4 rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-center font-mono text-[11px] leading-relaxed text-coral">
            DEMO MODE — nothing publishes to real platforms.
            <a href="https://github.com/thevindun/cadence" target="_blank" rel="noreferrer"
              className="ml-1 underline transition hover:text-fg">Self-host</a> to connect real accounts.
          </div>
        )}

        <div className="rounded-xl border border-line bg-surface p-6">
          <h1 className="text-lg font-medium tracking-tight">{heading}</h1>
          <p className="mt-1 mb-5 text-sm text-muted">{blurb}</p>

          <div className="flex flex-col gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email"
              className="rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-fg placeholder:text-muted outline-none transition focus:border-coral" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
              placeholder={isRegister ? 'Password (8+ chars)' : 'Password'}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-fg placeholder:text-muted outline-none transition focus:border-coral" />
            {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}
            <button onClick={submit} disabled={busy || !email.trim() || !password}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-coral px-4 py-2 text-sm font-medium text-white transition duration-100 enabled:hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40">
              {busy && <Loader2 size={15} strokeWidth={2} className="animate-spin" />}
              {isRegister ? 'Create account' : 'Sign in'}
            </button>
          </div>

          {demo && !needsSetup && (
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
              className="mt-4 w-full text-center font-mono text-[11px] text-muted transition hover:text-coral">
              {mode === 'login' ? 'No account? Create one' : 'Already have an account? Sign in'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}