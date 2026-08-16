import { useEffect, useState } from 'react'
import { Plug, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { API } from '../core/api.js'

export default function Onboarding() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    (async () => {
      try {
        const data = await (await fetch(`${API}/accounts`)).json()
        const any = data.some((p) => (p.connections || []).length > 0)
        setShow(!any)
      } catch { /* offline — say nothing */ }
    })()
  }, [])
  if (!show) return null
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-coral/40 bg-coral/5 p-4">
      <Plug size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-coral" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">Connect your first account</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Cadence needs at least one social account before it can publish. Bluesky and Mastodon connect in seconds.
        </p>
        <NavLink to="/accounts" className="mt-2 inline-block rounded-lg bg-coral px-3 py-1.5 text-xs font-medium text-white transition hover:-translate-y-0.5">
          Go to Accounts
        </NavLink>
      </div>
      <button onClick={() => setShow(false)} className="shrink-0 text-muted transition hover:text-fg">
        <X size={15} strokeWidth={2} />
      </button>
    </div>
  )
}