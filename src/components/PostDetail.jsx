import { useState, useEffect } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import { ArrowLeft, Heart, Repeat2, MessageCircle, Eye, ExternalLink } from 'lucide-react'
import { API } from '../core/api.js'
import { PLATFORMS } from '../core/types.js'
import StatusPill from './StatusPill.jsx'

const platformOf = (t) => (t.includes(':') ? t.split(':')[0] : t)

export default function PostDetail() {
  const { id } = useParams()
  const [post, setPost] = useState(null)
  const [clicks, setClicks] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/posts/${id}`)
        if (!res.ok) throw new Error('Post not found')
        setPost(await res.json())
        try { setClicks(await (await fetch(`${API}/links/stats`)).json()) } catch {}
      } catch (e) { setErr(String(e.message || e)) }
    })()
  }, [id])

  if (err) return <p className="text-sm text-red-400">{err}</p>
  if (!post) return <p className="text-sm text-muted">Loading…</p>

  const mine = clicks.filter((c) => c.post_id === post.id)
  const totalClicks = mine.reduce((s, c) => s + (c.clicks || 0), 0)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <NavLink to="/queue" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted transition hover:text-coral">
        <ArrowLeft size={13} strokeWidth={1.75} /> BACK
      </NavLink>

      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="mb-3 flex items-center gap-3">
          <StatusPill status={post.status} />
          <span className="font-mono text-[11px] text-muted">
            {new Date(post.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          {post.repeat !== 'none' && <span className="font-mono text-[11px] text-coral">repeats {post.repeat}</span>}
        </div>
        <p className="whitespace-pre-wrap text-sm text-fg">{post.text}</p>
        {post.thread?.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 border-l-2 border-coral/30 pl-3">
            {post.thread.map((s, i) => <p key={i} className="whitespace-pre-wrap text-sm text-muted">{s}</p>)}
          </div>
        )}
        {post.media?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {post.media.map((m) => (
              <img key={m} src={`${API}/media/${m}`} alt="" className="h-24 w-24 rounded-lg border border-line object-cover" />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="mb-4 font-mono text-xs tracking-wider text-muted">PER-PLATFORM RESULTS</p>
        <div className="flex flex-col gap-2">
          {post.platforms.map((t) => {
            const r = (post.results || {})[t] || {}
            const m = (post.metrics || {})[t] || {}
            return (
              <div key={t} className="rounded-lg border border-line bg-elevated px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {PLATFORMS[platformOf(t)]?.short ?? platformOf(t)}
                  </span>
                  <span className={`font-mono text-[11px] ${r.ok ? 'text-green-400' : r.error ? 'text-red-400' : 'text-muted'}`}>
                    {r.ok ? 'published' : r.error || 'pending'}
                  </span>
                  {r.ok && (
                    <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1"><Heart size={11} strokeWidth={1.75} />{m.likes || 0}</span>
                      <span className="inline-flex items-center gap-1"><Repeat2 size={11} strokeWidth={1.75} />{m.reposts || 0}</span>
                      <span className="inline-flex items-center gap-1"><MessageCircle size={11} strokeWidth={1.75} />{m.replies || 0}</span>
                      {m.impressions != null && <span className="inline-flex items-center gap-1"><Eye size={11} strokeWidth={1.75} />{m.impressions}</span>}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {mine.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5">
          <p className="mb-3 font-mono text-xs tracking-wider text-muted">LINK CLICKS · {totalClicks}</p>
          <ul className="flex flex-col gap-1.5">
            {mine.map((c, i) => (
              <li key={i} className="flex items-center gap-2 font-mono text-[11px]">
                <ExternalLink size={11} strokeWidth={1.75} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-muted">{c.url}</span>
                <span className="text-fg">{c.clicks}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}