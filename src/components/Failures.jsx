import { useState } from 'react'
import { RotateCw, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { API } from '../core/api.js'
import { STATUS, PLATFORMS } from '../core/types.js'
import { useToast } from '../core/useToast.jsx'
import EmptyState from './EmptyState.jsx'

const short = (t) => PLATFORMS[t.includes(':') ? t.split(':')[0] : t]?.short ?? t

export default function Failures({ posts, onDelete }) {
  const [busy, setBusy] = useState(null)
  const toast = useToast() 
  const failed = posts
    .filter((p) => p.status === STATUS.FAILED)
    .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))

  const retry = async (id) => {
    toast('Retrying…') 
    setBusy(id)
    try { await fetch(`${API}/posts/${id}/retry`, { method: 'POST' }) }
    finally { setBusy(null) }
  }

  const failedTargets = (p) =>
    Object.entries(p.results || {}).filter(([t, r]) => t !== '_review' && !r.ok)

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-4 font-mono text-xs tracking-wider text-muted">FAILED POSTS · {failed.length}</p>
      {failed.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Nothing failed"
          body="Posts that don't send land here with the exact error and a one-click retry." />
      ) : (
        <div className="flex flex-col gap-2">
          {failed.map((p) => (
            <div key={p.id} className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-red-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">{p.text}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    {new Date(p.scheduledAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-1">
                {failedTargets(p).map(([t, r]) => (
                  <div key={t} className="flex items-start gap-2 rounded-lg bg-ink px-2.5 py-1.5">
                    <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted">{short(t)}</span>
                    <span className="font-mono text-[11px] text-red-400">{r.error || 'failed'}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <button onClick={() => retry(p.id)} disabled={busy === p.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-coral px-3 py-1.5 text-sm font-medium text-white transition duration-100 enabled:hover:-translate-y-1 disabled:opacity-40">
                  {busy === p.id ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <RotateCw size={14} strokeWidth={2} />} Retry
                </button>
                <button onClick={() => onDelete(p.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition hover:border-red-500/40 hover:text-red-400">
                  <Trash2 size={14} strokeWidth={1.75} /> Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}