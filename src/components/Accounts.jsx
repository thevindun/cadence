import { useState, useEffect, useCallback } from 'react'
import { Check, X, Loader2, ExternalLink, Plus } from 'lucide-react'
import { API } from '../core/api.js'
import { PLATFORMS } from '../core/types.js'
import { useToast } from '../core/useToast.jsx'

const CONNECT_FIELDS = {
  bluesky: [
    { name: 'handle', placeholder: 'handle.bsky.social', type: 'text' },
    { name: 'app_password', placeholder: 'app password (xxxx-xxxx-xxxx-xxxx)', type: 'password', mono: true },
  ],
  mastodon: [
    { name: 'instance_url', placeholder: 'https://mastodon.social', type: 'text' },
    { name: 'access_token', placeholder: 'access token', type: 'password', mono: true },
  ],
}

export default function Accounts() {
  const [platforms, setPlatforms] = useState([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/accounts`)
      setPlatforms(await res.json())
    } catch (err) { console.error('Failed to load accounts:', err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onMsg = (e) => { if (e.data === 'cadence-oauth-done') 
      toast('Account connected')
      load() }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [load])

  if (loading) return <p className="py-8 text-center text-sm text-muted">Loading accounts…</p>

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-4 font-mono text-xs tracking-wider text-muted">CONNECTED ACCOUNTS</p>
      <div className="flex flex-col gap-3">
        {platforms.map((p) => <PlatformRow key={p.id} platform={p} onChange={load} />)}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-muted">
        Connect multiple accounts per platform — each posts independently. Tokens live on your local
        Cadence server, never in the browser. OAuth platforms run on a local mock provider until their
        real app is registered.
      </p>
    </div>
  )
}

function PlatformRow({ platform, onChange }) {
  const meta = PLATFORMS[platform.id]
  const fields = CONNECT_FIELDS[platform.id] || []
  const [adding, setAdding] = useState(false)
  const [values, setValues] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const toast = useToast() 

  const conns = platform.connections || []
  const setField = (n, v) => setValues((s) => ({ ...s, [n]: v }))
  const allFilled = fields.every((f) => (values[f.name] || '').trim())

  const connectForm = async () => {
    setBusy(true); setError(null)
    try {
      const body = Object.fromEntries(fields.map((f) => [f.name, (values[f.name] || '').trim()]))
      const res = await fetch(`${API}/accounts/${platform.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Could not connect')
      toast('Account connected')
      setValues({}); setAdding(false); onChange()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const connectOAuth = () => {
    const w = 520, h = 640
    const left = window.screenX + (window.outerWidth - w) / 2
    const top = window.screenY + (window.outerHeight - h) / 2
    window.open(`${API}/accounts/${platform.id}/oauth/start`, 'cadence-oauth',
      `width=${w},height=${h},left=${left},top=${top}`)
  }

  const disconnect = async (handle) => {
    setBusy(true)
    try {
      await fetch(`${API}/accounts/${platform.id}/${encodeURIComponent(handle)}`, { method: 'DELETE' })
      onChange()
    } finally { setBusy(false) }
  }

  const canConnect = platform.oauth || platform.supported

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-elevated font-mono text-xs text-muted">
            {meta?.short ?? platform.id.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="text-sm font-medium text-fg">{meta?.label ?? platform.id}</div>
            <div className="font-mono text-[11px] text-muted">
              {conns.length ? `${conns.length} connected` : canConnect ? 'Not connected' : 'Coming soon'}
            </div>
          </div>
        </div>
        {canConnect && (
          platform.oauth
            ? <button onClick={connectOAuth}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition hover:border-coral/40 hover:text-fg">
                <ExternalLink size={14} strokeWidth={1.75} /> {conns.length ? 'Add another' : 'Connect'}
              </button>
            : <button onClick={() => setAdding((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition hover:border-coral/40 hover:text-fg">
                <Plus size={14} strokeWidth={2} /> {conns.length ? 'Add another' : 'Connect'}
              </button>
        )}
      </div>

      {conns.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {conns.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border border-line bg-elevated px-3 py-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-400">
                <Check size={12} strokeWidth={2} /> Live
              </span>
              <span className="flex-1 truncate font-mono text-xs text-fg">{c.handle}</span>
              <button onClick={() => disconnect(c.handle)} disabled={busy}
                className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-ink hover:text-red-400 disabled:opacity-40">
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && !platform.oauth && (
        <div className="mt-3 flex flex-col gap-2">
          {fields.map((f) => (
            <input key={f.name} value={values[f.name] || ''} onChange={(e) => setField(f.name, e.target.value)}
              type={f.type} placeholder={f.placeholder}
              className={`rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-fg placeholder:text-muted outline-none transition focus:border-coral ${f.mono ? 'font-mono' : ''}`} />
          ))}
          {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}
          <button onClick={connectForm} disabled={busy || !allFilled}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-coral px-4 py-2 text-sm font-medium text-white transition duration-100 enabled:hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40">
            {busy && <Loader2 size={15} strokeWidth={2} className="animate-spin" />}
            {busy ? 'Verifying…' : 'Connect'}
          </button>
        </div>
      )}
    </section>
  )
}